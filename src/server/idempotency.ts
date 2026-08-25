import { and, eq } from "drizzle-orm"
import type { Context, Next } from "hono"

import { db } from "./db"
import { idempotencyKeys } from "./db/core-schema"

/**
 * Makes POST safe to retry. The caller puts a `requestId` in the body; the
 * first response is stored against it and replayed for any repeat.
 *
 * Without this, a client that times out and retries creates two records and has
 * no way to tell. With it, retrying is free — which is what lets the client
 * retry at all.
 */
export async function idempotent(c: Context, next: Next) {
  if (c.req.method !== "POST") return next()

  // Read the body once and hand the parsed copy on: the stream is consumed.
  let body: Record<string, unknown>
  try {
    body = await c.req.raw.clone().json()
  } catch {
    return next() // not JSON (multipart upload, say) — nothing to key on
  }

  const requestId = typeof body?.requestId === "string" ? body.requestId : null
  if (!requestId) return next()

  const endpoint = `${c.req.method} ${c.req.path}`
  const userId = c.get("user")?.id ?? "anonymous"

  const [seen] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.requestId, requestId), eq(idempotencyKeys.userId, userId)))

  if (seen) {
    if (seen.endpoint !== endpoint) {
      return c.json({ error: `requestId already used for ${seen.endpoint}` }, 409)
    }
    // The replay is flagged so a caller can tell it did not create anything.
    c.header("Idempotent-Replay", "true")
    return seen.body === null
      ? c.body(null, seen.status as 204)
      : c.json(seen.body as object, seen.status as 200)
  }

  await next()

  // Only successes are worth replaying: a 500 should be retryable for real.
  if (c.res.status >= 200 && c.res.status < 300) {
    const stored =
      c.res.status === 204
        ? null
        : await c.res
            .clone()
            .json()
            .catch(() => null)
    await db
      .insert(idempotencyKeys)
      .values({ requestId, userId, endpoint, status: c.res.status, body: stored })
      .onConflictDoNothing()
  }
}
