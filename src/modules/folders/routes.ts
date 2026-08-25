import { and, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono } from "hono"
import { z } from "zod"

import { files } from "@/modules/files/schema"
import { db } from "@/server/db"
import { idempotent } from "@/server/idempotency"
import { requireAuth } from "@/server/middleware"
import { body, describe, idParam, listParams, pageOf, type Param } from "@/server/openapi"
import { LIMITS, rateLimit } from "@/server/rate-limit"
import { actions, listOrder, listWhere, page, parseList, type ListSpec } from "@/server/rest"

import { folders, type Folder } from "./schema"

/**
 * Folders: a nested tree over the `files` module.
 *
 * Everything that can corrupt a tree is a guard here — a folder inside itself,
 * a folder moved into its own descendant, a delete that would strand children
 * or files. Each one answers 409 with a message naming the way out.
 */

const tag = "folders"

const spec: ListSpec = {
  table: folders,
  columns: {
    name: folders.name,
    parent_id: folders.parentId,
    entity_type: folders.entityType,
    entity_id: folders.entityId,
    created_at: folders.createdAt,
  },
  id: folders.id,
  defaultSort: "name",
  searchable: [folders.name],
  deletedAt: folders.deletedAt,
}

const FILTERABLE = Object.keys(spec.columns)

const row = createSelectSchema(folders)

/** .strict(): unknown fields are a typo or a stale client. 422, never ignored. */
const input = z
  .object({
    name: z.string().min(1),
    parentId: z.uuid().nullable().optional(),
    entityType: z.string().min(1).nullable().optional(),
    entityId: z.string().min(1).nullable().optional(),
    /** Makes the create safe to retry. See docs/rest-standards.md. */
    requestId: z.string().min(8).optional(),
  })
  .strict()

const scope: Param[] = [
  {
    name: "parentId",
    in: "query",
    description: 'Folder id, or "root" for the top level',
    schema: { type: "string" },
  },
  {
    name: "entityType",
    in: "query",
    description: 'Scope to a record type, e.g. "project"',
    schema: { type: "string" },
  },
  { name: "entityId", in: "query", description: "Id of that record", schema: { type: "string" } },
]

/** The one row a mutation may touch: present, and not soft-deleted. */
async function liveFolder(id: string): Promise<Folder | undefined> {
  const [found] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), isNull(folders.deletedAt)))
  return found
}

/**
 * Would putting `id` under `parentId` close a cycle?
 *
 * True when `id` is `parentId` itself or any of its ancestors. Walking upwards
 * is the cheap direction: a folder has one parent, so the CTE visits at most
 * the depth of the tree, while walking down would visit every descendant.
 *
 * Without this the two folders would point at each other and drop out of every
 * query rooted at the top level — invisible, undeletable, still holding files.
 */
async function wouldCycle(id: string, parentId: string): Promise<boolean> {
  const ancestors = await db.execute(sql`
    with recursive ancestors as (
      select f.id, f.parent_id
        from ${folders} f
       where f.id = ${parentId}
         and f.deleted_at is null
      union all
      select f.id, f.parent_id
        from ${folders} f
        join ancestors a on f.id = a.parent_id
       where f.deleted_at is null
    )
    select id from ancestors where id = ${id} limit 1
  `)
  return (ancestors as unknown as unknown[]).length > 0
}

/** Every live folder in the subtree rooted at `id`, including `id` itself. */
async function subtree(id: string): Promise<Folder[]> {
  const rows = await db.execute(sql`
    with recursive subtree as (
      select f.id, f.name, f.parent_id, f.entity_type, f.entity_id,
             f.created_by, f.created_at, f.updated_at, f.deleted_at
        from ${folders} f
       where f.id = ${id}
         and f.deleted_at is null
      union all
      select f.id, f.name, f.parent_id, f.entity_type, f.entity_id,
             f.created_by, f.created_at, f.updated_at, f.deleted_at
        from ${folders} f
        join subtree s on f.parent_id = s.id
       where f.deleted_at is null
    )
    select * from subtree
  `)

  return (rows as unknown as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    parentId: (r.parent_id as string | null) ?? null,
    entityType: (r.entity_type as string | null) ?? null,
    entityId: (r.entity_id as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    deletedAt: r.deleted_at ? new Date(r.deleted_at as string) : null,
  }))
}

