# Testing

Two suites, deliberately different in what they cover.

```bash
pnpm test                          # unit: the conventions layer, ~50 cases, no database
./smoke.sh http://localhost:3000   # end to end: every installed module, real Postgres
```

## `pnpm test` — the conventions layer

Vitest over `src/server/rest.ts`, `rate-limit.ts` and `signing.ts`. These are
where the rules actually live, so a bug here is a bug in every endpoint at once.
They are pure functions with no database, so the suite runs in under a second
and can be left on watch.

`test/rest.test.ts` covers filter parsing, cursor encode/decode, the list
parameter parser, ordering and page assembly. `test/rate-limit.test.ts` drives
the middleware through a real Hono app. `test/signing.test.ts` covers the HMAC
scheme — the pure half was split out of `api-keys.ts` precisely so it could be
tested without a database.

## `./smoke.sh` — the flows

Registers a throwaway account against a running server, exercises the core
flows, then sources every installed module's own `smoke.sh` while signed in, and
signs out. Because the checks live with the modules, the suite always covers
exactly the app you composed — delete a module and its checks go with it.

```
smoke: http://localhost:3000
  ok   health
  ok   register
  -- projects
  ok   projects: create
  ok   projects: unknown sort
  …
all good
```

Writing checks for a module:

```bash
# src/modules/invoices/smoke.sh — sourced with check(), code(), skip(),
# $BASE, $JAR, $H and $RUN already set.
check "invoices: create"      201 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/invoices" -d "$body")"
check "invoices: bad status"  422 "$(code -b "$JAR" "${H[@]}" -X POST "$BASE/api/v1/invoices" -d "$bad")"
```

- `$RUN` is a token unique to this run. **Namespace every fixture with it.**
  Without that, a second run sees the first run's rows and guards appear broken —
  a last-owner check passes only because an earlier run left another owner behind.
- `$H` carries the `Origin` header. Better Auth refuses state-changing requests
  without it.
- `skip "name" "why"` when a check cannot run. It prints, so it is never a
  silent pass.

## What gets tested

Every guard has a check that proves it fires. A suite that only walks happy
paths says nothing about the guards, and the guards are most of the design:

| Rejection                               | Expected                                     |
| --------------------------------------- | -------------------------------------------- |
| Unknown `sort_by` or `filter` field     | `400`, naming the allowed columns            |
| Malformed `pageToken`, `pageSize=0`     | `400`                                        |
| Unknown body field (`.strict()`)        | `422`                                        |
| Blank name, bad enum, negative number   | `422`                                        |
| Same `requestId` twice                  | one record, second response replayed         |
| Reading a soft-deleted record           | `404`, and `200` with `?includeDeleted=true` |
| Someone else's note                     | `404`, not `403`                             |
| Removing a record's last owner          | `409`                                        |
| Moving a folder into its own descendant | `409`                                        |
| A subtask of a subtask                  | `409`                                        |
| Unknown custom action                   | `404`, naming the real ones                  |
| Burst past a rate limit                 | `429` with `Retry-After`                     |

## Running it

`smoke.sh` needs a booted server and a database:

```bash
docker compose up -d db
pnpm db:generate && pnpm db:migrate
pnpm build && pnpm start &
./smoke.sh http://localhost:3000
```

Two things to know:

- **The intake burst check exhausts the public budget** (10/min per IP). Two
  runs inside a minute will see `429`s. Start the server with
  `RATE_LIMIT_PUBLIC=1000` for back-to-back runs; the burst check then reports
  itself skipped rather than passing dishonestly.
- **It is safe against production but leaves an account behind.** Prefer
  staging, or delete the `smoke-*@ziku.dev` user afterwards.

## What is deliberately not tested

No unit tests over route handlers with a mocked database. A mock would assert
that we call Drizzle the way we think we do, which is the part least likely to
be wrong. The things that actually break — a CHECK constraint, a partial unique
index, a transaction boundary, a cursor that skips a row — only fail against a
real Postgres, which is what `smoke.sh` runs against.
