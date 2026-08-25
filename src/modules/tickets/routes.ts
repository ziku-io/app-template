import { and, eq, ilike, isNull, or, type SQL } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono } from "hono"
import type { Context } from "hono"
import { z } from "zod"

import { db } from "@/server/db"
import { idempotent } from "@/server/idempotency"
import { requireAuth } from "@/server/middleware"
import { body, describe, idParam, listParams, pageOf } from "@/server/openapi"
import { LIMITS, rateLimit } from "@/server/rate-limit"
import {
  actions,
  BadRequest,
  listOrder,
  listWhere,
  page,
  parseList,
  type ListSpec,
} from "@/server/rest"

import { TICKET_PRIORITIES, TICKET_STATUSES, ticketMessages, tickets } from "./schema"

/**
 * A threaded support queue. Conventions come from the projects module: plural
 * noun, cursor paging, allowlisted sort and filter, soft delete, idempotent
 * create, rate limits.
 */

const tag = "tickets"

/**
 * Roles allowed to see internal notes. An allowlist, not a denylist: a role
 * added tomorrow (an external "customer" or "portal" role, say) is excluded
 * until someone deliberately names it here, which is the safe direction to
 * fail.
 */
const STAFF_ROLES = ["admin", "member"] as const

function isStaff(c: Context): boolean {
  return (STAFF_ROLES as readonly string[]).includes(c.get("user").role)
}

/** Sortable and filterable columns, by the name callers use. */
const spec: ListSpec = {
  table: tickets,
  columns: {
    ref: tickets.ref,
    subject: tickets.subject,
    status: tickets.status,
    priority: tickets.priority,
    assignee_id: tickets.assigneeId,
    requester_id: tickets.requesterId,
    entity_type: tickets.entityType,
    entity_id: tickets.entityId,
    created_at: tickets.createdAt,
    updated_at: tickets.updatedAt,
  },
  id: tickets.id,
  defaultSort: "-created_at",
  searchable: [tickets.subject, tickets.ref],
  deletedAt: tickets.deletedAt,
}

const messageSpec: ListSpec = {
  table: ticketMessages,
  columns: {
    author_id: ticketMessages.authorId,
    internal: ticketMessages.internal,
    created_at: ticketMessages.createdAt,
  },
  id: ticketMessages.id,
  // Oldest first: a thread reads top to bottom.
  defaultSort: "created_at",
  deletedAt: ticketMessages.deletedAt,
}

const row = createSelectSchema(tickets)
const messageRow = createSelectSchema(ticketMessages)

// .strict(): an unknown field is a typo or a stale client, and either way the
// caller deserves a 422 rather than a silently ignored value.
const input = z
  .object({
    subject: z.string().min(1).max(500),
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    requesterId: z.string().min(1).nullable().optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    entityType: z.string().min(1).nullable().optional(),
    entityId: z.string().min(1).nullable().optional(),
    /**
     * Deliberately absent: `ref`, `closedAt`. The reference is the database's
     * to mint, and closing is a verb (`:close`), not a field.
     */
    /** Makes the create safe to retry. See docs/rest-standards.md. */
    requestId: z.string().min(8).optional(),
  })
  .strict()

const messageInput = z
  .object({
    bodyText: z.string().min(1).max(20_000),
    internal: z.boolean().optional(),
    requestId: z.string().min(8).optional(),
  })
  .strict()

/** Both halves of a polymorphic pointer, or neither. Mirrors the CHECK. */
function entityPairError(values: { entityType?: string | null; entityId?: string | null }) {
  const hasType = values.entityType != null
  const hasId = values.entityId != null
  if (hasType === hasId) return null
  return "entityType and entityId must be sent together, or not at all."
}

export const routes = new Hono()
  .use("*", requireAuth)

  .get(
    "/",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "List tickets",
      description:
        "Cursor-paged. Follow `nextPageToken` until it is null. `?q=` searches subject and ref.",
      ok: pageOf(row),
      params: listParams([
        "ref",
        "subject",
        "status",
        "priority",
        "assignee_id",
        "requester_id",
        "entity_type",
        "entity_id",
        "created_at",
        "updated_at",
      ]),
      errors: [400, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)

      const search = request.q
        ? or(...spec.searchable!.map((column) => ilike(column, `%${request.q}%`)))
        : undefined

      const rows = await db
        .select()
        .from(tickets)
        .where(listWhere(request, spec, [search as SQL | undefined]))
        .orderBy(...listOrder(request, spec))
        // One more than asked for: the extra row is how we know there is a
        // next page, without counting the whole table.
        .limit(request.pageSize + 1)

      return c.json(page(rows, request, spec))
    },
  )

  .post(
    "/",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Create a ticket",
      description:
        "The `ref` (TK000123) is minted by the database. Send a `requestId` to make the call safe to retry.",
      ok: row,
      okStatus: 201,
      errors: [409, 422, 429],
    }),
    body(input),
    idempotent,
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")

      const pairError = entityPairError(values)
      if (pairError) return c.json({ error: pairError }, 422)

      const [created] = await db
        .insert(tickets)
        .values({
          ...values,
          // The creator is the requester unless they named someone else.
          requesterId: values.requesterId ?? c.get("user").id,
        })
        .returning()
      return c.json(created, 201)
    },
  )

  .get(
    "/:id/messages",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "List a ticket's messages",
      description:
        "Oldest first. Internal notes are only returned to staff; the filter is applied in SQL.",
      ok: pageOf(messageRow),
      params: listParams(["author_id", "internal", "created_at"], [idParam]),
      errors: [400, 404, 429],
    }),
    async (c) => {
      const ticketId = c.req.param("id")
      const [ticket] = await db
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
      if (!ticket) return c.json({ error: "Not found" }, 404)

      const request = parseList(c, messageSpec)

      const extra: (SQL | undefined)[] = [eq(ticketMessages.ticketId, ticketId)]
      // The guard that matters. Filtering in SQL rather than after the fact
      // means an internal note never reaches this process for a non-staff
      // caller, so no later mistake — a serializer, a log line, a debug
      // endpoint — can leak one.
      if (!isStaff(c)) extra.push(eq(ticketMessages.internal, false))

      const rows = await db
        .select()
        .from(ticketMessages)
        .where(listWhere(request, messageSpec, extra))
        .orderBy(...listOrder(request, messageSpec))
        .limit(request.pageSize + 1)

      return c.json(page(rows, request, messageSpec))
    },
  )

  .post(
    "/:id/messages",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Post a message on a ticket",
      description: "`internal: true` marks a staff-only note. Non-staff callers may not set it.",
      ok: messageRow,
      okStatus: 201,
      params: [idParam],
      errors: [403, 404, 409, 422, 429],
    }),
    body(messageInput),
    idempotent,
    async (c) => {
      const ticketId = c.req.param("id")
      const { requestId: _ignored, ...values } = c.req.valid("json")

      // Guard first, in the order a reader would ask the questions.
      if (values.internal === true && !isStaff(c)) {
        return c.json(
          { error: `Only these roles may write internal notes: ${STAFF_ROLES.join(", ")}` },
          403,
        )
      }

      const [ticket] = await db
        .select({ id: tickets.id, status: tickets.status })
        .from(tickets)
        .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
      if (!ticket) return c.json({ error: "Not found" }, 404)
      // Reopening is a deliberate act; silently appending to a closed thread
      // would hide the message from anyone working the open queue.
      if (ticket.status === "closed") {
        return c.json({ error: "Ticket is closed. Reopen it with `:reopen` first." }, 409)
      }

      const [created] = await db
        .insert(ticketMessages)
        .values({
          ticketId,
          bodyText: values.bodyText,
          internal: values.internal ?? false,
          authorId: c.get("user").id,
        })
        .returning()

      // The thread moving is a change to the ticket, so the list sorts right.
      await db.update(tickets).set({ updatedAt: new Date() }).where(eq(tickets.id, ticketId))

      return c.json(created, 201)
    },
  )

  .get(
    "/:id",
    rateLimit(LIMITS.read),
    describe({ tag, summary: "Get a ticket", ok: row, params: [idParam], errors: [404, 429] }),
    async (c) => {
      const [found] = await db
        .select()
        .from(tickets)
        // Soft-deleted tickets are gone as far as this endpoint is concerned;
        // `:restore` is the only way back.
        .where(and(eq(tickets.id, c.req.param("id")), isNull(tickets.deletedAt)))
      return found ? c.json(found) : c.json({ error: "Not found" }, 404)
    },
  )

  .patch(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Update a ticket",
      description: "Use `:close` and `:reopen` rather than setting `status` to `closed` here.",
      ok: row,
      params: [idParam],
      errors: [404, 422, 429],
    }),
    body(input.partial()),
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")

      const pairError = entityPairError(values)
      if (pairError) return c.json({ error: pairError }, 422)

      // Closing stamps `closedAt`, and the CHECK will not accept a closed
      // ticket arriving through the back door without one.
      if (values.status === "closed") {
        return c.json({ error: "Close a ticket with `POST /tickets/{id}:close`." }, 422)
      }

      const [updated] = await db
        .update(tickets)
        .set({
          ...values,
          // Any status other than 'closed' means the closedAt has to go, or
          // the CHECK rejects the row.
          ...(values.status ? { closedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(tickets.id, c.req.param("id")), isNull(tickets.deletedAt)))
        .returning()
      return updated ? c.json(updated) : c.json({ error: "Not found" }, 404)
    },
  )

  /**
   * Custom actions live behind a verb rather than a magic PATCH field:
   * `POST /v1/tickets/{id}:close`.
   */
  .post(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Run an action on a ticket",
      description: "`:close`, `:reopen`, or `:restore`, which undoes a soft delete.",
      ok: row,
      params: [{ ...idParam, description: "Record id followed by `:action`, e.g. `abc:close`" }],
      errors: [404, 409, 429],
    }),
    actions("id", {
      close: async (c, id) => {
        const [ticket] = await db
          .select({ status: tickets.status })
          .from(tickets)
          .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
        if (!ticket) return c.json({ error: "Not found" }, 404)
        if (ticket.status === "closed") return c.json({ error: "Already closed." }, 409)

        const closedAt = new Date()
        const [closed] = await db
          .update(tickets)
          // status and closedAt move together — the CHECK would reject either
          // one on its own.
          .set({ status: "closed", closedAt, updatedAt: closedAt })
          .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
          .returning()
        return closed ? c.json(closed) : c.json({ error: "Not found" }, 404)
      },

      reopen: async (c, id) => {
        const [ticket] = await db
          .select({ status: tickets.status })
          .from(tickets)
          .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
        if (!ticket) return c.json({ error: "Not found" }, 404)
        if (ticket.status !== "closed") {
          return c.json(
            { error: `Only a closed ticket can be reopened (it is "${ticket.status}").` },
            409,
          )
        }

        const [reopened] = await db
          .update(tickets)
          .set({ status: "open", closedAt: null, updatedAt: new Date() })
          .where(and(eq(tickets.id, id), isNull(tickets.deletedAt)))
          .returning()
        return reopened ? c.json(reopened) : c.json({ error: "Not found" }, 404)
      },

      restore: async (c, id) => {
        const [restored] = await db
          .update(tickets)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(tickets.id, id))
          .returning()
        return restored ? c.json(restored) : c.json({ error: "Not found" }, 404)
      },
    }),
  )

  .delete(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Delete a ticket",
      description: "Soft delete: the row is kept and hidden. Restore with `:restore`.",
      params: [idParam],
      errors: [404, 429],
    }),
    async (c) => {
      const now = new Date()
      const [deleted] = await db
        .update(tickets)
        .set({ deletedAt: now })
        .where(and(eq(tickets.id, c.req.param("id")), isNull(tickets.deletedAt)))
        .returning()
      if (!deleted) return c.json({ error: "Not found" }, 404)

      // The thread goes with the ticket. Leaving messages readable behind a
      // deleted parent is how internal notes escape.
      await db
        .update(ticketMessages)
        .set({ deletedAt: now })
        .where(and(eq(ticketMessages.ticketId, deleted.id), isNull(ticketMessages.deletedAt)))

      return c.body(null, 204)
    },
  )
