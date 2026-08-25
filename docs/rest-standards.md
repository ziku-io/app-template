# REST standards

Twelve rules every endpoint follows. They are implemented once in
`src/server/rest.ts`, `openapi.ts`, `rate-limit.ts`, `idempotency.ts` and
`signing.ts` — a module gets them by using those helpers, not by remembering
them.

## 1. Resource names are nouns

`GET /v1/carts/123`, never `GET /v1/queryCarts/123`. The method is the verb; the
path is the thing. A path with a verb in it always grows a second verb later.

## 2. Collections are plural

`GET /v1/carts/123`, never `/v1/cart/123`. One rule means a caller never has to
guess. The `activity` module was renamed to `activities` for exactly this.

## 3. Creates are idempotent

```http
POST /v1/projects
{ "name": "…", "requestId": "a1b2c3d4" }
```

Send a `requestId` and the first response is stored against it; a retry replays
that response with an `Idempotent-Replay: true` header instead of creating a
second record. Without it a client that times out has no safe way to retry.

Implemented by the `idempotent` middleware, backed by the `idempotency_keys`
table. Reusing an id on a different endpoint is a `409` — an id identifies one
intended call, not a nonce. Only 2xx responses are stored: a 500 should stay
retryable.

## 4. The version comes first

`/api/v1/carts/123`, not `/api/carts/v1/123`. The version qualifies the whole
API, so it sits at the root and everything moves together. `/api/health` is the
one exception and stays unversioned — a liveness probe should not break when
the API version moves.

Modules declare `basePath: "/projects"` and are mounted under `/api/v1`.

## 5. Deletes are soft, and the deleted are askable-for

`DELETE` stamps `deletedAt`. Lists hide those rows; `?includeDeleted=true` brings
them back. `POST /v1/projects/{id}:restore` undoes it.

A hard delete throws away the answer to "what happened to that record", which is
a question every client eventually asks. Purging is a housekeeping job, not a
request handler.

## 6. Pagination is a cursor, not an offset

```http
GET /v1/projects?pageSize=50
→ { "rows": [ … ], "nextPageToken": "eyJ2…" }
GET /v1/projects?pageToken=eyJ2…
```

Follow `nextPageToken` until it comes back `null`. Offset paging skips and
repeats rows when the table is written to mid-scroll, and makes Postgres walk
everything it skips. The cursor is keyset, on `(sort column, id)` — the id
tiebreaker is what makes the order total, so no row can straddle a page.

The token is opaque: it is a base64 cursor today and its shape is ours to
change. `pageSize` defaults to 50 and caps at 200. **`pageSize=0` is a `400`,
not a silent default** — an unusable value is a caller bug worth surfacing.

There is deliberately no `total`. Counting the whole set on every page is
expensive and, under concurrent writes, wrong by the time it is read.

## 7. Sorting is `sort_by`, against an allowlist

`?sort_by=name`, `?sort_by=-created_at` for descending. The allowlist lives in
the module's `ListSpec`; an unknown column is a `400` that names the allowed
ones. A caller must never be able to sort by a column we did not offer, both
because it may not be indexed and because the error message is a free schema
dump.

## 8. Filtering is `filter=field:value`

`?filter=status:Lead,Active` — commas are OR within a field. Separate fields are
AND, either `?filter=status:Lead;client:Acme` or a repeated `filter` parameter.
Same allowlist, same `400`.

`?q=` stays separate: free-text search over whichever columns the module marks
searchable, which is a different thing from filtering a column to a value.

## 9. Machine callers sign their requests

```http
X-API-KEY: ak_…
X-EXPIRY: 1800000000
X-REQUEST-SIGNATURE: <hmac-sha256 hex>
```

The signature covers `METHOD\npath\nquery\nexpiry\nbody`. A bare key in a header
is a bearer token — read it once and you can replay anything, forever. Signed,
a captured request expires and cannot be edited. Expiries more than 5 minutes
ahead are refused so one capture cannot be replayed indefinitely.

Secrets are stored hashed and shown once. `requireAuth` accepts either a signed
request or a session cookie, so a route never cares which it got.

## 10. Related resources are paths, not query parameters

`GET /v1/projects/123/files/456`, not `GET /v1/files/456?project=123`. The path
says the file belongs to the project; the query string only says you would like
them compared.

Modules expose these through `extraMounts`, e.g. `files` serves
`/v1/{parentType}/{parentId}/files` for any parent.

## 11. Actions that are not CRUD get a verb

`POST /v1/projects/{id}:restore`, `POST /v1/tasks/{id}:complete`,
`POST /v1/carts/{id}/items:add`.

A verb that is not create/read/update/delete gets its own name rather than a
magic field in a PATCH body, so it can have its own permissions, its own
validation and its own audit line. Use the `actions()` helper; an unknown verb
is a `404` naming the real ones.

## 12. Everything is rate limited

Budgets are per caller (user when signed in, IP otherwise) and per group, so a
noisy read loop cannot starve writes:

| Group    | Budget       |
| -------- | ------------ |
| `read`   | 600 / minute |
| `write`  | 120 / minute |
| `upload` | 30 / minute  |
| `public` | 10 / minute  |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`;
a `429` adds `Retry-After`. Counters are per process, which is right for one
container per app — move the map to Redis the day an app runs two.

## Negative space

The rules above are mostly about what a request may _not_ do. That is deliberate,
and it extends into the code:

- **Allowlists, never denylists.** Unknown sort field, filter field, action or
  enum value is a `4xx` naming what is allowed. Never a silent fallback.
- **Strict bodies.** Every input schema is `.strict()`, so an unknown field is a
  `422`. A typo'd field name that gets silently dropped is a bug that ships.
- **Constraints in the database.** Every enum, range and not-blank rule is a
  `CHECK`, not only a zod rule. Validation can be bypassed by a migration, a
  fixture or a psql session; a constraint cannot.
- **`404` over `403`** for records the caller may not see. Telling someone a
  record exists is itself a leak.
- **No empty catches.** If a fallback would hide a bug, throw instead.

Every guard has a test that proves it fires. See [testing.md](testing.md).
