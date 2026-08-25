# @ziku/app-template

Starter for client applications. Clone it, keep the modules that client needs,
delete the rest. Vite + React SPA, Hono API, Postgres via Drizzle, Better Auth,
UI from `@ziku/ui`. One process serves the API and the built client.

**This is a template.** Changes here land in every future client app, so prefer
a general fix over a local one, and keep the example modules exemplary — people
copy `src/modules/projects/` as the pattern.

## Verify before claiming done

```bash
pnpm typecheck
pnpm test                          # unit: the conventions layer, no database
pnpm build
./smoke.sh http://localhost:3000   # end to end, needs a booted server + Postgres
```

`smoke.sh` is the real gate. Run it against a **fresh** database, twice, to
prove isolation. See docs/testing.md.

## The rules

**Read [docs/rest-standards.md](docs/rest-standards.md) before touching a
route.** Twelve conventions, implemented once in `src/server/`. The short
version:

- Plural nouns. `basePath` is relative to `/api/v1` (`"/invoices"`, not `"/api/invoices"`).
- Lists: `parseList` + `listWhere` + `listOrder` + `page`, fetching `pageSize + 1`.
  Cursor paging, `sort_by`, `filter=field:value`, all against a `ListSpec` allowlist.
- Soft delete via `deletedAt`, hidden everywhere (**including get-by-id**), with `:restore`.
- `body(schema)` validates and documents. **Never hand-roll `safeParse` in a handler.**
  Inside `actions()` use `actionBody<T>(c)`.
- `describe({...})` on every route, `rateLimit(LIMITS.x)` on every route.
- `idempotent` after `body()` on creates.

**Negative space programming is not optional here:**

- Every input schema ends in `.strict()`. An unknown field is a `422`.
- Every enum, range and not-blank rule is a Postgres `CHECK` as well as a zod
  rule. Validation can be bypassed by a migration or a psql session; a
  constraint cannot.
- Unknown sort/filter/action → `4xx` **naming what is allowed**. Never a silent
  fallback to a default.
- `404` over `403` for records the caller may not see.
- No empty `catch {}`. If a fallback would hide a bug, throw.
- **Every guard gets a smoke check that proves it fires.**

## Modules

A module is a folder under `src/modules/` owning its tables, routes, pages and
nav. `pnpm modules:sync` writes the registries; nothing references modules by
name.

```bash
pnpm modules                 # what is installed
pnpm gen:resource invoice    # stamp a new module, mounted and linked
pnpm remove:module files
pnpm db:generate && pnpm db:migrate   # after anything with tables
```

- **`module.json`'s `id` must equal the folder name**, lowercase letters and
  digits — it is both the import path and the import identifier in the generated
  registries. `modules:sync` throws otherwise. This is why document-requests
  lives in `docrequests/` while its path stays `/api/v1/document-requests`.
- **Never edit `*.generated.ts`.** Re-run `modules:sync`.
- Namespace table names after the module; the schema barrel merges them all.
- Cross-referenced sub-collections go in `extraMounts`, not query parameters.

Full contract in [docs/modules.md](docs/modules.md).

## Gotchas

**The template ships no `migrations/`.** They would create tables for modules
the app deleted. `setup` clears them; the app generates its own first migration.
A generated client app *does* commit its migrations.

**Client paths must not repeat the version.** `API_BASE` is already `/api/v1`,
so call `get("/projects")`, not `get("/v1/projects")`.

**Better Auth's CLI is the `auth` package now**, and the version must match the
installed `better-auth`. `npx @better-auth/cli` silently installs a deprecated
1.4.x that generates a schema missing columns:
```bash
pnpm dlx auth@1.7.1 generate --config src/server/auth.ts --output src/server/db/auth-schema.ts
```

**Better Auth rejects state-changing requests whose `Origin` does not match
`APP_URL`.** Browsers send it; scripts must (`smoke.sh` does).

**`@ziku/ui` is a private git dependency**, so Docker builds need
`docker build --ssh default`.

**Rate limits are per process and env-tunable** (`RATE_LIMIT_READ` etc.). The
intake smoke check deliberately exhausts the public budget, so back-to-back runs
need `RATE_LIMIT_PUBLIC` raised — it then reports itself skipped.

## Layout

```
src/server/     auth, db, middleware, rest.ts (the conventions), openapi.ts,
                rate-limit.ts, idempotency.ts, signing.ts, api-keys.ts
src/client/     routing, the signed-in shell, auth pages, settings
src/modules/    features, plus the generated registries
scripts/        setup, sync, module list/remove, resource generator
test/           unit tests over the conventions layer
docs/           rest-standards, architecture, modules, api, testing, deploying
```

The live API reference is at `/api/docs`, generated from the routes actually
mounted — so it always describes the app you built.
