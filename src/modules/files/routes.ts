import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

import { and, eq, isNull } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono } from "hono"

import { db } from "@/server/db"
import { requireAuth } from "@/server/middleware"
import { describe, idParam, listParams, pageOf, type Param } from "@/server/openapi"
import { LIMITS, rateLimit } from "@/server/rate-limit"
import { actions, listOrder, listWhere, page, parseList, type ListSpec } from "@/server/rest"

import { files } from "./schema"
import { MAX_BYTES, newKey, resolveKey, write } from "./storage"

const tag = "files"
const row = createSelectSchema(files)

const spec: ListSpec = {
  table: files,
  columns: {
    name: files.name,
    mime_type: files.mimeType,
    size: files.size,
    entity_type: files.entityType,
    entity_id: files.entityId,
    created_at: files.createdAt,
  },
  id: files.id,
  defaultSort: "-created_at",
  deletedAt: files.deletedAt,
}

const LIST_COLUMNS = ["name", "mime_type", "size", "entity_type", "entity_id", "created_at"]

const PARENT_PARAMS: Param[] = [
  {
    name: "parentType",
    in: "path",
    required: true,
    description: "Parent collection, e.g. projects",
    schema: { type: "string" },
  },
  {
    name: "parentId",
    in: "path",
    required: true,
    description: "Parent record id",
    schema: { type: "string" },
  },
]

export const routes = new Hono()
  .use("*", requireAuth)

  .get(
    "/",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "List files",
      description: "Scope with `?filter=entity_type:projects;entity_id:<id>`.",
      ok: pageOf(row),
      params: listParams(LIST_COLUMNS),
      errors: [400, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)
      const rows = await db
        .select()
        .from(files)
        .where(listWhere(request, spec))
        .orderBy(...listOrder(request, spec))
        .limit(request.pageSize + 1)
      return c.json(page(rows, request, spec))
    },
  )

  .post(
    "/",
    rateLimit(LIMITS.upload),
    describe({
      tag,
      summary: "Upload a file",
      description: "Send multipart/form-data.",
      requestContent: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["file"],
            properties: {
              file: { type: "string", format: "binary" },
              entityType: {
                type: "string",
                description: 'Scope to a record type, e.g. "projects"',
              },
              entityId: { type: "string", description: "Id of that record" },
            },
          },
        },
      },
      ok: row,
      okStatus: 201,
      errors: [413, 422, 429],
    }),
    async (c) => {
      const form = await c.req.formData()
      const file = form.get("file")

      if (!(file instanceof File)) return c.json({ error: "Expected a file field" }, 422)
      // A zero-byte upload is a failed upload. Accepting it stores a file that
      // can never be opened, and the CHECK constraint would reject it anyway.
      if (file.size === 0) return c.json({ error: "File is empty" }, 422)
      if (file.size > MAX_BYTES) {
        return c.json({ error: `Too large. Limit is ${MAX_BYTES / 1024 / 1024}MB.` }, 413)
      }

      // Scope is all-or-nothing: half a reference points nowhere.
      const entityType = (form.get("entityType") as string) || null
      const entityId = (form.get("entityId") as string) || null
      if (Boolean(entityType) !== Boolean(entityId)) {
        return c.json({ error: "Send entityType and entityId together, or neither" }, 422)
      }

      const key = newKey(file.name)
      const size = await write(key, Buffer.from(await file.arrayBuffer()))
      const [created] = await db
        .insert(files)
        .values({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size,
          storageKey: key,
          entityType,
          entityId,
          uploadedBy: c.get("user").id,
        })
        .returning()
      return c.json(created, 201)
    },
  )

  .get(
    "/:id/content",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "Download a file",
      description: "Streams the bytes. Sessions are checked, so links are not public.",
      okStatus: 200,
      okContent: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      const [found] = await db
        .select()
        .from(files)
        .where(and(eq(files.id, c.req.param("id")), isNull(files.deletedAt)))
      if (!found) return c.json({ error: "Not found" }, 404)

      const stream = createReadStream(resolveKey(found.storageKey))
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          "Content-Type": found.mimeType,
          "Content-Length": String(found.size),
          "Content-Disposition": `attachment; filename="${encodeURIComponent(found.name)}"`,
        },
      })
    },
  )

  .post(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Run an action on a file",
      description: "`:restore` undoes a soft delete.",
      ok: row,
      params: [{ ...idParam, description: "Record id followed by `:action`, e.g. `abc:restore`" }],
      errors: [404],
    }),
    actions("id", {
      restore: async (c, id) => {
        const [restored] = await db
          .update(files)
          .set({ deletedAt: null })
          .where(eq(files.id, id))
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
      summary: "Delete a file",
      description:
        "Soft delete. The bytes stay on disk so `:restore` works; purging is a housekeeping job.",
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      const [deleted] = await db
        .update(files)
        .set({ deletedAt: new Date() })
        .where(and(eq(files.id, c.req.param("id")), isNull(files.deletedAt)))
        .returning()
      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )

/** Cross-referenced form: `GET /api/v1/projects/{id}/files`. */
export const nested = new Hono().use("*", requireAuth).get(
  "/",
  rateLimit(LIMITS.read),
  describe({
    tag,
    summary: "List a record's files",
    ok: pageOf(row),
    params: [...PARENT_PARAMS, ...listParams(LIST_COLUMNS)],
    errors: [400, 429],
  }),
  async (c) => {
    const parentType = c.req.param("parentType")
    const parentId = c.req.param("parentId")
    if (!parentType || !parentId) {
      return c.json({ error: "Both parentType and parentId are required" }, 400)
    }

    const request = parseList(c, spec)
    const rows = await db
      .select()
      .from(files)
      .where(
        listWhere(request, spec, [eq(files.entityType, parentType), eq(files.entityId, parentId)]),
      )
      .orderBy(...listOrder(request, spec))
      .limit(request.pageSize + 1)
    return c.json(page(rows, request, spec))
  },
)
