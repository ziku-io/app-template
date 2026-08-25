import { readFile } from "node:fs/promises"

import { Scalar } from "@scalar/hono-api-reference"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { Hono } from "hono"
import { openAPIRouteHandler } from "hono-openapi"

import { API_VERSION, BadRequest } from "./rest"
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

// Everything versioned lives here. `/api/health` stays outside on purpose:
// a probe should not break when the API version moves.
const v1 = new Hono()

v1.get(
  "/me",
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

for (const m of serverModules) {
  v1.route(m.basePath, m.routes)
  // Cross-referenced sub-collections, e.g. /api/v1/projects/{id}/files.
  for (const mount of m.extraMounts ?? []) v1.route(mount.path, mount.routes)
}

app.route(`/api/${API_VERSION}`, v1)

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
          "Lists are cursor-paged: `?pageSize=&pageToken=`, answering `{ rows, nextPageToken }`.\n\n" +
          "Sort with `?sort_by=name` (`-` prefixes descending) and filter with `?filter=status:Lead,Active`.\n\n" +
          "Deletes are soft; `?includeDeleted=true` brings the rows back into a list.\n\n" +
          "Sign in through `/api/auth/*` (Better Auth) for a cookie session, or sign requests with an API key.",
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

/**
 * One place where a thrown error becomes a response. Without this a guard that
 * throws BadRequest would surface as a 500, which reads as "our fault" when it
 * is the request that is wrong.
 */
app.onError((error, c) => {
  if (error instanceof BadRequest) return c.json({ error: error.message }, 400)
  // Anything unrecognised is genuinely ours: log it, and never leak the detail.
  console.error("[unhandled]", error)
  return c.json({ error: "Internal error" }, 500)
})

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
