import { bigint, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

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
  },
  (t) => [index("files_entity_idx").on(t.entityType, t.entityId)]
)

export type FileRecord = typeof files.$inferSelect
