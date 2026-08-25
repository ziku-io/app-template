# Architecture

One language, one process, one container per client app.

```
browser ──► Hono (Node)
              ├─ /api/auth/*     Better Auth: sign-up, sign-in, sessions, reset
              ├─ /api/<module>/* mounted from the module registry
              ├─ /api/openapi.json + /api/docs
              └─ everything else → the built Vite SPA
                                   └─► Postgres (Drizzle)
```

## Why one process

The client is a static Vite build. In production Hono serves those files and the
API, so deploying a client app means one container plus a database. In dev the
two split: Vite serves the client on `:5173` with HMR and proxies `/api` to the
API on `:3000`. The proxy target follows `PORT`, so the two cannot drift.

## Request lifecycle

1. `requireAuth` reads the session cookie through Better Auth and puts
   `{ id, email, name, role }` on the context, or answers `401`.
2. `describe(...)` contributes the route to the OpenAPI spec. It is middleware,
   so it costs nothing at request time.
3. `body(schema)` validates the JSON body and answers `422` with one message per
   field. Handlers read the parsed value with `c.req.valid("json")` and never
   parse it themselves.
4. The handler talks to Postgres through Drizzle and returns JSON.

Anything not under `/api/` falls through to the SPA shell, so client-side routes
survive a hard refresh.

## Boot

`runMigrations()` runs before the server listens, so a fresh database needs no
extra step and a deploy cannot serve traffic against an un-migrated schema. With
no `migrations/` directory it warns and continues, which is what a freshly
cloned template does before `pnpm db:generate`.

## Where state lives

| Thing                | Where                                                               |
| -------------------- | ------------------------------------------------------------------- |
| Sessions             | Postgres, via Better Auth's `session` table; cookie holds the token |
| Uploads              | Disk under `UPLOAD_DIR`; only the key is in Postgres                |
| Table views, filters | The browser's `localStorage`, keyed per table                       |
| Everything else      | Postgres                                                            |

Nothing is held in the Node process, so it restarts and scales horizontally
without ceremony. The one exception worth knowing about: uploads are on the
container's disk, so mount a volume or move the three functions in
`src/modules/files/storage.ts` to S3 before running more than one instance.

## Choices worth knowing

**Vite SPA, not a server-rendered framework.** These are apps behind a login
where first-paint SEO is worth nothing. A static client is cheaper to host,
simpler to reason about, and does not move under you every major version.

**Modules over configuration.** Features are folders that get deleted, not flags
that get switched off. A feature a client did not buy leaves no dead code, no
unreachable routes and no orphan tables. See [modules.md](modules.md).

**The spec is generated, not written.** `/api/openapi.json` is assembled from the
routes actually mounted, so it always describes the app you built rather than
the app someone documented once.
