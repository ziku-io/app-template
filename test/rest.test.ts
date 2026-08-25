import { describe, expect, it } from "vitest"
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

import {
  BadRequest,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  actions,
  decodeCursor,
  encodeCursor,
  listOrder,
  page,
  parseFilter,
  parseList,
  type ListSpec,
} from "@/server/rest"

const widgets = pgTable("widgets", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").notNull(),
  deletedAt: timestamp("deleted_at"),
})

const spec: ListSpec = {
  table: widgets,
  columns: { name: widgets.name, status: widgets.status, created_at: widgets.createdAt },
  id: widgets.id,
  defaultSort: "-created_at",
  deletedAt: widgets.deletedAt,
}

/** Minimal stand-in for the bits of Hono's Context that parseList reads. */
function ctx(query: Record<string, string | string[]>) {
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(query)) flat[k] = Array.isArray(v) ? v[0] : v
  return {
    req: {
      query: () => flat,
      queries: (key: string) => {
        const value = query[key]
        return value === undefined ? undefined : Array.isArray(value) ? value : [value]
      },
    },
  } as never
}

describe("parseFilter", () => {
  it("reads field:value pairs", () => {
    expect(parseFilter("status:Lead")).toEqual({ status: ["Lead"] })
  })

  it("treats commas as OR within a field", () => {
    expect(parseFilter("status:Lead,Active")).toEqual({ status: ["Lead", "Active"] })
  })

  it("treats semicolons as AND across fields", () => {
    expect(parseFilter("status:Lead;name:Acme")).toEqual({ status: ["Lead"], name: ["Acme"] })
  })

  it("merges a repeated parameter", () => {
    expect(parseFilter(["status:Lead", "status:Done"])).toEqual({ status: ["Lead", "Done"] })
  })

  // Negative space: malformed input must not become a filter that matches
  // everything, and must not throw either — it is simply not a pair.
  it("ignores chunks with no colon", () => {
    expect(parseFilter("garbage")).toEqual({})
  })

  it("ignores an empty field name", () => {
    expect(parseFilter(":Lead")).toEqual({})
  })

  it("ignores an empty value", () => {
    expect(parseFilter("status:")).toEqual({})
  })

  it("is empty for undefined", () => {
    expect(parseFilter(undefined)).toEqual({})
  })
})

