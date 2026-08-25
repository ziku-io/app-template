import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

import { Hono } from "hono"
import { and, desc, eq, type SQL } from "drizzle-orm"

import { db } from "@/server/db"
import { requireAuth } from "@/server/middleware"

import { files } from "./schema"
import { MAX_BYTES, newKey, remove, resolveKey, write } from "./storage"

export const routes = new Hono()
  .use("*", requireAuth)

  /** List, optionally scoped to a record: `?entityType=project&entityId=…`. */
  .get("/", async (c) => {
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

  .post("/", async (c) => {
    const form = await c.req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return c.json({ error: "Expected a file field" }, 422)
    if (file.size > MAX_BYTES) {
      return c.json({ error: `Too large. Limit is ${MAX_BYTES / 1024 / 1024}MB.` }, 413)
    }

    const key = newKey(file.name)
    const size = await write(key, Buffer.from(await file.arrayBuffer()))
    const [row] = await db
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
    return c.json(row, 201)
  })

  /** Streams the file. Sessions are checked above, so links are not public. */
  .get("/:id/download", async (c) => {
    const [row] = await db.select().from(files).where(eq(files.id, c.req.param("id")))
    if (!row) return c.json({ error: "Not found" }, 404)

    const stream = createReadStream(resolveKey(row.storageKey))
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        "Content-Type": row.mimeType,
        "Content-Length": String(row.size),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(row.name)}"`,
      },
    })
  })

  .delete("/:id", async (c) => {
    const [row] = await db.delete(files).where(eq(files.id, c.req.param("id"))).returning()
    if (!row) return c.json({ error: "Not found" }, 404)
    await remove(row.storageKey)
    return c.body(null, 204)
  })
