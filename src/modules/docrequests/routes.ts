import { and, eq, ilike, isNull, or, type SQL } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono } from "hono"
import type { Context } from "hono"
import { z } from "zod"

import { files } from "@/modules/files/schema"
import { db } from "@/server/db"
import { idempotent } from "@/server/idempotency"
import { requireAuth } from "@/server/middleware"
import { body, describe, idParam, listParams, pageOf } from "@/server/openapi"
import { LIMITS, rateLimit } from "@/server/rate-limit"
import {
  actions,
  BadRequest,
  listOrder,
  listWhere,
  page,
  parseList,
  actionBody,
  type ListSpec,
} from "@/server/rest"

import { DOCUMENT_REQUEST_STATUSES, documentRequests } from "./schema"

/**
 * "Send me your 2024 accounts." A request names the document, the destination
 * folder and who asked; fulfilling it points at the file that answered it.
 *
 * The destination folder is read off the REQUEST, never off the upload. An
 * uploader who could choose the folder could drop a client's tax return into
 * someone else's matter, and nothing downstream would notice — so the only
 * thing the fulfilling call supplies is which file it was.
 */

const tag = "docrequests"

/** Sortable and filterable columns, by the name callers use. */
const spec: ListSpec = {
  table: documentRequests,
  columns: {
    title: documentRequests.title,
    status: documentRequests.status,
    entity_type: documentRequests.entityType,
    entity_id: documentRequests.entityId,
    folder_id: documentRequests.folderId,
    requested_by: documentRequests.requestedBy,
    created_at: documentRequests.createdAt,
    updated_at: documentRequests.updatedAt,
    fulfilled_at: documentRequests.fulfilledAt,
  },
  id: documentRequests.id,
  defaultSort: "-created_at",
  searchable: [documentRequests.title, documentRequests.notes],
  deletedAt: documentRequests.deletedAt,
}

const row = createSelectSchema(documentRequests)

// .strict(): an unknown field is a typo or a stale client, and either way the
// caller deserves a 422 rather than a silently ignored value.
const input = z
  .object({
    title: z.string().min(1).max(300),
    notes: z.string().max(5000).nullable().optional(),
    folderId: z.uuid().nullable().optional(),
    entityType: z.string().min(1).nullable().optional(),
    entityId: z.string().min(1).nullable().optional(),
    /**
     * Deliberately absent: `status`, `fileId`, `fulfilledAt`, `fulfilledBy`.
     * Fulfilling and cancelling are verbs with their own guards; letting a
     * PATCH set those fields would let a caller mark a request answered
     * without naming a file, which the CHECK would reject anyway.
     */
    /** Makes the create safe to retry. See docs/rest-standards.md. */
    requestId: z.string().min(8).optional(),
  })
  .strict()

/**
 * One body schema for every action, because `body()` runs before the action
 * dispatcher and cannot know which verb is coming. `:fulfil` needs a fileId
 * and checks for it; `:cancel` and `:restore` take nothing.
 */
const actionInput = z
  .object({
    fileId: z.uuid().optional(),
    requestId: z.string().min(8).optional(),
  })
  .strict()

/** Both halves of a polymorphic pointer, or neither. Mirrors the CHECK. */
function entityPairError(values: { entityType?: string | null; entityId?: string | null }) {
  const hasType = values.entityType != null
  const hasId = values.entityId != null
  if (hasType === hasId) return null
  return "entityType and entityId must be sent together, or not at all."
}

