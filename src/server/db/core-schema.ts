import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core"

/**
 * Cross-cutting tables the conventions need. Modules own their own tables;
 * these belong to the app itself.
 */

/**
 * Replayed POST responses, keyed by the caller's `requestId`. A retry after a
 * timeout returns the first response instead of creating a second record.
 */
export const idempotencyKeys = pgTable("idempotency_keys", {
  requestId: text("request_id").primaryKey(),
  userId: text("user_id").notNull(),
  /** Method and path, so the same id cannot be reused for a different call. */
  endpoint: text("endpoint").notNull(),
  status: integer("status").notNull(),
  body: jsonb("body"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

/**
 * Machine callers. The secret is stored hashed; the caller signs each request
 * with it, so a leaked log line does not leak a usable credential.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Sent as X-API-KEY. */
    keyId: text("key_id").notNull().unique(),
    secretHash: text("secret_hash").notNull(),
    /** Acts as this user. */
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => [index("api_keys_key_id_idx").on(t.keyId)],
)
