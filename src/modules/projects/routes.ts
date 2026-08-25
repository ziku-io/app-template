import { Hono } from "hono"
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { z } from "zod"

import { db } from "@/server/db"
import { requireAuth } from "@/server/middleware"
import { body, describe, idParam, listOf, listQuery } from "@/server/openapi"

import { PROJECT_STATUSES, projects } from "./schema"

const columns = {
  name: projects.name,
  client: projects.client,
  status: projects.status,
  budget: projects.budget,
  createdAt: projects.createdAt,
}

const row = createSelectSchema(projects)
const input = z.object({
  name: z.string().min(1),
  client: z.string().min(1),
  status: z.enum(PROJECT_STATUSES),
  budget: z.number().int().min(0),
})

const tag = "projects"

export const routes = new Hono()
  .use("*", requireAuth)

  .get(
    "/",
    describe({
      tag,
      summary: "List projects",
      description: "`?status=Lead,Active` filters by status.",
      ok: listOf(row),
      params: [
        ...listQuery,
        {
          name: "status",
          in: "query",
          description: "Comma-separated statuses",
          schema: { type: "string" },
        },
      ],
    }),
    async (c) => {
      const { q, sort, status, limit, offset } = c.req.query()

      const where: SQL[] = []
      if (q) {
        const like = `%${q}%`
        where.push(or(ilike(projects.name, like), ilike(projects.client, like))!)
      }
      if (status) where.push(inArray(projects.status, status.split(",")))

      const descending = sort?.startsWith("-")
      const key = (descending ? sort!.slice(1) : sort) as keyof typeof columns
      const column = columns[key] ?? projects.createdAt

      const filter = where.length ? and(...where) : undefined
      const [rows, [total]] = await Promise.all([
        db
          .select()
          .from(projects)
          .where(filter)
          .orderBy(descending ? desc(column) : asc(column))
          .limit(Math.min(Number(limit) || 500, 1000))
          .offset(Number(offset) || 0),
        db.select({ n: count() }).from(projects).where(filter),
      ])

      return c.json({ rows, total: total.n })
    },
  )

  .post(
    "/",
    describe({ tag, summary: "Create a project", ok: row, okStatus: 201, errors: [422] }),
    body(input),
    async (c) => {
      const [created] = await db
        .insert(projects)
        .values({ ...c.req.valid("json"), ownerId: c.get("user").id })
        .returning()
      return c.json(created, 201)
    },
  )

  .patch(
    "/:id",
    describe({ tag, summary: "Update a project", ok: row, params: [idParam], errors: [404, 422] }),
    body(input.partial()),
    async (c) => {
      const [updated] = await db
        .update(projects)
        .set({ ...c.req.valid("json"), updatedAt: new Date() })
        .where(eq(projects.id, c.req.param("id")))
        .returning()
      return updated ? c.json(updated) : c.json({ error: "Not found" }, 404)
    },
  )

  .delete(
    "/:id",
    describe({ tag, summary: "Delete a project", params: [idParam], errors: [404] }),
    async (c) => {
      const [deleted] = await db
        .delete(projects)
        .where(eq(projects.id, c.req.param("id")))
        .returning()
      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )
