import { beforeEach, describe, expect, it } from "vitest"
import { Hono } from "hono"

import { LIMITS, rateLimit, resetRateLimits } from "@/server/rate-limit"

/** A tiny app so the middleware is exercised the way routes use it. */
function appWith(limit: { group: string; limit: number; windowMs: number }) {
  return new Hono().get("/", rateLimit(limit), (c) => c.json({ ok: true }))
}

const from = (ip: string) => ({ headers: { "x-forwarded-for": ip } })

describe("rateLimit", () => {
  beforeEach(resetRateLimits)

  it("allows requests under the limit", async () => {
    const app = appWith({ group: "t", limit: 3, windowMs: 60_000 })
    for (let i = 0; i < 3; i++) {
      expect((await app.request("/", from("1.1.1.1"))).status).toBe(200)
    }
  })

  // Negative space: the limit exists to be hit. If nothing ever 429s, the
  // middleware is decoration.
  it("429s past the limit", async () => {
    const app = appWith({ group: "t", limit: 2, windowMs: 60_000 })
    await app.request("/", from("1.1.1.1"))
    await app.request("/", from("1.1.1.1"))
    const blocked = await app.request("/", from("1.1.1.1"))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get("Retry-After")).toBeTruthy()
  })

  it("counts each caller separately", async () => {
    const app = appWith({ group: "t", limit: 1, windowMs: 60_000 })
    expect((await app.request("/", from("1.1.1.1"))).status).toBe(200)
    // A different IP must not inherit the first one's exhausted budget.
    expect((await app.request("/", from("2.2.2.2"))).status).toBe(200)
    expect((await app.request("/", from("1.1.1.1"))).status).toBe(429)
  })

  it("keeps groups on separate budgets", async () => {
    const reads = appWith({ group: "read", limit: 1, windowMs: 60_000 })
    const writes = appWith({ group: "write", limit: 1, windowMs: 60_000 })
    await reads.request("/", from("1.1.1.1"))
    // Exhausting reads must not block writes, or one noisy poller stops everything.
    expect((await writes.request("/", from("1.1.1.1"))).status).toBe(200)
  })

  it("reports what is left", async () => {
    const app = appWith({ group: "t", limit: 5, windowMs: 60_000 })
    const res = await app.request("/", from("1.1.1.1"))
    expect(res.headers.get("RateLimit-Limit")).toBe("5")
    expect(res.headers.get("RateLimit-Remaining")).toBe("4")
  })

  it("starts a fresh window after the old one expires", async () => {
    const app = appWith({ group: "t", limit: 1, windowMs: 1 })
    await app.request("/", from("1.1.1.1"))
    await new Promise((r) => setTimeout(r, 5))
    expect((await app.request("/", from("1.1.1.1"))).status).toBe(200)
  })

  it("gives anonymous callers a tighter budget than reads", () => {
    // Public endpoints are the ones that actually get abused.
    expect(LIMITS.public.limit).toBeLessThan(LIMITS.read.limit)
  })
})
