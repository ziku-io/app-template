# API conventions

The live reference is at **`/api/docs`**, generated from the routes actually
mounted. The raw document is at `/api/openapi.json`.

## Lists

Every list endpoint takes the same query parameters:

| Parameter | Meaning |
|---|---|
| `q` | free-text search |
| `sort` | column name, `-` prefix for descending |
| `limit` / `offset` | paging, capped at 1000 |
| *field*`=a,b` | filter by a comma-separated list |

and answers the same envelope:

```json
{ "rows": [ … ], "total": 42 }
```

`total` is the count *after* filtering, so a client can page without a second
request. Keep the envelope even for endpoints that will never page — `DataTable`
and the query hooks assume it.

## Status codes

| Code | When |
|---|---|
| `200` | read, or an update returning the row |
| `201` | created, body is the new row |
| `204` | deleted, no body |
| `401` | no session |
| `403` | signed in, not allowed |
| `404` | no such record, or one you may not see |
| `409` | refused because of state, e.g. removing your own admin role |
| `413` | upload over the limit |
| `422` | body failed validation |

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
template, and there should not be.

## Auth

Sessions are cookies, issued by Better Auth under `/api/auth/*`. Those routes are
not in the spec — they are documented at [better-auth.com](https://better-auth.com).

Better Auth rejects state-changing requests whose `Origin` does not match
`APP_URL`. Browsers send it automatically; scripts and `curl` must pass
`-H "Origin: $APP_URL"`, which is why `smoke.sh` does.

## Pagination in the browser

`DataTable` filters and sorts client-side over the rows it was given, which is
right up to a few thousand. Past that, feed the query parameters above from the
table's `onStateChange` and let Postgres do the work.
