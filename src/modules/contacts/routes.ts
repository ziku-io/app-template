import { and, eq, ilike, isNull, or, type SQL } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono } from "hono"
import { z } from "zod"

import { db } from "@/server/db"
import { idempotent } from "@/server/idempotency"
import { requireAuth } from "@/server/middleware"
import { body, describe, idParam, listParams, pageOf, type Param } from "@/server/openapi"
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

import { contacts } from "./schema"

/**
 * Named people attached to any record: `entityType` + `entityId`, the same
 * polymorphic shape `files` uses.
 */

const tag = "contacts"

/** Sortable and filterable columns, by the name callers use. */
const spec: ListSpec = {
  table: contacts,
  columns: {
    entity_type: contacts.entityType,
    entity_id: contacts.entityId,
    name: contacts.name,
    email: contacts.email,
    phone: contacts.phone,
    role: contacts.role,
    is_primary: contacts.isPrimary,
    created_at: contacts.createdAt,
  },
  id: contacts.id,
  defaultSort: "-created_at",
  searchable: [contacts.name, contacts.email],
  deletedAt: contacts.deletedAt,
}

/**
 * Convenience shorthands for the embed: `?entityType=project&entityId=42`
 * beats spelling out `?filter=entity_type:project;entity_id:42`. The keys are an
 * allowlist mapping to columns, so a caller still cannot reach a column we did
 * not offer.
 */
const SHORTHAND = {
  entityType: contacts.entityType,
  entityId: contacts.entityId,
  role: contacts.role,
} as const

const scope: Param[] = [
  {
    name: "entityType",
    in: "query",
    description: 'Scope to a record type, e.g. "project"',
    schema: { type: "string" },
  },
  { name: "entityId", in: "query", description: "Id of that record", schema: { type: "string" } },
  {
    name: "role",
    in: "query",
    description: 'Exact role, e.g. "Billing"',
    schema: { type: "string" },
  },
]

const row = createSelectSchema(contacts)

// .strict(): an unknown field is a typo or a stale client, and either way the
// caller deserves a 422 rather than a silently ignored value.
const input = z
  .object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    name: z.string().min(1),
    // Mirrors the contacts_email_shape CHECK. Nullable, not just optional:
    // clearing an email is a real edit, and it has to be spellable.
    email: z.email().nullable().optional(),
    phone: z.string().min(1).nullable().optional(),
    role: z.string().min(1).nullable().optional(),
    /**
     * Deliberately absent: `isPrimary`. Promoting is a transaction that has to
     * demote the current primary first, so it gets its own verb, `:makePrimary`.
     * Letting it through here would just hit the partial unique index and 409.
     */
    /** Makes the create safe to retry. See docs/rest-standards.md. */
    requestId: z.string().min(8).optional(),
  })
  .strict()

export const routes = new Hono()
  .use("*", requireAuth)

  .get(
    "/",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "List contacts",
      description:
        "Cursor-paged. Follow `nextPageToken` until it is null. `?q=` searches name and email.",
      ok: pageOf(row),
      params: listParams(
        ["entity_type", "entity_id", "name", "email", "phone", "role", "is_primary", "created_at"],
        scope,
      ),
      errors: [400, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)

      const extra: (SQL | undefined)[] = []
      for (const [key, column] of Object.entries(SHORTHAND)) {
        const value = c.req.query(key)
        if (value) extra.push(eq(column, value))
      }
      if (request.q) {
        extra.push(or(...spec.searchable!.map((column) => ilike(column, `%${request.q}%`))))
      }

      const rows = await db
        .select()
        .from(contacts)
        .where(listWhere(request, spec, extra))
        .orderBy(...listOrder(request, spec))
        // One more than asked for: the extra row is how we know there is a next
        // page, without counting the whole table.
        .limit(request.pageSize + 1)

      return c.json(page(rows, request, spec))
    },
  )

  .post(
    "/",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Create a contact",
      description:
        "Send a `requestId` to make the call safe to retry. New contacts are never primary; promote one with `:makePrimary`.",
      ok: row,
      okStatus: 201,
      errors: [409, 422, 429],
    }),
    body(input),
    idempotent,
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")
      const [created] = await db.insert(contacts).values(values).returning()
      return c.json(created, 201)
    },
  )

  .get(
    "/:id",
    rateLimit(LIMITS.read),
    describe({ tag, summary: "Get a contact", ok: row, params: [idParam], errors: [404] }),
    async (c) => {
      const [found] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, c.req.param("id")))
      return found ? c.json(found) : c.json({ error: "Not found" }, 404)
    },
  )

  .patch(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Update a contact",
      description: "Soft-deleted contacts are not editable; `:restore` them first.",
      ok: row,
      params: [idParam],
      errors: [404, 422],
    }),
    body(input.partial()),
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")
      const [updated] = await db
        .update(contacts)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(contacts.id, c.req.param("id")), isNull(contacts.deletedAt)))
        .returning()
      return updated ? c.json(updated) : c.json({ error: "Not found" }, 404)
    },
  )

  /**
   * Custom actions live behind a verb rather than a magic PATCH field:
   * `POST /v1/contacts/{id}:makePrimary`.
   */
  .post(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Run an action on a contact",
      description:
        "`:makePrimary` demotes the record's current primary and promotes this one. `:restore` undoes a soft delete.",
      ok: row,
      params: [{ ...idParam, description: "Record id followed by `:action`, e.g. `abc:restore`" }],
      errors: [404, 409, 429],
    }),
    actions("id", {
      makePrimary: async (c, id) => {
        // One transaction, and the demote runs first: the partial unique index
        // on (entity_type, entity_id) WHERE is_primary allows exactly one, so
        // promoting before demoting would deadlock against our own constraint.
        const promoted = await db.transaction(async (tx) => {
          const [target] = await tx
            .select()
            .from(contacts)
            .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
          // Guard first. A deleted contact is not a candidate — restore it, then
          // promote it.
          if (!target) return null

          await tx
            .update(contacts)
            .set({ isPrimary: false, updatedAt: new Date() })
            .where(
              and(
                eq(contacts.entityType, target.entityType),
                eq(contacts.entityId, target.entityId),
                eq(contacts.isPrimary, true),
                isNull(contacts.deletedAt),
              ),
            )

          const [updated] = await tx
            .update(contacts)
            .set({ isPrimary: true, updatedAt: new Date() })
            .where(eq(contacts.id, target.id))
            .returning()
          return updated
        })

        return promoted ? c.json(promoted) : c.json({ error: "Not found" }, 404)
      },

      restore: async (c, id) => {
        // Restoring a primary could collide with a primary promoted while this
        // one was deleted, so it comes back demoted. The caller can re-promote
        // it explicitly with `:makePrimary` — silently stealing the slot would
        // be a surprise.
        const [restored] = await db
          .update(contacts)
          .set({ deletedAt: null, isPrimary: false, updatedAt: new Date() })
          .where(eq(contacts.id, id))
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
      summary: "Delete a contact",
      description: "Soft delete: the row is kept and hidden. Restore with `:restore`.",
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      const [deleted] = await db
        .update(contacts)
        // Dropping the primary flag on the way out frees the slot for whoever
        // takes over; the partial index only counts live rows, but keeping the
        // flag would make a later `:restore` look like a second primary.
        .set({ deletedAt: new Date(), isPrimary: false })
        .where(and(eq(contacts.id, c.req.param("id")), isNull(contacts.deletedAt)))
        .returning()
      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )
