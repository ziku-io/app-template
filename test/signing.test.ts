import { describe, expect, it } from "vitest"

import { canonicalString, hashSecret, newCredentials, sign } from "@/server/signing"

describe("request signing", () => {
  const secret = "s3cret"
  const base = {
    method: "GET",
    path: "/api/v1/projects",
    query: "pageSize=10",
    expiry: "1800000000",
    body: "",
  }

  it("is stable for the same request", () => {
    expect(sign(secret, canonicalString(base))).toBe(sign(secret, canonicalString(base)))
  })

  // Negative space: each of these is a thing an attacker would change on a
  // captured request. Every one of them must break the signature.
  it("changes when the method changes", () => {
    expect(sign(secret, canonicalString({ ...base, method: "DELETE" }))).not.toBe(
      sign(secret, canonicalString(base)),
    )
  })

  it("changes when the path changes", () => {
    expect(sign(secret, canonicalString({ ...base, path: "/api/v1/users" }))).not.toBe(
      sign(secret, canonicalString(base)),
    )
  })

  it("changes when the query changes", () => {
    expect(sign(secret, canonicalString({ ...base, query: "pageSize=200" }))).not.toBe(
      sign(secret, canonicalString(base)),
    )
  })

  it("changes when the body changes", () => {
    expect(sign(secret, canonicalString({ ...base, body: '{"budget":1}' }))).not.toBe(
      sign(secret, canonicalString({ ...base, body: '{"budget":999}' })),
    )
  })

  it("changes when the expiry changes", () => {
    expect(sign(secret, canonicalString({ ...base, expiry: "1900000000" }))).not.toBe(
      sign(secret, canonicalString(base)),
    )
  })

  it("changes with the secret", () => {
    expect(sign("other", canonicalString(base))).not.toBe(sign(secret, canonicalString(base)))
  })

  it("uppercases the method so a lowercase verb signs the same", () => {
    expect(canonicalString({ ...base, method: "get" })).toBe(canonicalString(base))
  })

  it("separates the parts so they cannot be shuffled", () => {
    // Without a separator, method "GET" + path "/a" would sign the same as
    // method "GE" + path "T/a".
    expect(canonicalString({ ...base, method: "GE", path: "T" + base.path })).not.toBe(
      canonicalString(base),
    )
  })
})

describe("credentials", () => {
  it("mints a distinct key id and secret each time", () => {
    const a = newCredentials()
    const b = newCredentials()
    expect(a.keyId).not.toBe(b.keyId)
    expect(a.secret).not.toBe(b.secret)
    expect(a.keyId.startsWith("ak_")).toBe(true)
  })

  it("does not store the secret in the clear", () => {
    const { secret } = newCredentials()
    expect(hashSecret(secret)).not.toBe(secret)
    expect(hashSecret(secret)).toBe(hashSecret(secret))
  })
})
