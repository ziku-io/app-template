import { readFile } from "node:fs/promises"

import { Scalar } from "@scalar/hono-api-reference"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { openAPIRouteHandler } from "hono-openapi"
import { z } from "zod"

import { serverModules } from "@/modules/server.generated"

import { auth } from "./auth"
import { runMigrations } from "./db/migrate"
import { requireAuth } from "./middleware"
import { describe } from "./openapi"

const app = new Hono()

app.get(
  "/api/health",
  describe({
    tag: "core",
    summary: "Liveness probe",
    public: true,
    ok: z.object({ ok: z.boolean() }),
  }),
  (c) => c.json({ ok: true }),
)

// Better Auth owns every /api/auth/* route: sign-up, sign-in, sign-out,
// session, password reset.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))

app.get(
  "/api/me",
  describe({
    tag: "core",
    summary: "The signed-in user",
    ok: z.object({
      id: z.string(),
      email: z.string(),
      name: z.string(),
      role: z.string(),
    }),
  }),
  requireAuth,
  (c) => c.json(c.get("user")),
)

// Installed modules, in whatever order the registry lists them.
for (const m of serverModules) app.route(m.basePath, m.routes)

// ── Documentation ───────────────────────────────────────────────────
// Generated from the routes actually mounted, so the spec always matches the
// modules this app was built with. Auth routes come from Better Auth and are
// documented at https://better-auth.com instead.
app.get(
  "/api/openapi.json",
  openAPIRouteHandler(app, {
    documentation: {
      info: {
        title: `${process.env.APP_NAME ?? "App"} API`,
        version: "1.0.0",
        description:
          "Every list endpoint takes `q`, `sort`, `limit` and `offset`, and answers `{ rows, total }`.\n\n" +
          "Sessions are cookie-based. Sign in through `/api/auth/*` (Better Auth) first.",
      },
      servers: [{ url: process.env.APP_URL ?? "http://localhost:3000", description: "This app" }],
    },
  }),
)

app.get("/api/docs", Scalar({ url: "/api/openapi.json", pageTitle: "API reference" }))

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
      ` — modules: ${serverModules.map((m) => m.id).join(", ") || "none"}` +
      `\n  API reference: http://localhost:${info.port}/api/docs`,
  )
})
