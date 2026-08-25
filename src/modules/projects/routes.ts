import { Hono } from "hono"
import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/server/db"
import { requireAuth } from "@/server/middleware"

import { PROJECT_STATUSES, projects } from "./schema"

const columns = { name: projects.name, client: projects.client, status: projects.status, budget: projects.budget, createdAt: projects.createdAt }

const body = z.object({
  name: z.string().min(1),
  client: z.string().min(1),
  status: z.enum(PROJECT_STATUSES),
  budget: z.number().int().min(0),
})

export const routes = new Hono()
  .use("*", requireAuth)

  /** List. `?q=` searches, `?sort=name` / `?sort=-budget` orders, `?status=a,b`
   *  filters, `?limit=&offset=` pages. Returns `{ rows, total }`. */
  .get("/", async (c) => {
    const { q, sort, status, limit, offset } = c.req.query()

    const where: SQL[] = []
    if (q) {
      const like = `%${q}%`
      where.push(or(ilike(projects.name, like), ilike(projects.client, like))!)
    }
    if (status) where.push(inArray(projects.status, status.split(",")))

    const desc_ = sort?.startsWith("-")
    const key = (desc_ ? sort!.slice(1) : sort) as keyof typeof columns
    const column = columns[key] ?? projects.createdAt

    const filter = where.length ? and(...where) : undefined
    const [rows, [total]] = await Promise.all([
      db
        .select()
        .from(projects)
        .where(filter)
        .orderBy(desc_ ? desc(column) : asc(column))
        .limit(Math.min(Number(limit) || 500, 1000))
        .offset(Number(offset) || 0),
      db.select({ n: count() }).from(projects).where(filter),
    ])

    return c.json({ rows, total: total.n })
  })

  .post("/", async (c) => {
    const parsed = body.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 422)
    const [row] = await db
      .insert(projects)
      .values({ ...parsed.data, ownerId: c.get("user").id })
      .returning()
    return c.json(row, 201)
  })

  .patch("/:id", async (c) => {
    const parsed = body.partial().safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 422)
    const [row] = await db
      .update(projects)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(projects.id, c.req.param("id")))
      .returning()
    return row ? c.json(row) : c.json({ error: "Not found" }, 404)
  })

  .delete("/:id", async (c) => {
    const [row] = await db.delete(projects).where(eq(projects.id, c.req.param("id"))).returning()
    return row ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
  })
