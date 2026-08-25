import { Hono } from "hono"
import { asc, eq } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/server/db"
import { user } from "@/server/db/auth-schema"
import { requireAdmin, requireAuth } from "@/server/middleware"

const ROLES = ["admin", "member"] as const
const body = z.object({ role: z.enum(ROLES) })

export const routes = new Hono()
  .use("*", requireAuth, requireAdmin)

  .get("/", async (c) => {
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
  })

  .patch("/:id", async (c) => {
    const parsed = body.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 422)

    const id = c.req.param("id")
    // Locking yourself out of the admin pages is not a recoverable mistake.
    if (id === c.get("user").id && parsed.data.role !== "admin") {
      return c.json({ error: "You cannot remove your own admin role." }, 409)
    }

    const [row] = await db
      .update(user)
      .set({ role: parsed.data.role })
      .where(eq(user.id, id))
      .returning({ id: user.id, name: user.name, email: user.email, role: user.role })
    return row ? c.json(row) : c.json({ error: "Not found" }, 404)
  })