interface TreeNode extends Folder {
  children: TreeNode[]
}

/** Flat CTE rows → the nested shape the client renders. */
function nest(rows: Folder[], rootId: string): TreeNode | null {
  const byId = new Map<string, TreeNode>(rows.map((r) => [r.id, { ...r, children: [] }]))
  for (const node of byId.values()) {
    if (node.id === rootId) continue
    // A row whose parent is missing cannot happen: the CTE only reaches a row
    // through its parent. Skipping it silently would hide a real bug, so this
    // stays an explicit lookup and the root is the only parentless node.
    byId.get(node.parentId ?? "")?.children.push(node)
  }
  for (const node of byId.values()) node.children.sort((a, b) => a.name.localeCompare(b.name))
  return byId.get(rootId) ?? null
}

/** Two live siblings may not share a name. Checked here so the caller gets a
 *  409 with a message instead of a unique-violation 500 from the index. */
async function siblingNameTaken(parentId: string | null, name: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId),
        eq(folders.name, name),
        isNull(folders.deletedAt),
        exceptId ? ne(folders.id, exceptId) : undefined,
      ),
    )
    .limit(1)
  return Boolean(clash)
}

export const routes = new Hono()
  .use("*", requireAuth)

  .get(
    "/",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "List folders",
      description:
        "Cursor-paged. `?parentId=root` lists the top level, `?parentId={id}` lists " +
        "one folder's direct children. Follow `nextPageToken` until it is null.",
      ok: pageOf(row),
      params: listParams(FILTERABLE, scope),
      errors: [400, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)
      const { parentId, entityType, entityId } = c.req.query()

      const extra: (SQL | undefined)[] = []
      if (parentId === "root") {
        extra.push(isNull(folders.parentId))
      } else if (parentId) {
        // An allowlist of one shape plus the literal "root": anything else is a
        // caller bug, and answering 200 with every folder would hide it.
        if (!z.uuid().safeParse(parentId).success) {
          return c.json({ error: 'parentId must be a folder id or "root".' }, 400)
        }
        extra.push(eq(folders.parentId, parentId))
      }
      if (entityType) extra.push(eq(folders.entityType, entityType))
      if (entityId) extra.push(eq(folders.entityId, entityId))
      if (request.q) extra.push(or(...spec.searchable!.map((col) => ilike(col, `%${request.q}%`))))

      const rows = await db
        .select()
        .from(folders)
        .where(listWhere(request, spec, extra))
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
      summary: "Create a folder",
      description: "Send a `requestId` to make the call safe to retry.",
      ok: row,
      okStatus: 201,
      errors: [409, 422, 429],
    }),
    body(input),
    idempotent,
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")
      const parentId = values.parentId ?? null

      if (parentId && !(await liveFolder(parentId))) {
        return c.json(
          { error: `No folder ${parentId}. parentId must be an existing, non-deleted folder.` },
          422,
        )
      }
      if (await siblingNameTaken(parentId, values.name)) {
        return c.json(
          { error: `A folder named "${values.name}" already exists here. Pick another name.` },
          409,
        )
      }

      const [created] = await db
        .insert(folders)
        .values({ ...values, createdBy: c.get("user").id })
        .returning()
      return c.json(created, 201)
    },
  )

  .get(
    "/:id/tree",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "Get a folder's subtree",
      description:
        "The folder and every live descendant, nested. Walked with a recursive CTE, " +
        "so it is one query however deep the tree is.",
      ok: z.object({ tree: z.unknown(), total: z.number().int() }),
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      const id = c.req.param("id")
      if (!z.uuid().safeParse(id).success) return c.json({ error: "Not found" }, 404)

      const rows = await subtree(id)
      if (!rows.length) return c.json({ error: "Not found" }, 404)
      return c.json({ tree: nest(rows, id), total: rows.length })
    },
  )

  .get(
    "/:id",
    rateLimit(LIMITS.read),
    describe({ tag, summary: "Get a folder", ok: row, params: [idParam], errors: [404] }),
    async (c) => {
      const [found] = await db
        .select()
        .from(folders)
        .where(eq(folders.id, c.req.param("id")))
      return found ? c.json(found) : c.json({ error: "Not found" }, 404)
    },
  )

  .patch(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Rename or move a folder",
      description:
        "`parentId: null` moves it to the top level. A move into the folder's own " +
        "descendant is rejected — it would detach the whole subtree.",
      ok: row,
      params: [idParam],
      errors: [404, 409, 422],
    }),
    body(input.partial()),
    async (c) => {
      const id = c.req.param("id")
      const { requestId: _ignored, ...values } = c.req.valid("json")

      const current = await liveFolder(id)
      if (!current) return c.json({ error: "Not found" }, 404)

      const moving = "parentId" in values
      const parentId = moving ? (values.parentId ?? null) : current.parentId

      if (moving && parentId) {
        if (parentId === id) {
          return c.json({ error: "A folder cannot be its own parent." }, 409)
        }
        if (!(await liveFolder(parentId))) {
          return c.json(
            { error: `No folder ${parentId}. parentId must be an existing, non-deleted folder.` },
            422,
          )
        }
        if (await wouldCycle(id, parentId)) {
          return c.json(
            {
              error:
                `Folder ${parentId} is inside ${id}, so moving ${id} there would create a ` +
                `cycle and detach the whole subtree. Move it to a folder outside its own ` +
                `descendants, or to the top level with parentId: null.`,
            },
            409,
          )
        }
      }

      const name = values.name ?? current.name
      if ((moving || values.name) && (await siblingNameTaken(parentId, name, id))) {
        return c.json(
          { error: `A folder named "${name}" already exists there. Pick another name.` },
          409,
        )
      }

      const [updated] = await db
        .update(folders)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(folders.id, id), isNull(folders.deletedAt)))
        .returning()
      return updated ? c.json(updated) : c.json({ error: "Not found" }, 404)
    },
  )

  .post(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Run an action on a folder",
      description: "Currently `:restore`, which undoes a soft delete.",
      ok: row,
      params: [{ ...idParam, description: "Record id followed by `:action`, e.g. `abc:restore`" }],
      errors: [404, 409],
    }),
    actions("id", {
      restore: async (c, id) => {
        const [found] = await db.select().from(folders).where(eq(folders.id, id))
        if (!found) return c.json({ error: "Not found" }, 404)

        // Restoring under a deleted parent would produce a folder no tree walk
        // reaches. Name the order the caller has to work in.
        if (found.parentId && !(await liveFolder(found.parentId))) {
          return c.json(
            { error: `Parent folder ${found.parentId} is deleted. Restore it first.` },
            409,
          )
        }
        if (await siblingNameTaken(found.parentId, found.name, id)) {
          return c.json(
            {
              error:
                `A folder named "${found.name}" was created here while this one was ` +
                `deleted. Rename that one first.`,
            },
            409,
          )
        }

        const [restored] = await db
          .update(folders)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(folders.id, id))
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
      summary: "Delete a folder",
      description:
        "Soft delete. A folder holding child folders or files is refused with a 409; " +
        "`?force=true` soft-deletes the whole subtree instead.",
      params: [
        idParam,
        {
          name: "force",
          in: "query",
          description: "Set to true to delete the subtree as well",
          schema: { type: "boolean" },
        },
      ],
      errors: [404, 409],
    }),
    async (c) => {
      const id = c.req.param("id")
      const force = c.req.query("force") === "true"

      const current = await liveFolder(id)
      if (!current) return c.json({ error: "Not found" }, 404)

      if (!force) {
        const [child] = await db
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.parentId, id), isNull(folders.deletedAt)))
          .limit(1)
        if (child) {
          return c.json(
            { error: "Folder has child folders. Delete them first, or pass ?force=true." },
            409,
          )
        }

        const [file] = await db
          .select({ id: files.id })
          .from(files)
          .where(and(eq(files.entityType, "folder"), eq(files.entityId, id)))
          .limit(1)
        if (file) {
          return c.json(
            { error: "Folder still holds files. Move them out first, or pass ?force=true." },
            409,
          )
        }
      }

      // Force: stamp the whole subtree in one statement, so no descendant is
      // left live under a deleted parent. The files stay as they are — the
      // files module owns those rows and their lifecycle is its call.
      const ids = force ? (await subtree(id)).map((f) => f.id) : [id]
      const deleted = await db
        .update(folders)
        .set({ deletedAt: new Date() })
        .where(and(inArray(folders.id, ids), isNull(folders.deletedAt)))
        .returning({ id: folders.id })

      return deleted.length ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )
