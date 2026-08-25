# @ziku/app-template

Starter for client applications. Clone it, keep the features that client needs, delete the rest, ship.

**Stack:** Vite + React SPA, [Hono](https://hono.dev) API, Postgres via [Drizzle](https://orm.drizzle.team), [Better Auth](https://better-auth.com), UI from [`@ziku/ui`](https://github.com/ziku-io/design-system).

One process serves the API and the built client, so a client app is one container plus a database.

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

`pnpm setup` deletes the modules you did not ask for, names the app, writes `.env`
with a fresh secret and the keys your modules need, and regenerates the
registries. Run it with no flags for the interactive picker, or `--modules none`
for auth and an empty shell.

Then: client on `:5173`, API on `:3000`, API reference on `:3000/api/docs`.

## What is always there

Sign up, sign in, sign out, password reset, session guards, an `AppShell` with
sidebar navigation, ⌘K palette, user menu and a settings page. Migrations run on
boot. Every route is in the generated OpenAPI spec.

## Modules

| Module | What it gives you |
|---|---|
| `projects` | Reference CRUD resource, and the worked example of every convention. |
| `tasks` | Assignable work items with one level of subtasks, `:complete` / `:reopen`. |
| `files` | Upload, list, download and delete attachments, scoped to any record. |
| `folders` | A nested tree over `files`, with cycle-safe moves and subtree delete. |
| `contacts` | Named people attached to any record, with one primary each. |
| `assignments` | Who owns or works a record, plus the visibility rule that follows. |
| `activities` | `<ActivityFeed entityType entityId />` — note and event timeline. |
| `tickets` | Threaded request queue with staff-only internal notes. |
| `docrequests` | Ask someone for a specific document; the destination is fixed by the request. |
| `intake` | Hardened public form endpoint: honeypot, rate limit, hashed IPs. |
| `users` | Admin-only user list with role changes. |

```bash
pnpm modules                 # what is installed
pnpm gen:resource invoice    # stamp a new CRUD module, mounted and linked
pnpm remove:module files     # delete one
```

## Docs

| | |
|---|---|
| [rest-standards.md](docs/rest-standards.md) | The twelve rules every endpoint follows, and why |
| [architecture.md](docs/architecture.md) | How the pieces fit, request lifecycle, where state lives |
| [modules.md](docs/modules.md) | The module contract and how to write one |
| [api.md](docs/api.md) | Applying the standards when writing a route |
| [testing.md](docs/testing.md) | The two suites and what each is for |
| [deploying.md](docs/deploying.md) | Docker, env, database per app, uploads, first admin |

The live API reference is at `/api/docs`, generated from the routes actually
mounted — so it always describes the app you built.

## Commands

```bash
pnpm dev            # client + API, with the module registries synced first
pnpm build          # static client + bundled server into dist/
pnpm start          # run the built server
pnpm typecheck
pnpm test           # unit tests over the conventions layer
pnpm format
./smoke.sh http://localhost:3000   # core flows + every installed module
pnpm db:generate    # migration from the current schema
pnpm db:migrate
pnpm db:studio
```

## Auth notes

- Password reset logs the link to the console. Swap `sendResetPassword` in
  `src/server/auth.ts` for a real mailer when a client needs it.
- Better Auth rejects state-changing requests whose `Origin` does not match
  `APP_URL`. Browsers handle this; scripts must send the header.
- New users get `role: "member"`. Promote the first admin with SQL, then use the
  `users` module.
- Regenerate auth tables after changing auth config:
  `pnpm dlx auth@1.7.1 generate --config src/server/auth.ts --output src/server/db/auth-schema.ts`
  Match the CLI version to the installed `better-auth`, or you get a schema
  missing columns.
