import { and, eq, isNull, ne, type SQL } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono, type Context } from "hono"
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

import { ASSIGNMENT_ROLES, assignments } from "./schema"

/**
 * Who owns or works a record. The one invariant worth reading the file for: a
 * record never loses its last owner. Unassigning or demoting the last owner is
 * a 409, because an ownerless record has nobody to answer for it and nobody the
 * visibility rules can fall back to.
 */

const tag = "assignments"

const spec: ListSpec = {
  table: assignments,
  columns: {
    entity_type: assignments.entityType,
    entity_id: assignments.entityId,
    user_id: assignments.userId,
    role: assignments.role,
    created_at: assignments.createdAt,
  },
  id: assignments.id,
  defaultSort: "-created_at",
  deletedAt: assignments.deletedAt,
}

/**
 * Convenience shorthands for the embed, an allowlist mapping to columns so a
 * caller still cannot reach a column we did not offer.
 */
const SHORTHAND = {
  entityType: assignments.entityType,
  entityId: assignments.entityId,
  userId: assignments.userId,
  role: assignments.role,
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
    name: "userId",
    in: "query",
    description: "Only this person's assignments",
    schema: { type: "string" },
  },
  {
    name: "role",
    in: "query",
    description: `One of: ${ASSIGNMENT_ROLES.join(", ")}`,
    schema: { type: "string", enum: [...ASSIGNMENT_ROLES] },
  },
]

const row = createSelectSchema(assignments)

// .strict(): an unknown field is a typo or a stale client, and either way the
// caller deserves a 422 rather than a silently ignored value.
const input = z
  .object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    userId: z.string().min(1),
    role: z.enum(ASSIGNMENT_ROLES).default("member"),
    /** Makes the create safe to retry. See docs/rest-standards.md. */
    requestId: z.string().min(8).optional(),
  })
  .strict()

/** Body for `POST /assignments/{id}:action`. `:restore` takes `{}`. */
const actionInput = z
  .object({
    /** `:transferOwnership` only: who becomes the owner. */
    toUserId: z.string().min(1).optional(),
  })
  .strict()

/**
 * `actions()` dispatches with a bare `Context`, which carries no validator map,
 * so `c.req.valid("json")` cannot be typed there. `body(actionInput)` has
 * already run and rejected anything that does not fit, so this is the single
 * place that asserts it — not a second, hand-rolled parse.
 */
function actionBody(c: Context): z.infer<typeof actionInput> {
  return (c.req as unknown as { valid: (target: "json") => z.infer<typeof actionInput> }).valid(
    "json",
  )
}

/** Live owners of a record, optionally ignoring one assignment row. */
function liveOwners(entityType: string, entityId: string, exceptId?: string) {
  const parts: SQL[] = [
    eq(assignments.entityType, entityType),
    eq(assignments.entityId, entityId),
    eq(assignments.role, "owner"),
    isNull(assignments.deletedAt) as SQL,
  ]
  if (exceptId) parts.push(ne(assignments.id, exceptId))
  return and(...parts)
}

const LAST_OWNER =
  "That is the last owner of this record. Transfer ownership with :transferOwnership, or assign another owner first."

export const routes = new Hono()
  .use("*", requireAuth)

  .get(
    "/",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "List assignments",
      description:
        "Cursor-paged. Follow `nextPageToken` until it is null. Narrow with `?entityType=&entityId=`, `?userId=` or `?role=`.",
      ok: pageOf(row),
      params: listParams(["entity_type", "entity_id", "user_id", "role", "created_at"], scope),
      errors: [400, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)

      const extra: (SQL | undefined)[] = []
      for (const [key, column] of Object.entries(SHORTHAND)) {
        const value = c.req.query(key)
        if (value) extra.push(eq(column, value))
      }

      const rows = await db
        .select()
        .from(assignments)
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
      summary: "Assign someone to a record",
      description:
        "One live assignment per person per record; assigning again is a 409. Send a `requestId` to make the call safe to retry.",
      ok: row,
      okStatus: 201,
      errors: [409, 422, 429],
    }),
    body(input),
    idempotent,
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")

      // Guard first, with the specific answer. The partial unique index would
      // catch this too, but as a 500 with a constraint name in it.
      const [existing] = await db
        .select()
        .from(assignments)
        .where(
          and(
            eq(assignments.entityType, values.entityType),
            eq(assignments.entityId, values.entityId),
            eq(assignments.userId, values.userId),
            isNull(assignments.deletedAt),
          ),
        )
      if (existing) {
        return c.json(
          {
            error: `Already assigned as ${existing.role}. Unassign first, or use :transferOwnership.`,
          },
          409,
        )
      }

      const [created] = await db.insert(assignments).values(values).returning()
      return c.json(created, 201)
    },
  )

  .get(
    "/:id",
    rateLimit(LIMITS.read),
    describe({ tag, summary: "Get an assignment", ok: row, params: [idParam], errors: [404] }),
    async (c) => {
      const [found] = await db
        .select()
        .from(assignments)
        .where(eq(assignments.id, c.req.param("id")))
      return found ? c.json(found) : c.json({ error: "Not found" }, 404)
    },
  )

  /**
   * Custom actions live behind a verb rather than a magic PATCH field:
   * `POST /v1/assignments/{id}:transferOwnership` with `{"toUserId":"…"}`.
   */
  .post(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Run an action on an assignment",
      description:
        '`:transferOwnership` needs `{"toUserId":"…"}` and moves ownership in one transaction, so the record is never ownerless. `:restore` undoes an unassign and takes `{}`.',
      ok: row,
      params: [
        {
          ...idParam,
          description: "Record id followed by `:action`, e.g. `abc:transferOwnership`",
        },
      ],
      errors: [404, 409, 422, 429],
    }),
    body(actionInput),
    actions("id", {
      transferOwnership: async (c, id) => {
        const { toUserId } = actionBody(c)
        // Guard clauses first, each naming what is allowed.
        if (!toUserId) {
          return c.json({ error: "transferOwnership needs toUserId: the person taking over." }, 422)
        }

        const outcome = await db.transaction(async (tx) => {
          const [from] = await tx
            .select()
            .from(assignments)
            .where(and(eq(assignments.id, id), isNull(assignments.deletedAt)))
          if (!from) return { status: 404 as const, error: "Not found" }
          if (from.role !== "owner") {
            return {
              status: 409 as const,
              error: "Only an owner can transfer ownership. Assign this person as owner instead.",
            }
          }
          if (from.userId === toUserId) {
            return {
              status: 422 as const,
              error: "toUserId is already the owner. Nothing to transfer.",
            }
          }

          // Promote first, demote second. Ownership overlaps for the length of
          // the transaction rather than gapping, so no reader ever sees the
          // record ownerless and the last-owner guard stays true throughout.
          const [live] = await tx
            .select()
            .from(assignments)
            .where(
              and(
                eq(assignments.entityType, from.entityType),
                eq(assignments.entityId, from.entityId),
                eq(assignments.userId, toUserId),
                isNull(assignments.deletedAt),
              ),
            )

          if (live) {
            await tx.update(assignments).set({ role: "owner" }).where(eq(assignments.id, live.id))
          } else {
            await tx.insert(assignments).values({
              entityType: from.entityType,
              entityId: from.entityId,
              userId: toUserId,
              role: "owner",
            })
          }

          const [demoted] = await tx
            .update(assignments)
            .set({ role: "member" })
            .where(eq(assignments.id, from.id))
            .returning()
          return { status: 200 as const, row: demoted }
        })

        if (outcome.status !== 200) return c.json({ error: outcome.error }, outcome.status)
        return c.json(outcome.row)
      },

      restore: async (c, id) => {
        const outcome = await db.transaction(async (tx) => {
          const [target] = await tx.select().from(assignments).where(eq(assignments.id, id))
          if (!target) return { status: 404 as const, error: "Not found" }
          if (!target.deletedAt) return { status: 200 as const, row: target }

          // The partial unique index allows one live assignment per person per
          // record, so a tombstone can only come back if the slot is free.
          const [live] = await tx
            .select()
            .from(assignments)
            .where(
              and(
                eq(assignments.entityType, target.entityType),
                eq(assignments.entityId, target.entityId),
                eq(assignments.userId, target.userId),
                isNull(assignments.deletedAt),
              ),
            )
          if (live) {
            return {
              status: 409 as const,
              error: `Already assigned as ${live.role}; this older assignment cannot be restored.`,
            }
          }

          const [restored] = await tx
            .update(assignments)
            .set({ deletedAt: null })
            .where(eq(assignments.id, target.id))
            .returning()
          return { status: 200 as const, row: restored }
        })

        if (outcome.status !== 200) return c.json({ error: outcome.error }, outcome.status)
        return c.json(outcome.row)
      },
    }),
  )

  .delete(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Unassign someone",
      description:
        "Soft delete: the row is kept and hidden. Removing the record's last owner is refused with a 409.",
      params: [idParam],
      errors: [404, 409],
    }),
    async (c) => {
      const id = c.req.param("id")

      const outcome = await db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(assignments)
          .where(and(eq(assignments.id, id), isNull(assignments.deletedAt)))
        if (!target) return { status: 404 as const, error: "Not found" }

        // The invariant: a record must never lose its last owner. Checked in
        // the same transaction as the write, so two concurrent unassigns cannot
        // both see a surviving owner that is about to disappear.
        if (target.role === "owner") {
          const others = await tx
            .select({ id: assignments.id })
            .from(assignments)
            .where(liveOwners(target.entityType, target.entityId, target.id))
            .limit(1)
          if (others.length === 0) return { status: 409 as const, error: LAST_OWNER }
        }

        await tx.update(assignments).set({ deletedAt: new Date() }).where(eq(assignments.id, id))
        return { status: 204 as const }
      })

      if (outcome.status === 204) return c.body(null, 204)
      return c.json({ error: outcome.error }, outcome.status)
    },
  )