describe("cursors", () => {
  it("round-trips a string cursor", () => {
    const cursor = { v: "abc", t: "s", id: "42" } as const
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  it("round-trips a date cursor", () => {
    const cursor = { v: "2026-01-01T00:00:00.000Z", t: "d", id: "42" } as const
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })

  // Negative space: a token is caller input. Garbage must be rejected, never
  // half-decoded into a cursor that silently skips rows.
  it("rejects a token that is not base64", () => {
    expect(decodeCursor("!!!not base64!!!")).toBeNull()
  })

  it("rejects base64 that is not JSON", () => {
    expect(decodeCursor(Buffer.from("hello").toString("base64url"))).toBeNull()
  })

  it("rejects JSON missing its fields", () => {
    expect(decodeCursor(Buffer.from(JSON.stringify({ v: 1 })).toString("base64url"))).toBeNull()
  })
})

describe("parseList", () => {
  it("defaults page size and sort", () => {
    const request = parseList(ctx({}), spec)
    expect(request.pageSize).toBe(DEFAULT_PAGE_SIZE)
    expect(request.sortBy).toBe("created_at")
    expect(request.descending).toBe(true)
  })

  it("reads a - prefix as descending", () => {
    expect(parseList(ctx({ sort_by: "name" }), spec).descending).toBe(false)
    expect(parseList(ctx({ sort_by: "-name" }), spec).descending).toBe(true)
  })

  it("clamps page size to the maximum", () => {
    expect(parseList(ctx({ pageSize: "99999" }), spec).pageSize).toBe(MAX_PAGE_SIZE)
  })

  // Negative space: an unusable page size is a caller bug. Coercing it to the
  // default hands back 50 rows to someone who asked for none and hides the bug.
  it("rejects a page size of zero", () => {
    expect(() => parseList(ctx({ pageSize: "0" }), spec)).toThrow(BadRequest)
  })

  it("rejects a negative page size", () => {
    expect(() => parseList(ctx({ pageSize: "-5" }), spec)).toThrow(BadRequest)
  })

  it("rejects a non-numeric page size", () => {
    expect(() => parseList(ctx({ pageSize: "many" }), spec)).toThrow(/whole number/)
  })

  it("rejects a fractional page size", () => {
    expect(() => parseList(ctx({ pageSize: "2.5" }), spec)).toThrow(BadRequest)
  })

  it("uses the default when absent", () => {
    expect(parseList(ctx({}), spec).pageSize).toBe(DEFAULT_PAGE_SIZE)
  })

  it("hides deleted rows unless asked", () => {
    expect(parseList(ctx({}), spec).includeDeleted).toBe(false)
    expect(parseList(ctx({ includeDeleted: "true" }), spec).includeDeleted).toBe(true)
    // Anything other than the exact string is not consent.
    expect(parseList(ctx({ includeDeleted: "1" }), spec).includeDeleted).toBe(false)
  })

  // Negative space: the allowlist is the point. An unknown column must be a
  // 400 naming the allowed ones, never a silent fall back to the default.
  it("rejects an unknown sort column", () => {
    expect(() => parseList(ctx({ sort_by: "deleted_at" }), spec)).toThrow(BadRequest)
  })

  it("names the allowed columns when rejecting a sort", () => {
    expect(() => parseList(ctx({ sort_by: "nope" }), spec)).toThrow(/name, status, created_at/)
  })

  it("rejects an unknown filter field", () => {
    expect(() => parseList(ctx({ filter: "secret:1" }), spec)).toThrow(BadRequest)
  })

  it("rejects an unparseable page token", () => {
    expect(() => parseList(ctx({ pageToken: "nonsense" }), spec)).toThrow(/pageToken/)
  })
})

describe("listOrder", () => {
  it("always appends the id tiebreaker so paging is total", () => {
    const order = listOrder(parseList(ctx({ sort_by: "name" }), spec), spec)
    expect(order).toHaveLength(2)
  })
})

describe("page", () => {
  const request = parseList(ctx({ pageSize: "2", sort_by: "name" }), spec)
  const rows = [
    { id: "1", name: "a" },
    { id: "2", name: "b" },
    { id: "3", name: "c" },
  ]

  it("returns a token when a further row was fetched", () => {
    const result = page(rows, request, spec)
    expect(result.rows).toHaveLength(2)
    expect(result.nextPageToken).not.toBeNull()
  })

  it("points the token at the last returned row, not the peeked one", () => {
    const cursor = decodeCursor(page(rows, request, spec).nextPageToken!)
    expect(cursor).toMatchObject({ v: "b", id: "2" })
  })

  it("returns no token on the last page", () => {
    expect(page(rows.slice(0, 2), request, spec).nextPageToken).toBeNull()
  })

  it("returns no token for an empty result", () => {
    expect(page([], request, spec)).toEqual({ rows: [], nextPageToken: null })
  })
})

describe("actions", () => {
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status })
  const handler = actions("id", {
    restore: async (c, target) => json({ target }, 200) as never,
  })
  const call = (param: string) =>
    handler({ req: { param: () => param }, json } as never, undefined as never)

  it("splits the target from the action", async () => {
    const res = (await call("abc:restore")) as Response
    expect(await res.json()).toEqual({ target: "abc" })
  })

  // Negative space: an unknown or missing verb is a 404 that names the real
  // ones, not a silent fall-through to some default behaviour.
  it("404s an unknown action", async () => {
    expect(((await call("abc:explode")) as Response).status).toBe(404)
  })

  it("404s when no action is given", async () => {
    expect(((await call("abc")) as Response).status).toBe(404)
  })

  it("404s when the id is empty", async () => {
    expect(((await call(":restore")) as Response).status).toBe(404)
  })
})
