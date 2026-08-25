import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { createSelectSchema } from "drizzle-zod"

import { db } from "@/server/db"
import { requireAuth } from "@/server/middleware"
import { body, describe, idParam, listOf, type Param } from "@/server/openapi"

import { activities } from "./schema"

const tag = "activity"
const row = createSelectSchema(activities)
const scope: Param[] = [
  {
    name: "entityType",
    in: "query",
    required: true,
    description: 'What it hangs off, e.g. "project"',
    schema: { type: "string" },
  },
  {
    name: "entityId",
    in: "query",
    required: true,
    description: "Id of that record",
    schema: { type: "string" },
  },
]

const input = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  text: z.string().min(1),
  kind: z.string().default("note"),
})

export const routes = new Hono()
  .use("*", requireAuth)

  /** Newest first for one record: `?entityType=project&entityId=…`. */
  .get(
    "/",
    describe({
      tag,
      summary: "List notes on one record",
      ok: listOf(row),
      params: scope,
      errors: [422],
    }),
    async (c) => {
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
    },
  )

  .post(
    "/",
    describe({
      tag,
      summary: "Post a note",
      ok: row,
      okStatus: 201,
      errors: [422],
    }),
    body(input),
    async (c) => {
      const user = c.get("user")
      const [created] = await db
        .insert(activities)
        .values({
          ...c.req.valid("json"),
          userId: user.id,
          userName: user.name,
        })
        .returning()
      return c.json(created, 201)
    },
  )

  .delete(
    "/:id",
    describe({
      tag,
      summary: "Delete your own note",
      description: "Only the author may delete a note.",
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      const [deleted] = await db
        .delete(activities)
        .where(and(eq(activities.id, c.req.param("id")), eq(activities.userId, c.get("user").id)))
        .returning()
      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )
