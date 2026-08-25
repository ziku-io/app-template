import { readFile } from "node:fs/promises"

import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"

import { serverModules } from "@/modules/server.generated"

import { auth } from "./auth"
import { runMigrations } from "./db/migrate"
import { requireAuth } from "./middleware"

const app = new Hono()

app.get("/api/health", (c) => c.json({ ok: true }))

// Better Auth owns every /api/auth/* route: sign-up, sign-in, sign-out,
// session, password reset.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))

app.get("/api/me", requireAuth, (c) => c.json(c.get("user")))

// Installed modules, in whatever order the registry lists them.
for (const m of serverModules) app.route(m.basePath, m.routes)

// One process serves the API and the built client, so a client app is one
// container. In dev, Vite serves the client and proxies /api here instead.
const assets = serveStatic({ root: "./dist/client" })
app.use("/assets/*", assets)
app.use("/favicon.ico", assets)

// Read once: the SPA shell is the fallback for every non-API path, so client
// routes survive a hard refresh.
const shell = await readFile("./dist/client/index.html", "utf8").catch(() => null)

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404)
  if (!shell) return c.text("Client not built. Run `pnpm build:web`.", 500)
  return c.html(shell)
})

const port = Number(process.env.PORT) || 3000

await runMigrations()
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `listening on http://localhost:${info.port}` +
      ` — modules: ${serverModules.map((m) => m.id).join(", ") || "none"}`
  )
})
