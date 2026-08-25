# @ziku/app-template

Starter for client applications. Clone it, keep the features that client needs, delete the rest, ship.

**Stack:** Vite + React SPA, [Hono](https://hono.dev) API, Postgres via [Drizzle](https://orm.drizzle.team), [Better Auth](https://better-auth.com), UI from [`@ziku/ui`](https://github.com/ziku-io/design-system).

In production a single Hono process serves the API and the built client, so a client app is one container plus a database.

## One-shot a new app

```bash
git clone git@github.com:ziku-io/app-template.git acme-portal && cd acme-portal
rm -rf .git && git init
pnpm install
pnpm setup --name acme-portal --modules projects,files
docker compose up -d db
pnpm db:generate && pnpm db:migrate
pnpm dev
```

`pnpm setup` deletes the modules you did not ask for, names the app, writes `.env` with a fresh secret and the env keys your modules need, and regenerates the registries. Run it with no flags for the interactive version, or `--modules none` for auth and an empty shell.

## What is always there

Sign up, sign in, sign out, password reset, session guards, an `AppShell` with sidebar navigation, ⌘K palette, user menu and a settings page. Migrations run on boot.

## Modules

A module is a folder under `src/modules/` owning its tables, routes, pages and nav entries. Nothing references modules by name: `pnpm modules:sync` writes the registries the server and client import, so adding or deleting a folder is the whole operation.

| Module | What it gives you |
|---|---|
| `projects` | Example CRUD resource: table with filters, saved views, create dialog. A pattern to copy or delete. |
| `files` | Upload, list, download and delete attachments. Local disk by default, scoped to any record. |
| `activity` | `<ActivityFeed entityType entityId />` — a note and event timeline to drop on a detail page. |
| `users` | Admin-only user list with role changes. |

```bash
pnpm modules                 # what is installed
pnpm remove:module files     # delete one
pnpm gen:resource invoice    # stamp a new CRUD module, already mounted and linked
```

After adding or removing anything with tables: `pnpm db:generate && pnpm db:migrate`.

### Writing one

```
src/modules/<id>/
  module.json    id, title, description, requires, env, dependencies
  schema.ts      Drizzle tables
  routes.ts      Hono routes
  server.ts      export default { id, basePath, routes }
  page.tsx       the page
  client.tsx     export default { id, nav, routes }
  smoke.sh       optional checks, picked up by ./smoke.sh
```

Any of those files may be omitted. `activity` has no page and no nav entry because it is a component other pages embed; `users` marks its nav and route `roles: ["admin"]` so members never see it.

Import across the app with `@/server/...` and `@/client/...`. A module may depend on another through `requires` in its manifest; setup pulls those in and `remove:module` refuses to break them.

## Layout

```
src/server/     auth, db, middleware, and the entry that mounts installed modules
src/client/     routing, the signed-in shell, auth pages, settings
src/modules/    features (see above) plus the generated registries
scripts/        setup, sync, module list/remove, resource generator
```

## API conventions

Every list endpoint takes the same query parameters, so the client stays uniform:

| Parameter | Meaning |
|---|---|
| `q` | free-text search |
| `sort` | column name, `-` prefix for descending |
| `limit` / `offset` | paging, capped at 1000 |
| *field*`=a,b` | filter by a comma-separated list |

Responses are `{ rows, total }`. Mutations return the row (`201`/`200`), `204` on delete, `422` with per-field errors on a bad body.

`DataTable` filters and sorts in the browser over the rows it was given, which is right up to a few thousand. Beyond that, wire the parameters above to the table's `onStateChange`.

## Auth notes

- Password reset logs the link to the console. Swap `sendResetPassword` in `src/server/auth.ts` for a real mailer when a client needs it.
- Better Auth rejects state-changing requests whose `Origin` does not match `APP_URL`. Browsers handle this; scripts must send the header.
- New users get `role: "member"`. Promote the first admin with SQL, then use the `users` module.
- Regenerate auth tables after changing auth config:
  `pnpm dlx auth@1.7.1 generate --config src/server/auth.ts --output src/server/db/auth-schema.ts`
  Match the CLI version to the installed `better-auth`, or you get a schema missing columns.

## Deploying

`@ziku/ui` is a private git dependency, so the image build needs SSH:

```bash
docker build --ssh default -t acme-portal .
docker compose build --ssh default
```

On Coolify or Dokploy, add a deploy key for `ziku-io/design-system` and enable SSH forwarding for the build. Making the design system public, or publishing it to GitHub Packages, removes this step.

Set `DATABASE_URL`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `APP_URL` to the public origin. One Postgres with a database per client app is usually enough.

## Checks

```bash
pnpm typecheck
./smoke.sh http://localhost:3000
```

`smoke.sh` runs the core flows — register, session, sign-out, SPA fallback — then sources every installed module's own checks, so it always covers exactly the app you built.
