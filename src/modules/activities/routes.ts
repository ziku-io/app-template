import { and, eq, isNull } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono } from "hono"
import { z } from "zod"

import { db } from "@/server/db"
import { idempotent } from "@/server/idempotency"
import { requireAuth } from "@/server/middleware"
import { body, describe, idParam, listParams, pageOf, type Param } from "@/server/openapi"
import { LIMITS, rateLimit } from "@/server/rate-limit"
import { listOrder, listWhere, page, parseList, type ListSpec } from "@/server/rest"

import { ACTIVITY_KINDS, activities } from "./schema"

const tag = "activities"

const spec: ListSpec = {
  table: activities,
  columns: {
    entity_type: activities.entityType,
    entity_id: activities.entityId,
    kind: activities.kind,
    user_id: activities.userId,
    created_at: activities.createdAt,
  },
  id: activities.id,
  defaultSort: "-created_at",
  deletedAt: activities.deletedAt,
}

const row = createSelectSchema(activities)
const input = z
  .object({
    entityType: z.string().min(1),
    entityId: z.string().min(1),
    body: z.string().min(1),
    kind: z.enum(ACTIVITY_KINDS).default("note"),
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
      summary: "List notes and events",
      description: "Scope with `?filter=entity_type:projects;entity_id:<id>`.",
      ok: pageOf(row),
      params: listParams(["entity_type", "entity_id", "kind", "user_id", "created_at"]),
      errors: [400, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)
      const rows = await db
        .select()
        .from(activities)
        .where(listWhere(request, spec))
        .orderBy(...listOrder(request, spec))
        .limit(request.pageSize + 1)
      return c.json(page(rows, request, spec))
    },
  )

  .post(
    "/",
    rateLimit(LIMITS.write),
    describe({ tag, summary: "Post a note", ok: row, okStatus: 201, errors: [409, 422, 429] }),
    body(input),
    idempotent,
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")
      const user = c.get("user")
      const [created] = await db
        .insert(activities)
        .values({ ...values, userId: user.id, userName: user.name })
        .returning()
      return c.json(created, 201)
    },
  )

  .delete(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Delete your own note",
      description: "Only the author may delete a note; anyone else gets a 404.",
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      // 404 rather than 403: whether someone else's note exists is not the
      // caller's business.
      const [deleted] = await db
        .update(activities)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(activities.id, c.req.param("id")),
            eq(activities.userId, c.get("user").id),
            isNull(activities.deletedAt),
          ),
        )
        .returning()
      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )

/**
 * Cross-referenced form: `GET /api/v1/projects/{id}/activities`. The parent is
 * in the path rather than a query parameter, which is what makes it a
 * sub-collection instead of a filter that happens to work.
 */
export const nested = new Hono().use("*", requireAuth).get(
  "/",
  rateLimit(LIMITS.read),
  describe({
    tag,
    summary: "List a record's notes",
    ok: pageOf(row),
    params: [
      {
        name: "parentType",
        in: "path",
        required: true,
        description: "Parent collection, e.g. projects",
        schema: { type: "string" },
      },
      {
        name: "parentId",
        in: "path",
        required: true,
        description: "Parent record id",
        schema: { type: "string" },
      },
      ...listParams(["kind", "user_id", "created_at"]),
    ],
    errors: [400, 429],
  }),
  async (c) => {
    // The mount supplies both, but a handler that trusts its caller is how
    // "/undefined/undefined/activities" quietly returns someone else's notes.
    const parentType = c.req.param("parentType")
    const parentId = c.req.param("parentId")
    if (!parentType || !parentId) {
      return c.json({ error: "Both parentType and parentId are required" }, 400)
    }

    const request = parseList(c, spec)
    const rows = await db
      .select()
      .from(activities)
      .where(
        listWhere(request, spec, [
          eq(activities.entityType, parentType),
          eq(activities.entityId, parentId),
        ]),
      )
      .orderBy(...listOrder(request, spec))
      .limit(request.pageSize + 1)
    return c.json(page(rows, request, spec))
  },
)
