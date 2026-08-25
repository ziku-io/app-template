import { and, eq, ilike, isNull, or, type SQL } from "drizzle-orm"
import { createSelectSchema } from "drizzle-zod"
import { Hono } from "hono"
import { z } from "zod"

import { db } from "@/server/db"
import { idempotent } from "@/server/idempotency"
import { requireAuth } from "@/server/middleware"
import { body, describe, idParam, listParams, pageOf } from "@/server/openapi"
import { LIMITS, rateLimit } from "@/server/rate-limit"
import { actions, listOrder, listWhere, page, parseList, type ListSpec } from "@/server/rest"

import { TASK_PRIORITIES, TASK_STATUSES, tasks, type Task } from "./schema"

/**
 * Tasks: assignable work items with exactly one level of subtasks.
 *
 * Follows the same conventions as the projects module — plural noun, cursor
 * paging, allowlisted sort and filter, soft delete, idempotent create, rate
 * limits — plus the depth rule that lives here rather than in the schema.
 */

const tag = "tasks"

/** Sortable and filterable columns, by the name callers use. */
const spec: ListSpec = {
  table: tasks,
  columns: {
    title: tasks.title,
    status: tasks.status,
    priority: tasks.priority,
    assignee_id: tasks.assigneeId,
    entity_type: tasks.entityType,
    entity_id: tasks.entityId,
    parent_id: tasks.parentId,
    due_date: tasks.dueDate,
    completed_at: tasks.completedAt,
    created_at: tasks.createdAt,
  },
  id: tasks.id,
  defaultSort: "-created_at",
  searchable: [tasks.title],
  deletedAt: tasks.deletedAt,
}

const FILTERABLE = Object.keys(spec.columns)

const row = createSelectSchema(tasks)

/**
 * .strict(): an unknown field is a typo or a stale client, and either way the
 * caller deserves a 422 rather than a silently ignored value.
 *
 * `completedAt` is deliberately absent: it is derived from the status, so the
 * only ways to set it are `:complete` and a status change. A body carrying it
 * gets a 422 naming the fields that ARE allowed.
 */
const input = z
  .object({
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    assigneeId: z.string().min(1).nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    parentId: z.uuid().nullable().optional(),
    entityType: z.string().min(1).nullable().optional(),
    entityId: z.string().min(1).nullable().optional(),
    /** Makes the create safe to retry. See docs/rest-standards.md. */
    requestId: z.string().min(8).optional(),
  })
  .strict()

/** The one row a mutation may touch: present, and not soft-deleted. */
async function liveTask(id: string): Promise<Task | undefined> {
  const [found] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
  return found
}

/**
 * Subtasks are one level deep, and that rule cannot be a CHECK constraint: a
 * row-level check sees only its own row, so "my parent has no parent" needs a
 * second row and Postgres will not read one from a CHECK. A trigger could, at
 * the price of a rule living somewhere no reader of this file would look. So
 * the guard is here, on the two paths that can break it — create and re-parent
 * — and the FK plus `tasks_parent_not_self` cover what SQL can express.
 *
 * Returns an error response, or null when the move is allowed.
 */
async function rejectBadParent(
  childId: string | null,
  parentId: string,
): Promise<{ status: 404 | 409 | 422; error: string } | null> {
  if (childId && parentId === childId) {
    return { status: 409, error: "A task cannot be its own parent." }
  }

  const parent = await liveTask(parentId)
  if (!parent) {
    return {
      status: 422,
      error: `No task ${parentId}. parentId must be the id of an existing, non-deleted task.`,
    }
  }

  if (parent.parentId) {
    return {
      status: 409,
      error:
        `Task ${parentId} is already a subtask, and subtasks are one level deep. ` +
        `Attach this task to ${parent.parentId} instead.`,
    }
  }

  if (childId) {
    // Moving a parent under someone else would push its own children to depth
    // two. Reject it and name the fix.
    const [child] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.parentId, childId), isNull(tasks.deletedAt)))
      .limit(1)
    if (child) {
      return {
        status: 409,
        error:
          `Task ${childId} has subtasks of its own, so it cannot become a subtask. ` +
          `Move or delete its subtasks first.`,
      }
    }
  }

  return null
}

