#!/usr/bin/env tsx
/** Deletes a module and re-syncs. `pnpm remove:module files` */
import { rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

import { readModules, sync } from "./sync-modules"

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.error("usage: pnpm remove:module <id> [id...]")
  process.exit(1)
}

const ROOT = path.resolve(import.meta.dirname, "..")
const installed = await readModules()

for (const id of ids) {
  const dir = path.join(ROOT, "src/modules", id)
  if (!existsSync(dir)) {
    console.error(`${id}: not installed`)
    continue
  }
  const needy = installed.filter((m) => m.requires?.includes(id) && !ids.includes(m.id))
  if (needy.length) {
    console.error(`${id}: still needed by ${needy.map((m) => m.id).join(", ")}`)
    process.exit(1)
  }
  await rm(dir, { recursive: true, force: true })
  console.log(`removed ${id}`)
}

const { modules } = await sync()
console.log(`remaining: ${modules.map((m) => m.id).join(", ") || "none"}`)
console.log("run `pnpm db:generate` to drop the tables it owned")
