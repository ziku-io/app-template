import { sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"

import { user } from "@/server/db/auth-schema"

/**
 * `owner` is the accountable person; `member` works the record. A record must
 * always keep at least one owner — see routes.ts, which is where that is
 * enforced, because "at least one" is not something a row-level constraint can
 * see.
 */
export const ASSIGNMENT_ROLES = ["owner", "member"] as const
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number]

export const assignments = pgTable(
  "assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** What it hangs off: "project", "client", anything. */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** FK, so an assignment cannot outlive the account it points at. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /** Soft delete: unassigning stamps this, lists hide it, `:restore` undoes it. */
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    // The two lookups this table exists for: "who is on this record" and
    // "what can this user see" (visibility.ts).
    index("assignments_entity_idx").on(t.entityType, t.entityId),
    index("assignments_user_idx").on(t.userId, t.entityType),

    // The zod schema rejects this too, but a constraint cannot be bypassed by a
    // migration, a fixture or a psql session.
    check("assignments_role_valid", sql`${t.role} in ('owner', 'member')`),
    check("assignments_entity_type_not_blank", sql`length(trim(${t.entityType})) > 0`),
    check("assignments_entity_id_not_blank", sql`length(trim(${t.entityId})) > 0`),

    // One live assignment per person per record. Partial, so unassigning and
    // reassigning the same person works instead of colliding with a tombstone.
    uniqueIndex("assignments_one_per_user_per_entity")
      .on(t.entityType, t.entityId, t.userId)
      .where(sql`${t.deletedAt} is null`),
  ],
)

export type Assignment = typeof assignments.$inferSelect
