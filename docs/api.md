# API conventions

The rules themselves are in **[rest-standards.md](rest-standards.md)**. This page
is how you apply them when writing a route.

The live reference is at **`/api/docs`**, generated from the routes actually
mounted. The raw document is at `/api/openapi.json`.

## Lists

```http
GET /api/v1/projects?pageSize=50&sort_by=-created_at&filter=status:Lead,Active&q=acme
→ { "rows": [ … ], "nextPageToken": "eyJ2…" }
```

Follow `nextPageToken` until it is `null`. `parseList` + `listWhere` +
`listOrder` + `page` do all of it; fetch `pageSize + 1` rows so `page()` can tell
whether another page exists without counting the table.

## Status codes

| Code  | When                                                                 |
| ----- | -------------------------------------------------------------------- |
| `200` | read, or an update returning the row                                 |
| `201` | created, body is the new row                                         |
| `204` | deleted, no body                                                     |
| `401` | no session                                                           |
| `403` | signed in, not allowed                                               |
| `404` | no such record, or one you may not see                               |
| `400` | unusable query, e.g. an unknown `sort_by` or a malformed `pageToken` |
| `409` | refused because of state, e.g. removing a record's last owner        |
| `413` | upload over the limit                                                |
| `422` | body failed validation, including an unknown field                   |
| `429` | over a rate limit; see the `RateLimit-*` headers                     |

Answer `404` rather than `403` for records the caller may not see. `403` tells
them the record exists.

## Errors

One shape, always under `error`:

```json
{ "error": "You cannot remove your own admin role." }
{ "error": { "name": "Too small: expected string to have >=1 characters",
             "status": "Invalid option: expected one of \"Lead\"|\"Active\"" } }
```

A string for a single problem, an object keyed by field for validation. The
client's `api()` helper throws with that content, so a mutation's `onError` can
show it directly.

## Documenting a route

`describe(...)` is middleware, so it sits between the path and the handler:

```ts
.post(
  "/",
  describe({ tag: "invoices", summary: "Create an invoice", ok: row, okStatus: 201, errors: [422] }),
  body(input),
  async (c) => { … }
)
```

- `tag` groups the route in the reference. Use the module id.
- `ok` is the success schema — `createSelectSchema(table)` from `drizzle-zod`
  derives it from the table, so it cannot drift.
- `listOf(row)` wraps it in the `{ rows, total }` envelope.
- `listQuery` and `idParam` are the shared parameter definitions.
- `errors` lists the extra statuses. `401` is added unless you pass `public: true`.
- `okContent` / `requestContent` take raw OpenAPI for non-JSON payloads, like the
  file upload and download.

`body(schema)` validates and documents in one step. The handler reads
`c.req.valid("json")`; there is no `safeParse` in a handler anywhere in this
template, and there should not be. Inside an `actions()` handler use
`actionBody<T>(c)` — the context there is bare.

Every input schema ends in `.strict()`. An unknown field is a typo or a stale
client, and either way silently dropping it ships a bug.

## Auth

Sessions are cookies, issued by Better Auth under `/api/auth/*`. Those routes are
not in the spec — they are documented at [better-auth.com](https://better-auth.com).

Better Auth rejects state-changing requests whose `Origin` does not match
`APP_URL`. Browsers send it automatically; scripts and `curl` must pass
`-H "Origin: $APP_URL"`, which is why `smoke.sh` does.

## Pagination in the browser

`DataTable` filters and sorts client-side over the rows it was given, which is
right up to a few thousand. Past that, feed `pageSize`/`pageToken`/`sort_by`/
`filter` from the table's `onStateChange` and let Postgres do the work.

## Checks

Every guard gets a test. See [testing.md](testing.md).
