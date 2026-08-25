import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/server/db"
import { requireAuth } from "@/server/middleware"

import { activities } from "./schema"

const body = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  text: z.string().min(1),
  kind: z.string().default("note"),
})

export const routes = new Hono()
  .use("*", requireAuth)

  /** Newest first for one record: `?entityType=project&entityId=…`. */
  .get("/", async (c) => {
    const { entityType, entityId } = c.req.query()
    if (!entityType || !entityId) {
      return c.json({ error: "entityType and entityId are required" }, 422)
    }
    const rows = await db
      .select()
      .from(activities)
      .where(and(eq(activities.entityType, entityType), eq(activities.entityId, entityId)))
      .orderBy(desc(activities.createdAt))
      .limit(200)
    return c.json({ rows, total: rows.length })
  })

  .post("/", async (c) => {
    const parsed = body.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 422)
    const user = c.get("user")
    const [row] = await db
      .insert(activities)
      .values({ ...parsed.data, userId: user.id, userName: user.name })
      .returning()
    return c.json(row, 201)
  })

  /** Only the author may delete, and only their own notes. */
  .delete("/:id", async (c) => {
    const [row] = await db
      .delete(activities)
      .where(and(eq(activities.id, c.req.param("id")), eq(activities.userId, c.get("user").id)))
      .returning()
    return row ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
  })
