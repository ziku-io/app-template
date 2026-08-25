import { pgTable, text, timestamp, integer, uuid } from "drizzle-orm/pg-core"

// Better Auth owns these. Regenerate after changing auth config with:
//   pnpm dlx @better-auth/cli generate --config src/server/auth.ts --output src/server/db/auth-schema.ts
export * from "./auth-schema"

// ── Application tables ──────────────────────────────────────────────
// `projects` is the example resource. Delete it, or copy it with
// `pnpm gen:resource <name>`, which stamps the schema, routes and pages.

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  client: text("client").notNull(),
  status: text("status").notNull().default("Lead"),
  budget: integer("budget").notNull().default(0),
  ownerId: text("owner_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

export const PROJECT_STATUSES = ["Lead", "Active", "On hold", "Done"] as const
