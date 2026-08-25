import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** What it hangs off: "project", "client", anything. */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** "note" when a person wrote it, otherwise the event name. */
    kind: text("kind").notNull().default("note"),
    text: text("text").notNull(),
    userId: text("user_id"),
    userName: text("user_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("activities_entity_idx").on(t.entityType, t.entityId, t.createdAt)],
)

export type Activity = typeof activities.$inferSelect
