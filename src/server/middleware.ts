import { eq } from "drizzle-orm"
import type { Context, Next } from "hono"

import { verifySignedRequest } from "./api-keys"
import { auth } from "./auth"
import { db } from "./db"
import { user as userTable } from "./db/auth-schema"

export type AppUser = { id: string; email: string; name: string; role: string }

declare module "hono" {
  interface ContextVariableMap {
    user: AppUser
  }
}

/**
 * 401s anything without a caller, and puts them on the context.
 *
 * Two ways in: a session cookie (people) or a signed request (machines). Both
 * resolve to the same user, so a route never cares which was used.
 */
export async function requireAuth(c: Context, next: Next) {
  const signed = await verifySignedRequest(c)
  if (signed.error) return c.json({ error: signed.error }, 401)

  if (signed.ok && signed.userId) {
    const [row] = await db.select().from(userTable).where(eq(userTable.id, signed.userId))
    if (!row) return c.json({ error: "Unauthorized" }, 401)
    c.set("user", { id: row.id, email: row.email, name: row.name, role: row.role ?? "member" })
    return next()
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user) return c.json({ error: "Unauthorized" }, 401)
  const u = session.user as { id: string; email: string; name: string; role?: string }
  c.set("user", { id: u.id, email: u.email, name: u.name, role: u.role ?? "member" })
  await next()
}

/** Use after requireAuth on routes only admins may call. */
export async function requireAdmin(c: Context, next: Next) {
  if (c.get("user")?.role !== "admin") return c.json({ error: "Forbidden" }, 403)
  await next()
}
