import type { Context, Next } from "hono"

import { auth } from "./auth"

export type AppUser = { id: string; email: string; name: string; role: string }

declare module "hono" {
  interface ContextVariableMap {
    user: AppUser
  }
}

/** 401s anything without a session, and puts the user on the context. */
export async function requireAuth(c: Context, next: Next) {
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
