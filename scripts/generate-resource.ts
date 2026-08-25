#!/usr/bin/env tsx
/**
 * Stamps a CRUD resource: schema table, API routes, and a list page wired to
 * DataTable. Run `pnpm gen:resource invoice`, then `pnpm db:generate` for the
 * migration. Everything it writes is meant to be edited afterwards.
 */
import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"

const raw = process.argv[2]
if (!raw) {
  console.error("usage: pnpm gen:resource <singular-name>   e.g. invoice")
  process.exit(1)
}

const singular = raw.toLowerCase().replace(/[^a-z0-9]/g, "")
const plural = singular.endsWith("s") ? `${singular}es` : `${singular}s`
const Pascal = singular[0].toUpperCase() + singular.slice(1)
const Plural = plural[0].toUpperCase() + plural.slice(1)

const routesFile = `src/server/routes/${plural}.ts`
const pageFile = `src/client/pages/${plural}.tsx`

for (const f of [routesFile, pageFile]) {
  if (existsSync(f)) {
    console.error(`${f} already exists — pick another name or delete it first.`)
    process.exit(1)
  }
}

const table = `
export const ${plural} = pgTable("${plural}", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export type ${Pascal} = typeof ${plural}.$inferSelect
export type New${Pascal} = typeof ${plural}.$inferInsert
`

const routes = `import { Hono } from "hono"
import { and, asc, count, desc, eq, ilike, type SQL } from "drizzle-orm"
import { z } from "zod"

import { db } from "../db"
import { ${plural} } from "../db/schema"
import { requireAuth } from "../middleware"

const columns = { name: ${plural}.name, createdAt: ${plural}.createdAt }
const body = z.object({ name: z.string().min(1) })

export const ${singular}Routes = new Hono()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const { q, sort, limit, offset } = c.req.query()
    const where: SQL[] = []
    if (q) where.push(ilike(${plural}.name, \`%\${q}%\`))

    const desc_ = sort?.startsWith("-")
    const key = (desc_ ? sort!.slice(1) : sort) as keyof typeof columns
    const column = columns[key] ?? ${plural}.createdAt

    const filter = where.length ? and(...where) : undefined
    const [rows, [total]] = await Promise.all([
      db.select().from(${plural}).where(filter)
        .orderBy(desc_ ? desc(column) : asc(column))
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
`

const page = `import { useQuery } from "@tanstack/react-query"
import { Button, DataTable, PageHeader, type DataTableColumn } from "@ziku/ui"
import { PlusIcon } from "@phosphor-icons/react"

import { get } from "../lib/api"

interface ${Pascal} {
  id: string
  name: string
  createdAt: string
}

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
      <PageHeader
        title="${Plural}"
        actions={<Button><PlusIcon /> New ${singular}</Button>}
      />
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
`

await writeFile(routesFile, routes)
await writeFile(pageFile, page)

const schemaPath = "src/server/db/schema.ts"
await writeFile(schemaPath, (await readFile(schemaPath, "utf8")).trimEnd() + "\n" + table)

console.log(`created:
  ${schemaPath}   (+ ${plural} table)
  ${routesFile}
  ${pageFile}

next:
  1. mount it:   app.route("/api/${plural}", ${singular}Routes)   in src/server/index.ts
  2. route it:   <Route path="/${plural}" element={<${Plural}Page />} />   in src/client/App.tsx
  3. migrate:    pnpm db:generate && pnpm db:migrate`)
