import { sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const ACTIVITY_KINDS = ["note", "event"] as const

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** What it hangs off: "projects", "tickets", anything. */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** "note" when a person wrote it, "event" when the server recorded it. */
    kind: text("kind").notNull().default("note"),
    body: text("body").notNull(),
    userId: text("user_id"),
    userName: text("user_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("activities_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    check("activities_kind_valid", sql`${t.kind} in ('note', 'event')`),
    // An empty note is never intentional, and it would render as a blank row.
    check("activities_body_not_blank", sql`length(trim(${t.body})) > 0`),
    check(
      "activities_entity_not_blank",
      sql`length(trim(${t.entityType})) > 0 and length(trim(${t.entityId})) > 0`,
    ),
  ],
)

export type Activity = typeof activities.$inferSelect
