import { and, eq, isNull, sql, type Column, type SQL } from "drizzle-orm"

import { db } from "@/server/db"

import { assignments } from "./schema"

/**
 * The reusable half of this module: other modules import these to scope their
 * own lists and detail routes to what the caller is actually assigned to.
 *
 * ## Why 404 and not 403
 *
 * `assertAssigned` reports a record the caller is not assigned to as missing,
 * not as forbidden. A 403 confirms the record exists, which is a leak: the id
 * itself is information (that this client is ours, that this invoice number was
 * issued). 404 is the only answer that tells an unauthorised caller nothing,
 * and it costs an authorised one nothing, because they never see it.
 */

/** Thrown by `assertAssigned`. Handle it as a 404. See the note above. */
export class NotAssigned extends Error {
  constructor(
    readonly entityType: string,
    readonly entityId: string,
  ) {
    // The message is for logs, never for the response body — it names a record
    // the caller is not supposed to know about.
    super(`Not assigned to ${entityType} ${entityId}`)
    this.name = "NotAssigned"
  }
}

/**
 * A WHERE fragment restricting a list to the entities `userId` is assigned to.
 * Pass the primary key column of the table being listed:
 *
 * ```ts
 * .where(and(listWhere(request, spec), assignedOnly(user.id, "project", projects.id)))
 * ```
 *
 * The `::text` cast is deliberate: `entity_id` is text because the table is
 * polymorphic, while most primary keys are uuid, and Postgres will not compare
 * the two without being told to.
 */
export function assignedOnly(userId: string, entityType: string, entityIdColumn: Column): SQL {
  return sql`${entityIdColumn}::text in (
    select ${assignments.entityId}
    from ${assignments}
    where ${assignments.userId} = ${userId}
      and ${assignments.entityType} = ${entityType}
      and ${assignments.deletedAt} is null
  )`
}

/** True when `userId` has a live assignment on the record, whatever the role. */
export async function isAssigned(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  // Guard first: a blank argument is a caller bug, and answering "true" to one
  // would hand out access. Fail loudly rather than fall back to anything.
  if (!userId || !entityType || !entityId) {
    throw new TypeError("isAssigned needs a non-empty userId, entityType and entityId")
  }

  const [found] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, userId),
        eq(assignments.entityType, entityType),
        eq(assignments.entityId, entityId),
        isNull(assignments.deletedAt),
      ),
    )
    .limit(1)
  return Boolean(found)
}

/**
 * Throws `NotAssigned` unless the caller has a live assignment on the record.
 * Callers answer it with a 404, never a 403 — see the note at the top.
 */
export async function assertAssigned(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (!(await isAssigned(userId, entityType, entityId))) {
    throw new NotAssigned(entityType, entityId)
  }
}

/** True when `userId` owns the record. Ownership is the stronger of the two roles. */
export async function isOwner(
  userId: string,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  if (!userId || !entityType || !entityId) {
    throw new TypeError("isOwner needs a non-empty userId, entityType and entityId")
  }

  const [found] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, userId),
        eq(assignments.entityType, entityType),
        eq(assignments.entityId, entityId),
        eq(assignments.role, "owner"),
        isNull(assignments.deletedAt),
      ),
    )
    .limit(1)
  return Boolean(found)
}
