import { and, eq, ilike, isNull, or, type SQL } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono } from "hono"
import { z } from "zod"

import { db } from "@/server/db"
import { idempotent } from "@/server/idempotency"
import { requireAuth } from "@/server/middleware"
import { body, describe, idParam, listParams, pageOf } from "@/server/openapi"
import { LIMITS, rateLimit } from "@/server/rate-limit"
import { actions, listOrder, listWhere, page, parseList, type ListSpec } from "@/server/rest"

import { PROJECT_STATUSES, projects } from "./schema"

/**
 * The reference module. Every convention in docs/rest-standards.md shows up
 * here: plural noun, cursor paging, allowlisted sort and filter, soft delete,
 * idempotent create, rate limits.
 */

const tag = "projects"

/** Sortable and filterable columns, by the name callers use. */
const spec: ListSpec = {
  table: projects,
  columns: {
    name: projects.name,
    client: projects.client,
    status: projects.status,
    budget: projects.budget,
    created_at: projects.createdAt,
  },
  id: projects.id,
  defaultSort: "-created_at",
  searchable: [projects.name, projects.client],
  deletedAt: projects.deletedAt,
}

const row = createSelectSchema(projects)
// .strict(): an unknown field is a typo or a stale client, and either way the
// caller deserves a 422 rather than a silently ignored value.
const input = z
  .object({
    name: z.string().min(1),
    client: z.string().min(1),
    status: z.enum(PROJECT_STATUSES),
    budget: z.number().int().min(0),
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
      summary: "List projects",
      description: "Cursor-paged. Follow `nextPageToken` until it is null.",
      ok: pageOf(row),
      params: listParams(["name", "client", "status", "budget", "created_at"]),
      errors: [400, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)

      const search = request.q
        ? or(...spec.searchable!.map((column) => ilike(column, `%${request.q}%`)))
        : undefined

      const rows = await db
        .select()
        .from(projects)
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
      summary: "Create a project",
      description: "Send a `requestId` to make the call safe to retry.",
      ok: row,
      okStatus: 201,
      errors: [409, 422, 429],
    }),
    body(input),
    idempotent,
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")
      const [created] = await db
        .insert(projects)
        .values({ ...values, ownerId: c.get("user").id })
        .returning()
      return c.json(created, 201)
    },
  )

  .get(
    "/:id",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "Get a project",
      description: "Soft-deleted rows are 404 unless `?includeDeleted=true`.",
      ok: row,
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      // A soft delete has to hide the row everywhere, not just in lists —
      // otherwise "deleted" only means "harder to find".
      const includeDeleted = c.req.query("includeDeleted") === "true"
      const [found] = await db
        .select()
        .from(projects)
        .where(
          includeDeleted
            ? eq(projects.id, c.req.param("id"))
            : and(eq(projects.id, c.req.param("id")), isNull(projects.deletedAt)),
        )
      return found ? c.json(found) : c.json({ error: "Not found" }, 404)
    },
  )

  .patch(
    "/:id",
    rateLimit(LIMITS.write),
    describe({ tag, summary: "Update a project", ok: row, params: [idParam], errors: [404, 422] }),
    body(input.partial()),
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")
      const [updated] = await db
        .update(projects)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(projects.id, c.req.param("id")), isNull(projects.deletedAt)))
        .returning()
      return updated ? c.json(updated) : c.json({ error: "Not found" }, 404)
    },
  )

  /**
   * Custom actions live behind a verb rather than a magic PATCH field:
   * `POST /v1/projects/{id}:restore`.
   */
  .post(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Run an action on a project",
      description: "Currently `:restore`, which undoes a soft delete.",
      ok: row,
      params: [{ ...idParam, description: "Record id followed by `:action`, e.g. `abc:restore`" }],
      errors: [404],
    }),
    actions("id", {
      restore: async (c, id) => {
        const [restored] = await db
          .update(projects)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(projects.id, id))
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
      summary: "Delete a project",
      description: "Soft delete: the row is kept and hidden. Restore with `:restore`.",
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      const [deleted] = await db
        .update(projects)
        .set({ deletedAt: new Date() })
        .where(and(eq(projects.id, c.req.param("id")), isNull(projects.deletedAt)))
        .returning()
      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )
