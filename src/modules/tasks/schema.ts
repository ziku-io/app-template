import { sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core"

/**
 * The allowed values, in the order a board should read them. The same lists
 * back the zod enums, the CHECK constraints and the client's `order` arrays,
 * so the three can never drift apart.
 */
export const TASK_STATUSES = ["todo", "doing", "blocked", "done"] as const
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("todo"),
    priority: text("priority").notNull().default("normal"),
    assigneeId: text("assignee_id"),
    dueDate: timestamp("due_date"),
    /**
     * Parent task, for one level of subtasks. The FK stops a subtask pointing
     * at a task that does not exist; the depth rule itself is enforced in
     * routes.ts, because SQL cannot express it (see the comment there).
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id),
    /** Optional owner record, so a task can hang off any table. */
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    completedAt: timestamp("completed_at"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    /** Soft delete: DELETE stamps this, lists hide it, `:restore` clears it. */
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    // The zod schemas reject these too, but a constraint cannot be bypassed by
    // a migration, a fixture or a psql session.
    check("tasks_status_valid", sql`${t.status} in ('todo', 'doing', 'blocked', 'done')`),
    check("tasks_priority_valid", sql`${t.priority} in ('low', 'normal', 'high', 'urgent')`),
    check("tasks_title_not_blank", sql`length(trim(${t.title})) > 0`),
    /**
     * A completion date on a task that is not done is a lie every report would
     * repeat. Only `:complete` may set it, and only together with the status.
     */
    check(
      "tasks_completed_at_requires_done",
      sql`${t.completedAt} is null or ${t.status} = 'done'`,
    ),
    // A task cannot be its own parent. Cheap to state, and it closes the one
    // cycle a single row can create on its own.
    check("tasks_parent_not_self", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    index("tasks_parent_idx").on(t.parentId),
    index("tasks_entity_idx").on(t.entityType, t.entityId),
    index("tasks_assignee_idx").on(t.assigneeId),
  ],
)

export type Task = typeof tasks.$inferSelect
