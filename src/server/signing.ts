import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * The signing scheme, with no database in it so it can be tested and reused by
 * a client SDK.
 *
 * A bare API key in a header is a bearer token: whoever reads it once can
 * replay anything, forever. Here the key only *names* the caller, and each
 * request carries an HMAC over the method, path, query, expiry and body. A
 * captured request is useless after its expiry and cannot be edited at all.
 */

/** What gets signed. Order and the separator matter; both sides must match. */
export function canonicalString(parts: {
  method: string
  path: string
  query: string
  expiry: string
  body: string
}) {
  // Newline-separated so "GET" + "/a" cannot collide with "GE" + "T/a".
  return [parts.method.toUpperCase(), parts.path, parts.query, parts.expiry, parts.body].join("\n")
}

export function sign(secret: string, canonical: string) {
  return createHmac("sha256", secret).update(canonical).digest("hex")
}

/** Hash for storage. The plaintext secret is shown once, at creation. */
export function hashSecret(secret: string) {
  return createHmac("sha256", "api-key").update(secret).digest("hex")
}

export function newCredentials() {
  return {
    keyId: `ak_${randomBytes(9).toString("base64url")}`,
    secret: randomBytes(32).toString("base64url"),
  }
}

/** Constant-time compare. Length is not secret; content is. */
export function equals(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
