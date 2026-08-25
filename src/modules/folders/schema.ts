import { sql } from "drizzle-orm"
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"

/**
 * A folder tree over the `files` module. A file joins a folder the same way it
 * joins anything else — `entityType = 'folder'`, `entityId = <folder id>` — so
 * this module needs no column in the files table and files stays untouched.
 */
export const folders = pgTable(
  "folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    /** Null means a top-level folder. Self-reference: the tree lives in one table. */
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id),
    /** Optional owner record, so a tree can hang off any table. */
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    /** Soft delete: DELETE stamps this, lists hide it, `:restore` clears it. */
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    // A blank folder name renders as an invisible row nobody can click.
    check("folders_name_not_blank", sql`length(trim(${t.name})) > 0`),
    // A folder that is its own parent is a one-row cycle. Deeper cycles need a
    // walk and are rejected in routes.ts.
    check("folders_parent_not_self", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
    /**
     * No two live siblings share a name — a path has to mean one folder.
     * `coalesce` on the parent because NULLs are distinct in a unique index,
     * which would leave the top level, the one people actually look at,
     * unprotected.
     */
    uniqueIndex("folders_sibling_name_unique")
      .on(sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.name)
      .where(sql`${t.deletedAt} is null`),
    index("folders_parent_idx").on(t.parentId),
    index("folders_entity_idx").on(t.entityType, t.entityId),
  ],
)

export type Folder = typeof folders.$inferSelect
