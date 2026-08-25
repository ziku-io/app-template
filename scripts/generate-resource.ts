#!/usr/bin/env tsx
/**
 * Stamps a new module for a CRUD resource: manifest, table, API routes and a
 * list page wired to DataTable. It appears in the sidebar as soon as the
 * registries re-sync, which this does for you.
 *
 *   pnpm gen:resource invoice
 */
import { mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

import { sync } from "./sync-modules"

const raw = process.argv[2]
if (!raw) {
  console.error("usage: pnpm gen:resource <singular-name>   e.g. invoice")
  process.exit(1)
}

const singular = raw.toLowerCase().replace(/[^a-z0-9]/g, "")
const plural = singular.endsWith("s") ? `${singular}es` : `${singular}s`
const Pascal = singular[0].toUpperCase() + singular.slice(1)
const Plural = plural[0].toUpperCase() + plural.slice(1)

const ROOT = path.resolve(import.meta.dirname, "..")
const dir = path.join(ROOT, "src/modules", plural)
if (existsSync(dir)) {
  console.error(`src/modules/${plural} already exists — pick another name or remove it first.`)
  process.exit(1)
}

const files: Record<string, string> = {
  "module.json": JSON.stringify(
    {
      id: plural,
      title: Plural,
      description: `${Plural} resource.`,
      requires: [],
    },
    null,
    2
  ) + "\n",

  "schema.ts": `import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const ${plural} = pgTable("${plural}", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export type ${Pascal} = typeof ${plural}.$inferSelect
`,

  "routes.ts": `import { Hono } from "hono"
import { and, asc, count, desc, eq, ilike, type SQL } from "drizzle-orm"
import { z } from "zod"

import { db } from "@/server/db"
import { requireAuth } from "@/server/middleware"

import { ${plural} } from "./schema"

const columns = { name: ${plural}.name, createdAt: ${plural}.createdAt }
const body = z.object({ name: z.string().min(1) })

export const routes = new Hono()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const { q, sort, limit, offset } = c.req.query()
    const where: SQL[] = []
    if (q) where.push(ilike(${plural}.name, \`%\${q}%\`))

    const descending = sort?.startsWith("-")
    const key = (descending ? sort!.slice(1) : sort) as keyof typeof columns
    const column = columns[key] ?? ${plural}.createdAt

    const filter = where.length ? and(...where) : undefined
    const [rows, [total]] = await Promise.all([
      db.select().from(${plural}).where(filter)
        .orderBy(descending ? desc(column) : asc(column))
        .limit(Math.min(Number(limit) || 500, 1000))
        .offset(Number(offset) || 0),
      db.select({ n: count() }).from(${plural}).where(filter),
    ])
    return c.json({ rows, total: total.n })
  })

  .post("/", async (c) => {
    const parsed = body.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 422)
    const [row] = await db.insert(${plural}).values(parsed.data).returning()
    return c.json(row, 201)
  })

  .patch("/:id", async (c) => {
    const parsed = body.partial().safeParse(await c.req.json())
    if (!parsed.success) return c.json({ error: z.treeifyError(parsed.error) }, 422)
    const [row] = await db.update(${plural})
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(${plural}.id, c.req.param("id"))).returning()
    return row ? c.json(row) : c.json({ error: "Not found" }, 404)
  })

  .delete("/:id", async (c) => {
    const [row] = await db.delete(${plural}).where(eq(${plural}.id, c.req.param("id"))).returning()
    return row ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
  })
`,

  "server.ts": `import type { ServerModule } from "../types"
import { routes } from "./routes"

export default { id: "${plural}", basePath: "/api/${plural}", routes } satisfies ServerModule
`,

  "page.tsx": `import { useQuery } from "@tanstack/react-query"
import { PlusIcon } from "@phosphor-icons/react"
import { Button, DataTable, PageHeader, type DataTableColumn } from "@ziku/ui"

import { get, type Json } from "@/client/lib/api"

import type { ${Pascal} as ${Pascal}Row } from "./schema"

type ${Pascal} = Json<${Pascal}Row>

const columns: DataTableColumn<${Pascal}>[] = [
  { key: "name", header: "Name", className: "font-medium" },
  { key: "createdAt", header: "Created", render: (r) => new Date(r.createdAt).toLocaleDateString() },
]

export function ${Plural}Page() {
  const { data, isLoading } = useQuery({
    queryKey: ["${plural}"],
    queryFn: () => get<{ rows: ${Pascal}[]; total: number }>("/${plural}"),
  })

  return (
    <>
      <PageHeader title="${Plural}" actions={<Button><PlusIcon /> New ${singular}</Button>} />
      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        loading={isLoading}
        rowId={(r) => r.id}
        viewKey="${plural}"
      />
    </>
  )
}
`,

  "client.tsx": `import { ListBulletsIcon } from "@phosphor-icons/react"

import type { ClientModule } from "../types"
import { ${Plural}Page } from "./page"

export default {
  id: "${plural}",
  nav: [{ title: "${Plural}", href: "/${plural}", icon: ListBulletsIcon, group: "Workspace" }],
  routes: [{ path: "/${plural}", element: <${Plural}Page /> }],
} satisfies ClientModule
`,
}

await mkdir(dir, { recursive: true })
for (const [file, contents] of Object.entries(files)) {
  await writeFile(path.join(dir, file), contents)
}
await sync()

console.log(`created src/modules/${plural}/ and synced the registries

it is already mounted at /api/${plural} and linked in the sidebar.

next:
  pnpm db:generate && pnpm db:migrate`)