export const routes = new Hono()
  .use("*", requireAuth)

  .get(
    "/",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "List document requests",
      description:
        "Cursor-paged. Follow `nextPageToken` until it is null. `?q=` searches title and notes.",
      ok: pageOf(row),
      params: listParams([
        "title",
        "status",
        "entity_type",
        "entity_id",
        "folder_id",
        "requested_by",
        "created_at",
        "updated_at",
        "fulfilled_at",
      ]),
      errors: [400, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)

      const search = request.q
        ? or(...spec.searchable!.map((column) => ilike(column, `%${request.q}%`)))
        : undefined

      const rows = await db
        .select()
        .from(documentRequests)
        .where(listWhere(request, spec, [search as SQL | undefined]))
        .orderBy(...listOrder(request, spec))
        // One more than asked for: the extra row is how we know there is a
        // next page, without counting the whole table.
        .limit(request.pageSize + 1)

      return c.json(page(rows, request, spec))
    },
  )

  .post(
    "/",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Create a document request",
      description:
        "`folderId` is where the eventual file lands. Send a `requestId` to make the call safe to retry.",
      ok: row,
      okStatus: 201,
      errors: [409, 422, 429],
    }),
    body(input),
    idempotent,
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")

      const pairError = entityPairError(values)
      if (pairError) return c.json({ error: pairError }, 422)

      const [created] = await db
        .insert(documentRequests)
        .values({ ...values, requestedBy: c.get("user").id })
        .returning()
      return c.json(created, 201)
    },
  )

  .get(
    "/:id",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "Get a document request",
      ok: row,
      params: [idParam],
      errors: [404, 429],
    }),
    async (c) => {
      const [found] = await db
        .select()
        .from(documentRequests)
        // Soft-deleted requests are gone as far as this endpoint is concerned;
        // `:restore` is the only way back.
        .where(and(eq(documentRequests.id, c.req.param("id")), isNull(documentRequests.deletedAt)))
      return found ? c.json(found) : c.json({ error: "Not found" }, 404)
    },
  )

  .patch(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Update a document request",
      description: "Wording and destination only. Use `:fulfil` and `:cancel` to change status.",
      ok: row,
      params: [idParam],
      errors: [404, 409, 422, 429],
    }),
    body(input.partial()),
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")

      const pairError = entityPairError(values)
      if (pairError) return c.json({ error: pairError }, 422)

      // Retargeting a request that has already been answered would leave the
      // stored file sitting in the old folder while the row claims the new
      // one. Only open requests are editable.
      const [updated] = await db
        .update(documentRequests)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(documentRequests.id, c.req.param("id")),
            eq(documentRequests.status, "open"),
            isNull(documentRequests.deletedAt),
          ),
        )
        .returning()
      if (updated) return c.json(updated)

      const [exists] = await db
        .select({ status: documentRequests.status })
        .from(documentRequests)
        .where(and(eq(documentRequests.id, c.req.param("id")), isNull(documentRequests.deletedAt)))
      if (!exists) return c.json({ error: "Not found" }, 404)
      return c.json(
        { error: `Only an open request can be edited (it is "${exists.status}").` },
        409,
      )
    },
  )

  /**
   * Custom actions live behind a verb rather than a magic PATCH field:
   * `POST /v1/document-requests/{id}:fulfil`.
   */
  .post(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Run an action on a document request",
      description:
        "`:fulfil` (body: `{ fileId }`), `:cancel`, or `:restore`, which undoes a soft delete.",
      ok: row,
      params: [{ ...idParam, description: "Record id followed by `:action`, e.g. `abc:fulfil`" }],
      errors: [404, 409, 422, 429],
    }),
    body(actionInput),
    actions("id", {
      fulfil: async (c, id) => {
        const { fileId } = actionBody<z.infer<typeof actionInput>>(c)

        // Guard clauses first, in the order a reader would ask the questions.
        if (!fileId) {
          return c.json(
            { error: "`:fulfil` needs a `fileId` naming the file that answered it." },
            422,
          )
        }

        const [file] = await db.select({ id: files.id }).from(files).where(eq(files.id, fileId))
        // A request may only point at a file that exists. Storing a dangling
        // id would satisfy the CHECK and still be a lie.
        if (!file) return c.json({ error: `No file ${fileId}.` }, 422)

        const now = new Date()
        // Compare-and-set: the `status = 'open'` in the WHERE is what makes
        // this atomic. Two callers racing to fulfil the same request cannot
        // both win, and neither can read-then-write past the other.
        const [fulfilled] = await db
          .update(documentRequests)
          .set({
            status: "fulfilled",
            fileId,
            fulfilledAt: now,
            fulfilledBy: c.get("user").id,
            updatedAt: now,
          })
          .where(
            and(
              eq(documentRequests.id, id),
              eq(documentRequests.status, "open"),
              isNull(documentRequests.deletedAt),
            ),
          )
          .returning()
        if (fulfilled) return c.json(fulfilled)

        const [exists] = await db
          .select({ status: documentRequests.status })
          .from(documentRequests)
          .where(and(eq(documentRequests.id, id), isNull(documentRequests.deletedAt)))
        if (!exists) return c.json({ error: "Not found" }, 404)
        return c.json(
          { error: `Only an open request can be fulfilled (it is "${exists.status}").` },
          409,
        )
      },

      cancel: async (c, id) => {
        const [cancelled] = await db
          .update(documentRequests)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(
            and(
              eq(documentRequests.id, id),
              eq(documentRequests.status, "open"),
              isNull(documentRequests.deletedAt),
            ),
          )
          .returning()
        if (cancelled) return c.json(cancelled)

        const [exists] = await db
          .select({ status: documentRequests.status })
          .from(documentRequests)
          .where(and(eq(documentRequests.id, id), isNull(documentRequests.deletedAt)))
        if (!exists) return c.json({ error: "Not found" }, 404)
        // Cancelling a fulfilled request would have to unpick the file link,
        // which is a different decision than "never mind".
        return c.json(
          { error: `Only an open request can be cancelled (it is "${exists.status}").` },
          409,
        )
      },

      restore: async (c, id) => {
        const [restored] = await db
          .update(documentRequests)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(documentRequests.id, id))
          .returning()
        return restored ? c.json(restored) : c.json({ error: "Not found" }, 404)
      },
    }),
  )

  .delete(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Delete a document request",
      description: "Soft delete: the row is kept and hidden. Restore with `:restore`.",
      params: [idParam],
      errors: [404, 429],
    }),
    async (c) => {
      const [deleted] = await db
        .update(documentRequests)
        .set({ deletedAt: new Date() })
        .where(and(eq(documentRequests.id, c.req.param("id")), isNull(documentRequests.deletedAt)))
        .returning()
      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )
