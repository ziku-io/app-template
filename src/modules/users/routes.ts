import { Hono } from "hono"
import { asc, eq } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/server/db"
import { user } from "@/server/db/auth-schema"
import { requireAdmin, requireAuth } from "@/server/middleware"
import { body, describe, idParam, listOf } from "@/server/openapi"

const tag = "users"
const ROLES = ["admin", "member"] as const
const input = z.object({ role: z.enum(ROLES) })
const row = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.date(),
})

export const routes = new Hono()
  .use("*", requireAuth, requireAdmin)

  .get(
    "/",
    describe({
      tag,
      summary: "List everyone",
      description: "Admins only.",
      ok: listOf(row),
      errors: [403],
    }),
    async (c) => {
      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt,
        })
        .from(user)
        .orderBy(asc(user.name))
        .limit(1000)
      return c.json({ rows, total: rows.length })
    },
  )

  .patch(
    "/:id",
    describe({
      tag,
      summary: "Change someone's role",
      description: "Admins only. You cannot remove your own admin role.",
      ok: row.pick({ id: true, name: true, email: true, role: true }),
      params: [idParam],
      errors: [403, 404, 409, 422],
    }),
    body(input),
    async (c) => {
      const id = c.req.param("id")
      // Locking yourself out of the admin pages is not a recoverable mistake.
      if (id === c.get("user").id && c.req.valid("json").role !== "admin") {
        return c.json({ error: "You cannot remove your own admin role." }, 409)
      }

      const [updated] = await db
        .update(user)
        .set({ role: c.req.valid("json").role })
        .where(eq(user.id, id))
        .returning({ id: user.id, name: user.name, email: user.email, role: user.role })
      return updated ? c.json(updated) : c.json({ error: "Not found" }, 404)
    },
  )
