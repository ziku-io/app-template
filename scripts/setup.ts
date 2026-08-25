#!/usr/bin/env tsx
/**
 * One-shot a new client app: name it, keep only the modules it needs, write
 * .env, and regenerate the registries.
 *
 *   pnpm setup --name acme-portal --modules projects,files
 *   pnpm setup --name acme-portal --modules none
 *   pnpm setup                              # interactive
 */
import { createInterface } from "node:readline/promises"
import { randomBytes } from "node:crypto"
import { readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

import { readModules, sync } from "./sync-modules"

const ROOT = path.resolve(import.meta.dirname, "..")

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const available = await readModules()

// ── What to build ───────────────────────────────────────────────────
let name = flag("name")
let keep: string[]

const wanted = flag("modules")
if (wanted !== undefined) {
  keep = wanted === "none" || wanted === "" ? [] : wanted.split(",").map((s) => s.trim())
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  name ??= (await rl.question("App name (kebab-case): ")).trim()
  console.log("\nAvailable modules:")
  for (const m of available) console.log(`  ${m.id} — ${m.title}: ${m.description}`)
  const answer = await rl.question(`\nKeep which? (comma-separated, blank for all): `)
  await rl.close()
  keep = answer.trim() ? answer.split(",").map((s) => s.trim()) : available.map((m) => m.id)
}

name ??= path.basename(ROOT)

const unknown = keep.filter((id) => !available.some((m) => m.id === id))
if (unknown.length) {
  console.error(`unknown module(s): ${unknown.join(", ")}`)
  console.error(`available: ${available.map((m) => m.id).join(", ")}`)
  process.exit(1)
}

// Pull in anything the chosen modules depend on.
const resolved = new Set(keep)
let grew = true
while (grew) {
  grew = false
  for (const id of [...resolved]) {
    for (const need of available.find((m) => m.id === id)?.requires ?? []) {
      if (!resolved.has(need)) {
        resolved.add(need)
        grew = true
        console.log(`+ ${need} (required by ${id})`)
      }
    }
  }
}

// ── Prune ───────────────────────────────────────────────────────────
for (const m of available) {
  if (resolved.has(m.id) || m.core) continue
  await rm(path.join(ROOT, "src/modules", m.id), { recursive: true, force: true })
  console.log(`- ${m.id}`)
}

const kept = available.filter((m) => resolved.has(m.id) || m.core)

// Any migration lying around describes a module set that no longer matches.
await rm(path.join(ROOT, "migrations"), { recursive: true, force: true })

// ── Name the app ────────────────────────────────────────────────────
const pkgPath = path.join(ROOT, "package.json")
const pkg = JSON.parse(await readFile(pkgPath, "utf8"))
pkg.name = name
await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n")

for (const [file, from, to] of [
  ["src/client/index.html", "<title>Ziku App</title>", `<title>${name}</title>`],
  ["src/client/App.tsx", "ziku app", name],
] as const) {
  const p = path.join(ROOT, file)
  await writeFile(p, (await readFile(p, "utf8")).replaceAll(from, to))
}

// ── .env ────────────────────────────────────────────────────────────
const envPath = path.join(ROOT, ".env")
if (existsSync(envPath)) {
  console.log("\n.env already exists, leaving it alone")
} else {
  const lines = [
    "# Postgres. One database per client app; the server migrates on boot.",
    `DATABASE_URL=postgres://app:app@localhost:5432/${name.replace(/\W+/g, "_")}`,
    "",
    "# Signs sessions.",
    `BETTER_AUTH_SECRET=${randomBytes(32).toString("base64")}`,
    "",
    "# Public origin, used for auth callbacks and the CSRF origin check.",
    "APP_URL=http://localhost:5173",
    "",
    "PORT=3000",
  ]
  for (const m of kept) {
    if (!m.env?.length) continue
    lines.push("", `# ${m.title}`)
    for (const e of m.env) lines.push(`# ${e.description}`, `${e.key}=${e.default ?? ""}`)
  }
  await writeFile(envPath, lines.join("\n") + "\n")
  console.log("\nwrote .env with a fresh BETTER_AUTH_SECRET")
}

// ── Registries ──────────────────────────────────────────────────────
const { modules } = await sync()

const extraDeps = kept.flatMap((m) => Object.entries(m.dependencies ?? {}))

console.log(`
${name} is ready with: ${modules.map((m) => m.id).join(", ") || "no modules"}
${extraDeps.length ? `\ninstall module deps:\n  pnpm add ${extraDeps.map(([k, v]) => `${k}@${v}`).join(" ")}\n` : ""}
next:
  1. start Postgres        docker compose up -d db
  2. create the tables     pnpm db:generate && pnpm db:migrate
  3. run it                pnpm dev
  4. add a resource        pnpm gen:resource <name>`)
