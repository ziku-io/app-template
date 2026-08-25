#!/usr/bin/env tsx
/** Lists what is installed. `pnpm modules` */
import { readModules } from "./sync-modules"

const modules = await readModules()
if (modules.length === 0) {
  console.log("no modules installed")
} else {
  const width = Math.max(...modules.map((m) => m.id.length))
  for (const m of modules) {
    console.log(`  ${m.id.padEnd(width)}  ${m.title} — ${m.description}`)
  }
}
console.log(`\nremove one with:  pnpm remove:module <id>`)
