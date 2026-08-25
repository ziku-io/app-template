import { sql } from "drizzle-orm"
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    /** Path on disk relative to UPLOAD_DIR. Never sent to the browser. */
    storageKey: text("storage_key").notNull(),
    /** Optional owner record, so files can hang off any table. */
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /** Soft delete: the bytes stay on disk so a delete is recoverable. */
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    index("files_entity_idx").on(t.entityType, t.entityId),
    check("files_name_not_blank", sql`length(trim(${t.name})) > 0`),
    // A zero-byte upload is a failed upload; storing it hides the failure.
    check("files_size_positive", sql`${t.size} > 0`),
    check("files_storage_key_not_blank", sql`length(trim(${t.storageKey})) > 0`),
    // Half a reference points nowhere: both columns or neither.
    check("files_entity_pair", sql`(${t.entityType} is null) = (${t.entityId} is null)`),
  ],
)

export type FileRecord = typeof files.$inferSelect
