# Modules

A module is a folder under `src/modules/` owning its tables, routes, pages and
navigation. Nothing references modules by name: `pnpm modules:sync` writes the
registries the server and client import, so adding or deleting a folder is the
whole operation.

```bash
pnpm modules                 # what is installed
pnpm gen:resource invoice    # stamp a new CRUD module, mounted and linked
pnpm remove:module files     # delete one
pnpm db:generate && pnpm db:migrate   # after anything with tables
```

## Anatomy

```
src/modules/<id>/
  module.json    id, title, description, requires, env, dependencies
  schema.ts      Drizzle tables
  routes.ts      Hono routes
  server.ts      export default { id, basePath, routes }
  page.tsx       the page
  client.tsx     export default { id, nav, routes }
  smoke.sh       optional checks, sourced by ./smoke.sh
```

Every file is optional. `activity` has no page and no nav entry because it is a
component other pages embed. A module with only a `client.tsx` is a pure UI
feature; one with only a `server.ts` is a background concern.

## The two entrypoints

```ts
// server.ts — mounted at basePath by src/server/index.ts
export default { id: "invoices", basePath: "/api/invoices", routes } satisfies ServerModule
```

```tsx
// client.tsx — folded into the sidebar and the router by src/client/App.tsx
export default {
  id: "invoices",
  nav: [{ title: "Invoices", href: "/invoices", icon: ReceiptIcon, group: "Workspace" }],
  routes: [{ path: "/invoices", element: <InvoicesPage /> }],
} satisfies ClientModule
```

`group` picks the sidebar section; unknown groups are appended. Both `nav` and
`routes` accept `roles: ["admin"]`, which hides the link *and* drops the route,
so a member cannot reach the page by typing the URL. That is a convenience, not
a security boundary — the server check is the one that counts, so guard the
routes with `requireAdmin` as well. `users` does both.

## The manifest

```json
{
  "id": "files",
  "title": "Files",
  "description": "Shown by `pnpm modules` and in the setup picker.",
  "requires": ["projects"],
  "dependencies": { "@aws-sdk/client-s3": "^3" },
  "env": [{ "key": "UPLOAD_DIR", "default": "./data/uploads", "description": "Where files land" }]
}
```

`requires` pulls dependencies in during `pnpm setup` and stops
`pnpm remove:module` from breaking a module that needs this one. `env` keys are
written into `.env` when the module is kept. `dependencies` are printed for you
to install; they are not added to `package.json` automatically, so a module you
delete never leaves a package behind.

## Cross-module imports

Import the app with `@/server/...` and `@/client/...`. Importing another module
directly (`@/modules/files/...`) works but couples the two: declare it in
`requires` so the tooling knows, or the app breaks when someone removes that
module.

## Writing tables

Namespace table names after the module (`files`, `activities`) — the generated
schema barrel re-exports every module's tables into one namespace, so two
modules exporting `items` would collide. Timestamps are `timestamp` columns; on
the client they arrive as strings, so wrap row types in `Json<T>` from
`@/client/lib/api`.

## Checks

A module's `smoke.sh` is sourced by the root `./smoke.sh` while the smoke
account is signed in, and inherits `check()`, `code()`, `$BASE`, `$JAR` and
`$H`. Keep them to the module's own endpoints:

```bash
check "files: upload" 201 "$(code -b "$JAR" -H "Origin: $BASE" -X POST "$BASE/api/files" -F "file=@$tmp")"
```

Because they live with the module, the suite always covers exactly the app you
composed.
