import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

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
export const PROJECT_STATUSES = ["Lead", "Active", "On hold", "Done"] as const
