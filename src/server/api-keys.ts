import { eq } from "drizzle-orm"
import type { Context } from "hono"

import { db } from "./db"
import { apiKeys } from "./db/core-schema"
import { canonicalString, equals, sign } from "./signing"

/**
 * Verifying signed requests against the stored keys. The scheme itself lives in
 * signing.ts, which has no database in it.
 *
 *   X-API-KEY            the key id
 *   X-EXPIRY             unix seconds; the request is refused after it
 *   X-REQUEST-SIGNATURE  hex hmac-sha256(secret, canonical string)
 */

/** How far ahead an expiry may be, so one capture cannot last forever. */
const MAX_SKEW_SECONDS = 300

export interface ApiKeyResult {
  ok: boolean
  userId?: string
  error?: string
}

/**
 * Returns `{ ok: false }` with no error when the headers are simply absent, so
 * a caller can fall through to session auth. A partial set is an error: it is
 * someone trying to sign and getting it wrong, not a browser.
 */
export async function verifySignedRequest(c: Context): Promise<ApiKeyResult> {
  const keyId = c.req.header("x-api-key")
  const expiry = c.req.header("x-expiry")
  const signature = c.req.header("x-request-signature")

  if (!keyId && !expiry && !signature) return { ok: false }
  if (!keyId || !expiry || !signature) {
    return { ok: false, error: "Signed requests need X-API-KEY, X-EXPIRY and X-REQUEST-SIGNATURE" }
  }

  const expiresAt = Number(expiry)
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(expiresAt)) return { ok: false, error: "X-EXPIRY must be unix seconds" }
  if (expiresAt < now) return { ok: false, error: "Request expired" }
  if (expiresAt > now + MAX_SKEW_SECONDS) {
    return { ok: false, error: `X-EXPIRY may be at most ${MAX_SKEW_SECONDS}s ahead` }
  }

  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyId, keyId))
  if (!key || key.revokedAt) return { ok: false, error: "Unknown or revoked key" }

  const url = new URL(c.req.url)
  const body =
    c.req.method === "GET" || c.req.method === "DELETE" ? "" : await c.req.raw.clone().text()

  const expected = sign(
    key.secretHash,
    canonicalString({
      method: c.req.method,
      path: url.pathname,
      query: url.search.replace(/^\?/, ""),
      expiry,
      body,
    }),
  )

  if (!equals(expected, signature)) return { ok: false, error: "Bad signature" }

  // Fire and forget: a failed timestamp write must not fail the request.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => {})

  return { ok: true, userId: key.userId }
}
