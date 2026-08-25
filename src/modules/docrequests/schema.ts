import { sql } from "drizzle-orm"
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/** The only statuses that exist. Anything else is a bug, not a new feature. */
export const DOCUMENT_REQUEST_STATUSES = ["open", "fulfilled", "cancelled"] as const

export const documentRequests = pgTable(
  "document_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    notes: text("notes"),
    status: text("status").notNull().default("open"),
    /**
     * Where the answer must land. Deliberately no foreign key: the folders
     * module is optional, and a request that outlives it should still say
     * where it wanted the file.
     */
    folderId: uuid("folder_id"),
    /** Optional owner record, so a request can hang off any table. */
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    requestedBy: text("requested_by"),
    /** Set together with fulfilledAt, never on its own. See the CHECK below. */
    fileId: uuid("file_id"),
    fulfilledBy: text("fulfilled_by"),
    fulfilledAt: timestamp("fulfilled_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    /** Soft delete: DELETE stamps this, lists hide it, `:restore` clears it. */
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    // The zod schemas reject these too, but a constraint cannot be bypassed by
    // a migration, a fixture or a psql session.
    check("document_requests_status_valid", sql`${t.status} in ('open', 'fulfilled', 'cancelled')`),
    check("document_requests_title_not_blank", sql`length(trim(${t.title})) > 0`),
    /**
     * The key invariant: a fulfilled request must name its file.
     *
     * Both null (nothing arrived yet) or both set (this file, at this time)
     * are the only honest states. One without the other is a request that
     * claims to be answered but cannot say by what, which is exactly the row
     * an auditor asks about six months later.
     */
    check(
      "document_requests_fulfilment_complete",
      sql`(${t.fileId} is null) = (${t.fulfilledAt} is null)`,
    ),
    // …and the status has to agree with the pair.
    check(
      "document_requests_fulfilled_status_agrees",
      sql`(${t.status} = 'fulfilled') = (${t.fileId} is not null)`,
    ),
    // Half a polymorphic pointer points nowhere.
    check(
      "document_requests_entity_pair_complete",
      sql`(${t.entityType} is null) = (${t.entityId} is null)`,
    ),
    index("document_requests_entity_idx").on(t.entityType, t.entityId),
    index("document_requests_status_idx").on(t.status, t.createdAt),
  ],
)

export type DocumentRequest = typeof documentRequests.$inferSelect
