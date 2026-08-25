import { sql } from "drizzle-orm"
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/** The only kinds that exist. Anything else is a bug, not a new feature. */
export const INTAKE_KINDS = ["contact", "enquiry", "waitlist"] as const

/** Matches the CHECK below. A form is not the place to litigate RFC 5322. */
export const MAX_MESSAGE_LENGTH = 5000

export const intakeSubmissions = pgTable(
  "intake_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull().default("contact"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    /** Whatever the form wants to carry: page, campaign, locale. */
    meta: jsonb("meta"),
    /**
     * SHA-256 of the client IP with a server-side salt. Never the raw IP: an
     * address identifies a person under GDPR, and this table exists to hold
     * anonymous strangers' words, not their location. The hash is enough to
     * spot one source flooding the form, which is all we need it for.
     */
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /** Soft delete: an admin DELETE stamps this rather than dropping the row. */
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    // The zod schemas reject these too, but a constraint cannot be bypassed by
    // a migration, a fixture or a psql session — and this table takes writes
    // from the open internet.
    check("intake_submissions_kind_valid", sql`${t.kind} in ('contact', 'enquiry', 'waitlist')`),
    check("intake_submissions_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check("intake_submissions_email_not_blank", sql`length(trim(${t.email})) > 0`),
    check("intake_submissions_message_not_blank", sql`length(trim(${t.message})) > 0`),
    check(
      "intake_submissions_message_length",
      sql`length(${t.message}) <= ${sql.raw(String(MAX_MESSAGE_LENGTH))}`,
    ),
    /**
     * Deliberately loose: something@something.tld with no whitespace. A
     * stricter pattern rejects real addresses (plus tags, new TLDs, unicode
     * locals) and a laxer one lets "n/a" through. This catches the typo and
     * the bot, which is the job.
     */
    check(
      "intake_submissions_email_shape",
      sql`${t.email} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`,
    ),
    index("intake_submissions_created_idx").on(t.createdAt),
    index("intake_submissions_ip_idx").on(t.ipHash, t.createdAt),
  ],
)

export type IntakeSubmission = typeof intakeSubmissions.$inferSelect
