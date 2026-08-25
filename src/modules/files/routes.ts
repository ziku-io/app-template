import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

import { Hono } from "hono"
import { and, desc, eq, type SQL } from "drizzle-orm"

import { createSelectSchema } from "drizzle-zod"

import { db } from "@/server/db"
import { requireAuth } from "@/server/middleware"
import { describe, idParam, listOf, type Param } from "@/server/openapi"

import { files } from "./schema"
import { MAX_BYTES, newKey, remove, resolveKey, write } from "./storage"

const tag = "files"
const row = createSelectSchema(files)
const scope: Param[] = [
  {
    name: "entityType",
    in: "query",
    description: 'Scope to a record type, e.g. "project"',
    schema: { type: "string" },
  },
  {
    name: "entityId",
    in: "query",
    description: "Id of that record",
    schema: { type: "string" },
  },
]

export const routes = new Hono()
  .use("*", requireAuth)

  .get("/", describe({ tag, summary: "List files", ok: listOf(row), params: scope }), async (c) => {
    const { entityType, entityId } = c.req.query()
    const where: SQL[] = []
    if (entityType) where.push(eq(files.entityType, entityType))
    if (entityId) where.push(eq(files.entityId, entityId))

    const rows = await db
      .select()
      .from(files)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(files.createdAt))
      .limit(500)
    return c.json({ rows, total: rows.length })
  })

  .post(
    "/",
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
              entityType: { type: "string", description: 'Scope to a record type, e.g. "project"' },
              entityId: { type: "string", description: "Id of that record" },
            },
          },
        },
      },
      ok: row,
      okStatus: 201,
      errors: [413, 422],
    }),
    async (c) => {
      const form = await c.req.formData()
      const file = form.get("file")
      if (!(file instanceof File)) return c.json({ error: "Expected a file field" }, 422)
      if (file.size > MAX_BYTES) {
        return c.json({ error: `Too large. Limit is ${MAX_BYTES / 1024 / 1024}MB.` }, 413)
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
          entityType: (form.get("entityType") as string) || null,
          entityId: (form.get("entityId") as string) || null,
          uploadedBy: c.get("user").id,
        })
        .returning()
      return c.json(created, 201)
    },
  )

  .get(
    "/:id/download",
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
      const [row] = await db
        .select()
        .from(files)
        .where(eq(files.id, c.req.param("id")))
      if (!row) return c.json({ error: "Not found" }, 404)

      const stream = createReadStream(resolveKey(row.storageKey))
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          "Content-Type": row.mimeType,
          "Content-Length": String(row.size),
          "Content-Disposition": `attachment; filename="${encodeURIComponent(row.name)}"`,
        },
      })
    },
  )

  .delete(
    "/:id",
    describe({
      tag,
      summary: "Delete a file",
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      const [row] = await db
        .delete(files)
        .where(eq(files.id, c.req.param("id")))
        .returning()
      if (!row) return c.json({ error: "Not found" }, 404)
      await remove(row.storageKey)
      return c.body(null, 204)
    },
  )