export const routes = new Hono()
  .use("*", requireAuth)

  .get(
    "/",
    rateLimit(LIMITS.read),
    describe({
      tag,
      summary: "List tasks",
      description:
        "Cursor-paged. Follow `nextPageToken` until it is null. Filter with " +
        "`?filter=status:todo,doing;priority:high`, search titles with `?q=`.",
      ok: pageOf(row),
      params: listParams(FILTERABLE),
      errors: [400, 429],
    }),
    async (c) => {
      const request = parseList(c, spec)

      const search = request.q
        ? or(...spec.searchable!.map((column) => ilike(column, `%${request.q}%`)))
        : undefined

      const rows = await db
        .select()
        .from(tasks)
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
      summary: "Create a task",
      description:
        "Send a `requestId` to make the call safe to retry. Pass `parentId` to " +
        "create a subtask; subtasks are one level deep.",
      ok: row,
      okStatus: 201,
      errors: [409, 422, 429],
    }),
    body(input),
    idempotent,
    async (c) => {
      const { requestId: _ignored, ...values } = c.req.valid("json")

      if (values.parentId) {
        const rejected = await rejectBadParent(null, values.parentId)
        if (rejected) return c.json({ error: rejected.error }, rejected.status)
      }

      const [created] = await db
        .insert(tasks)
        .values({
          ...values,
          // Keeps `tasks_completed_at_requires_done` satisfied without asking
          // the caller to keep two fields in step.
          completedAt: values.status === "done" ? new Date() : null,
          createdBy: c.get("user").id,
        })
        .returning()
      return c.json(created, 201)
    },
  )

  .get(
    "/:id",
    rateLimit(LIMITS.read),
    describe({ tag, summary: "Get a task", ok: row, params: [idParam], errors: [404] }),
    async (c) => {
      const [found] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, c.req.param("id")))
      return found ? c.json(found) : c.json({ error: "Not found" }, 404)
    },
  )

  .patch(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Update a task",
      description: "Setting `status` keeps `completedAt` in step; you cannot send it yourself.",
      ok: row,
      params: [idParam],
      errors: [404, 409, 422],
    }),
    body(input.partial()),
    async (c) => {
      const id = c.req.param("id")
      const { requestId: _ignored, ...values } = c.req.valid("json")

      if (values.parentId) {
        const rejected = await rejectBadParent(id, values.parentId)
        if (rejected) return c.json({ error: rejected.error }, rejected.status)
      }

      const [updated] = await db
        .update(tasks)
        .set({
          ...values,
          // Only touch completedAt when the status actually moves, so editing
          // a title on a done task does not rewrite its history.
          ...(values.status ? { completedAt: values.status === "done" ? new Date() : null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
        .returning()
      return updated ? c.json(updated) : c.json({ error: "Not found" }, 404)
    },
  )

  /**
   * Custom actions live behind a verb rather than a magic PATCH field:
   * `POST /v1/tasks/{id}:complete`.
   */
  .post(
    "/:id",
    rateLimit(LIMITS.write),
    describe({
      tag,
      summary: "Run an action on a task",
      description:
        "`:complete` marks it done, `:reopen` sends it back to todo, `:restore` " +
        "undoes a soft delete.",
      ok: row,
      params: [{ ...idParam, description: "Record id followed by `:action`, e.g. `abc:complete`" }],
      errors: [404],
    }),
    actions("id", {
      complete: async (c, id) => {
        const found = await liveTask(id)
        if (!found) return c.json({ error: "Not found" }, 404)
        // Completing a done task is what a retry looks like. Answer with the
        // row rather than an error: the caller's intent already holds.
        if (found.status === "done") return c.json(found)

        const [done] = await db
          .update(tasks)
          .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
          .returning()
        return done ? c.json(done) : c.json({ error: "Not found" }, 404)
      },

      reopen: async (c, id) => {
        const found = await liveTask(id)
        if (!found) return c.json({ error: "Not found" }, 404)
        if (found.status !== "done") return c.json(found)

        const [reopened] = await db
          .update(tasks)
          .set({ status: "todo", completedAt: null, updatedAt: new Date() })
          .where(and(eq(tasks.id, id), isNull(tasks.deletedAt)))
          .returning()
        return reopened ? c.json(reopened) : c.json({ error: "Not found" }, 404)
      },

      restore: async (c, id) => {
        const [restored] = await db
          .update(tasks)
          .set({ deletedAt: null, updatedAt: new Date() })
          .where(eq(tasks.id, id))
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
      summary: "Delete a task",
      description: "Soft delete: the row is kept and hidden. Restore with `:restore`.",
      params: [idParam],
      errors: [404],
    }),
    async (c) => {
      const [deleted] = await db
        .update(tasks)
        .set({ deletedAt: new Date() })
        .where(and(eq(tasks.id, c.req.param("id")), isNull(tasks.deletedAt)))
        .returning()
      return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404)
    },
  )
