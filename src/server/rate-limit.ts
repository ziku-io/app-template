import type { Context, Next } from "hono"

/**
 * Fixed-window limiter keyed by user, or by IP for anonymous callers.
 *
 * ponytail: in-process counters, so the budget is per container. That is the
 * right shape for one app per client; move the map to Redis on the day an app
 * runs more than one instance.
 */

interface Window {
  count: number
  resetAt: number
}

const windows = new Map<string, Window>()

/** Groups get their own budget, so uploads cannot starve reads. */
export interface RateLimit {
  group: string
  limit: number
  windowMs: number
}

/** Per-minute budgets, overridable per deployment. */
function budget(name: string, fallback: number) {
  const raw = process.env[`RATE_LIMIT_${name.toUpperCase()}`]
  if (raw === undefined) return fallback

  const parsed = Number(raw)
  // A typo'd env var must not quietly become a limit of NaN, which compares
  // false against everything and turns the limiter off.
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `RATE_LIMIT_${name.toUpperCase()} must be a whole number of at least 1, got "${raw}"`,
    )
  }
  return parsed
}

export const LIMITS = {
  read: { group: "read", limit: budget("read", 1200), windowMs: 60_000 },
  write: { group: "write", limit: budget("write", 600), windowMs: 60_000 },
  upload: { group: "upload", limit: budget("upload", 60), windowMs: 60_000 },
  /** Anonymous endpoints are the ones that actually get abused; keep this tight. */
  public: { group: "public", limit: budget("public", 10), windowMs: 60_000 },
} satisfies Record<string, RateLimit>

function clientKey(c: Context) {
  const user = c.get("user")?.id
  if (user) return `u:${user}`
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
  return `ip:${forwarded || c.req.header("x-real-ip") || "unknown"}`
}

/** Sweeps expired windows so the map cannot grow without bound. */
function sweep(now: number) {
  if (windows.size < 10_000) return
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key)
}

export function rateLimit(limit: RateLimit) {
  return async (c: Context, next: Next) => {
    const now = Date.now()
    const key = `${limit.group}:${clientKey(c)}`
    sweep(now)

    let window = windows.get(key)
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + limit.windowMs }
      windows.set(key, window)
    }
    window.count++

    const remaining = Math.max(limit.limit - window.count, 0)
    c.header("RateLimit-Limit", String(limit.limit))
    c.header("RateLimit-Remaining", String(remaining))
    c.header("RateLimit-Reset", String(Math.ceil((window.resetAt - now) / 1000)))

    if (window.count > limit.limit) {
      c.header("Retry-After", String(Math.ceil((window.resetAt - now) / 1000)))
      return c.json({ error: "Too many requests. Slow down." }, 429)
    }

    await next()
  }
}

/** Test seam: forget every counter. */
export function resetRateLimits() {
  windows.clear()
}
