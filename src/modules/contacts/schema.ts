import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

/** Roles the UI offers. Free text is still accepted — only blankness is rejected. */
export const CONTACT_ROLES = ["Billing", "Technical", "Legal", "Primary", "Other"] as const

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** What it hangs off: "project", "client", anything. Polymorphic like `files`. */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    /** Free text, e.g. "Billing". Null means nobody said. */
    role: text("role"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    /** Soft delete: DELETE stamps this, lists hide it, `?includeDeleted=true` shows it. */
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    // The lookup every embed does: "contacts for this record".
    index("contacts_entity_idx").on(t.entityType, t.entityId),

    // The zod schemas reject these too, but a constraint cannot be bypassed by a
    // migration, a fixture or a psql session.
    check("contacts_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check("contacts_entity_type_not_blank", sql`length(trim(${t.entityType})) > 0`),
    check("contacts_entity_id_not_blank", sql`length(trim(${t.entityId})) > 0`),
    // Null is fine (nobody has to have an email); a value has to look like one.
    // Deliberately loose: this catches "not an address at all", not RFC 5322.
    // Bracket expressions instead of backslash escapes, because drizzle's sql
    // template cooks the string and `\.` would collapse before Postgres saw it.
    check(
      "contacts_email_shape",
      sql`${t.email} is null or ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`,
    ),
    // A role, if given, is a label rather than an empty string pretending to be one.
    check("contacts_role_not_blank", sql`${t.role} is null or length(trim(${t.role})) > 0`),

    // At most one primary contact per record. Partial, so soft-deleted rows and
    // non-primary rows do not consume the slot. This is the invariant the
    // `:makePrimary` action relies on — it clears the old primary in the same
    // transaction precisely because the database would otherwise refuse.
    uniqueIndex("contacts_one_primary_per_entity")
      .on(t.entityType, t.entityId)
      .where(sql`${t.isPrimary} and ${t.deletedAt} is null`),
  ],
)

export type Contact = typeof contacts.$inferSelect
