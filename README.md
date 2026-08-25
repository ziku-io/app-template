# @ziku/app-template

Starter for client applications. TypeScript throughout, one process per app, self-hosted.

**Stack:** Vite + React SPA, [Hono](https://hono.dev) API, Postgres via [Drizzle](https://orm.drizzle.team), [Better Auth](https://better-auth.com), UI from [`@ziku/ui`](https://github.com/ziku-io/design-system).

In production a single Hono process serves the API and the built client, so a client app is one container plus a database.

## What you get

- Sign up, sign in, sign out, password reset, session guards on the API
- An `AppShell` layout with sidebar navigation, ⌘K command palette and user menu
- A CRUD resource (`projects`) whose list page is a `DataTable` with filters, sorting, grouping and saved views
- Migrations that run on boot, so a fresh database needs no extra step
- `pnpm gen:resource <name>` to stamp the next resource
- `./smoke.sh` to prove the whole thing still works

## Start

```bash
pnpm install
cp .env.example .env          # then set BETTER_AUTH_SECRET
docker compose up -d db       # or point DATABASE_URL at an existing Postgres
pnpm db:generate && pnpm db:migrate
pnpm dev                      # client on :5173, API on :3000
```

`pnpm dev` runs Vite and the API together; Vite proxies `/api` to the API port. In production only the API process runs.

## Adding a resource

```bash
pnpm gen:resource invoice
```

Writes the Drizzle table, the API routes and a list page, then tells you the two lines to add (mount the routes, add the client route) and the migration command. Everything it generates is ordinary code meant to be edited.

## Layout

```
src/server/
  index.ts            Hono app: auth mount, API routes, static client, SPA fallback
  auth.ts             Better Auth config
  middleware.ts       requireAuth / requireAdmin
  db/schema.ts        your tables (auth tables live in auth-schema.ts)
  db/migrate.ts       runs on boot and from pnpm db:migrate
  routes/projects.ts  the example resource
src/client/
  App.tsx             routing and the signed-in shell
  pages/auth.tsx      login, register, forgot password
  pages/projects.tsx  list + create dialog
  lib/api.ts          fetch wrapper
  lib/auth-client.ts  Better Auth React client
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

`DataTable` currently filters and sorts in the browser over the rows it was given, which is right up to a few thousand. Beyond that, wire the query parameters above to the table's `onStateChange`.

## Auth notes

- Password reset logs the link to the console. Swap `sendResetPassword` in `src/server/auth.ts` for a real mailer when a client needs it.
- Better Auth rejects state-changing requests whose `Origin` does not match `APP_URL`. Browsers handle this; scripts must send the header.
- New users get `role: "member"`. Promote with SQL, and gate routes with `requireAdmin`.
- Regenerate auth tables after changing auth config:
  `pnpm dlx auth@1.7.1 generate --config src/server/auth.ts --output src/server/db/auth-schema.ts`
  Match the CLI version to the installed `better-auth`, or you get a schema that is missing columns.

## Deploying

`@ziku/ui` is a private git dependency, so the image build needs SSH:

```bash
docker build --ssh default -t my-client-app .
docker compose build --ssh default
```

On Coolify or Dokploy, add a deploy key for `ziku-io/design-system` and enable SSH forwarding for the build. Making the design system public, or publishing it to GitHub Packages, removes this step.

Set `DATABASE_URL`, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `APP_URL` to the public origin. One Postgres with a database per client app is usually enough.

## Checks

```bash
pnpm typecheck
./smoke.sh http://localhost:3000   # register → CRUD → sign out, 16 checks
```
