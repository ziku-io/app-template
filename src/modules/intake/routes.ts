import { createHash } from "node:crypto"

import { and, eq, ilike, isNull, or, type SQL } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono } from "hono"
import type { Context } from "hono"
import { z } from "zod"

import { db } from "@/server/db"
import { requireAdmin, requireAuth } from "@/server/middleware"
import { body, describe, idParam, listParams, pageOf } from "@/server/openapi"
import { LIMITS, rateLimit } from "@/server/rate-limit"
import { BadRequest, listOrder, listWhere, page, parseList, type ListSpec } from "@/server/rest"

import { INTAKE_KINDS, MAX_MESSAGE_LENGTH, intakeSubmissions } from "./schema"

/**
 * The one endpoint anonymous strangers can reach. Everything here assumes the
 * caller is hostile until proven otherwise: strict body, rate limit, honeypot,
 * no raw IP stored, and nothing about the stored row echoed back.
 */

const tag = "intake"

/**
 * Salt for the IP hash. Without one, a hash of an IPv4 address is not
 * anonymous at all — the whole space is 2^32, so anyone holding the table can
 * rainbow every row back to an address in seconds. The salt has to be a
 * secret, and rotating it deliberately breaks the link to older rows.
 */
const IP_SALT = process.env.INTAKE_IP_SALT ?? ""

function hashClientIp(c: Context): string | null {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  const ip = forwarded || c.req.header("x-real-ip")?.trim()
  // No address, no hash. A placeholder string would look like a real value in
  // every query written against this column later.
  if (!ip) return null
  return createHash("sha256").update(`${IP_SALT}:${ip}`).digest("hex")
}

/** Sortable and filterable columns, by the name callers use. */
const spec: ListSpec = {
  table: intakeSubmissions,
  columns: {
    kind: intakeSubmissions.kind,
    name: intakeSubmissions.name,
    email: intakeSubmissions.email,
    created_at: intakeSubmissions.createdAt,
  },
  id: intakeSubmissions.id,
  defaultSort: "-created_at",
  searchable: [intakeSubmissions.name, intakeSubmissions.email, intakeSubmissions.message],
  deletedAt: intakeSubmissions.deletedAt,
}

const row = createSelectSchema(intakeSubmissions)

/** What the public endpoint answers. Never the stored row: see the handler. */
const accepted = z.object({ ok: z.literal(true) })

// .strict(): an unknown field from an anonymous caller is either a stale form
// or someone probing for one we forgot to reject. Both deserve a 422.
const input = z
  .object({
    kind: z.enum(INTAKE_KINDS).optional(),
    name: z.string().min(1).max(200),
    email: z.email().max(320),
    message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
    meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    /**
     * Honeypot. A real form hides this field with CSS; a person never sees it
     * and never fills it. A bot filling every input it finds does.
     */
    website: z.string().optional(),
  })
  .strict()

export const routes = new Hono()

  /**
   * PUBLIC. No `requireAuth` — this is the form on the marketing site.
   *
   * LIMITS.public is ten a minute per IP, which is generous for a human
   * filling in a contact form and useless to anyone scripting it.
   */
  .post(
    "/",
    rateLimit(LIMITS.public),
    describe({
      tag,
      summary: "Submit an intake form",
      description:
        "Public. Include an empty `website` field as a honeypot. Answers `{ ok: true }` and nothing about the stored row.",
      ok: accepted,
      okStatus: 201,
      public: true,
      errors: [422, 429],
    }),
    body(input),
    async (c) => {
      const { website, ...values } = c.req.valid("json")

      /**
       * Honeypot tripped: answer exactly as if it worked, store nothing.
       *
       * Returning a 400 here would tell the bot which field gave it away, and
       * the next run would skip that field. Silence teaches it nothing, so the
       * cheapest defence we have keeps working.
       */
      if (website !== undefined && website.trim() !== "") {
        return c.json({ ok: true as const }, 201)
      }

      await db.insert(intakeSubmissions).values({
        kind: values.kind ?? "contact",
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        message: values.message,
        meta: values.meta ?? null,
        ipHash: hashClientIp(c),
      })

      // Deliberately not the created row. An anonymous caller has no business
      // learning our ids, and an id is the one thing a scraper would want.
      return c.json({ ok: true as const }, 201)
    },
  )

  .get(
    "/",
    rateLimit(LIMITS.read),
    requireAuth,
    requireAdmin,
    describe({
      tag,
      summary: "List intake submissions",
      description: "Admins only. Cursor-paged; follow `nextPageToken` until it is null.",
      ok: pageOf(row),
      params: listParams(["kind", "name", "email", "created_at"]),
      errors: [400, 403, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)

      const search = request.q
        ? or(...spec.searchable!.map((column) => ilike(column, `%${request.q}%`)))
        : undefined

      const rows = await db
        .select()
        .from(intakeSubmissions)
        .where(listWhere(request, spec, [search as SQL | undefined]))
        .orderBy(...listOrder(request, spec))
        // One more than asked for: the extra row is how we know there is a
        // next page, without counting the whole table.
        .limit(request.pageSize + 1)

      return c.json(page(rows, request, spec))
    },
  )

  .delete(
    "/:id",
    rateLimit(LIMITS.write),
    requireAuth,
    requireAdmin,
    describe({
      tag,
      summary: "Delete an intake submission",
      description: "Admins only. Soft delete: the row is kept and hidden.",
      params: [idParam],
      errors: [403, 404, 429],
    }),
    async (c) => {
      const [deleted] = await db
        .update(intakeSubmissions)
        .set({ deletedAt: new Date() })
        .where(
          and(eq(intakeSubmissions.id, c.req.param("id")), isNull(intakeSubmissions.deletedAt)),
        )
        .returning()
      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )
