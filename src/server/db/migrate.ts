import { existsSync } from "node:fs"

import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

/** Run on boot and from `pnpm db:migrate`. A fresh database is one command away. */
export async function runMigrations(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set")
  // A fresh app has none until `pnpm db:generate` runs, and the template ships
  // none on purpose: they would create tables for modules you deleted.
  if (!existsSync("./migrations")) {
    console.warn("no migrations/ — run `pnpm db:generate` to create the first one")
    return
  }
  const client = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder: "./migrations" })
  } finally {
    await client.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations()
  console.log("migrations applied")
}
