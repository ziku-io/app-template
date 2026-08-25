import { sql } from "drizzle-orm"
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const PROJECT_STATUSES = ["Lead", "Active", "On hold", "Done"] as const

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    client: text("client").notNull(),
    status: text("status").notNull().default("Lead"),
    budget: integer("budget").notNull().default(0),
    ownerId: text("owner_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    /** Soft delete: DELETE stamps this, lists hide it, `?includeDeleted=true` shows it. */
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    // The zod schema rejects these too, but a constraint cannot be bypassed by
    // a migration, a fixture or a psql session.
    check("projects_status_valid", sql`${t.status} in ('Lead', 'Active', 'On hold', 'Done')`),
    check("projects_budget_non_negative", sql`${t.budget} >= 0`),
    check("projects_name_not_blank", sql`length(trim(${t.name})) > 0`),
  ],
)

export type Project = typeof projects.$inferSelect
