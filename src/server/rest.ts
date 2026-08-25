import { and, asc, desc, eq, gt, isNull, lt, or, type Column, type SQL } from "drizzle-orm"
import type { Context } from "hono"

/**
 * The REST conventions every endpoint follows. See docs/rest-standards.md for
 * the rules and why each one is here; this file is the single implementation.
 */

export const API_VERSION = "v1"
export const MAX_PAGE_SIZE = 200
export const DEFAULT_PAGE_SIZE = 50

// ── Filtering ───────────────────────────────────────────────────────
/**
 * `?filter=status:Lead,Active;client:Acme` → { status: ["Lead","Active"], client: ["Acme"] }
 * Repeating the parameter works too. Commas are OR within a field, separate
 * fields are AND.
 */
export function parseFilter(raw: string | string[] | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const chunk of (Array.isArray(raw) ? raw : [raw]).filter(Boolean) as string[]) {
    for (const pair of chunk.split(";")) {
      const at = pair.indexOf(":")
      if (at < 1) continue
      const field = pair.slice(0, at).trim()
      const values = pair
        .slice(at + 1)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
      if (field && values.length) out[field] = [...(out[field] ?? []), ...values]
    }
  }
  return out
}

// ── Page tokens ─────────────────────────────────────────────────────
/**
 * Keyset cursor. Offset paging drifts when rows are inserted mid-scroll and
 * makes Postgres count past everything it skips; a cursor on
 * `(sort column, id)` does neither. The token is opaque on purpose — its shape
 * is ours to change.
 */
export interface Cursor {
  /** Last row's sort value, with its type so it survives the round trip. */
  v: string | number | null
  t: "s" | "n" | "d" | "null"
  /** Last row's id, the tiebreaker that keeps the order total. */
  id: string
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

export function decodeCursor(token: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
    if (typeof parsed?.id !== "string" || typeof parsed?.t !== "string") return null
    return parsed as Cursor
  } catch {
    return null
  }
}

function cursorValue(cursor: Cursor): unknown {
  switch (cursor.t) {
    case "d":
      return new Date(cursor.v as string)
    case "n":
      return Number(cursor.v)
    case "null":
      return null
    default:
      return cursor.v
  }
}

function cursorOf(value: unknown, id: string): Cursor {
  if (value instanceof Date) return { v: value.toISOString(), t: "d", id }
  if (typeof value === "number") return { v: value, t: "n", id }
  if (value == null) return { v: null, t: "null", id }
  return { v: String(value), t: "s", id }
}

// ── List requests ───────────────────────────────────────────────────
export interface ListSpec {
  /** The Drizzle table, so the cursor can find the row property for a column. */
  table: object
  /** Sortable and filterable columns, by the name callers use. */
  columns: Record<string, Column>
  /** Column the id tiebreaker comes from. */
  id: Column
  /** Default sort key, from `columns`. */
  defaultSort: string
  /** Columns `?q=` searches. Omit to reject `q`. */
  searchable?: Column[]
  /** Set when the table has a `deletedAt` column. */
  deletedAt?: Column
}

export interface ListRequest {
  pageSize: number
  cursor: Cursor | null
  sortBy: string
  descending: boolean
  filters: Record<string, string[]>
  q?: string
  includeDeleted: boolean
}

export class BadRequest extends Error {}

/** Reads the standard query parameters, rejecting anything not allowed. */
export function parseList(c: Context, spec: ListSpec): ListRequest {
  const q = c.req.query()

  // Absent means "use the default". Present but nonsense is a caller bug, and
  // `Number("0") || DEFAULT` would have quietly handed back 50 rows instead.
  let pageSize = DEFAULT_PAGE_SIZE
  if (q.pageSize !== undefined && q.pageSize !== "") {
    const asked = Number(q.pageSize)
    if (!Number.isInteger(asked) || asked < 1) {
      throw new BadRequest(`pageSize must be a whole number of at least 1, got "${q.pageSize}"`)
    }
    // Above the cap is a reasonable "as much as you can", so clamp rather than refuse.
    pageSize = Math.min(asked, MAX_PAGE_SIZE)
  }

  const cursor = q.pageToken ? decodeCursor(q.pageToken) : null
  if (q.pageToken && !cursor) throw new BadRequest("Invalid pageToken")

  // `-created_at` is descending; the allowlist means a caller cannot sort by,
  // or probe for, a column we did not offer.
  const rawSort = q.sort_by ?? spec.defaultSort
  const descending = rawSort.startsWith("-")
  const sortBy = descending ? rawSort.slice(1) : rawSort
  if (!spec.columns[sortBy]) {
    throw new BadRequest(`Cannot sort by "${sortBy}". Try: ${Object.keys(spec.columns).join(", ")}`)
  }

  const filters = parseFilter(c.req.queries("filter"))
  for (const field of Object.keys(filters)) {
    if (!spec.columns[field]) {
      throw new BadRequest(
        `Cannot filter by "${field}". Try: ${Object.keys(spec.columns).join(", ")}`,
      )
    }
  }

  return {
    pageSize,
    cursor,
    sortBy,
    descending,
    filters,
    q: q.q || undefined,
    includeDeleted: q.includeDeleted === "true",
  }
}

/** The WHERE fragments for a parsed list request: filters, soft delete, cursor. */
export function listWhere(
  request: ListRequest,
  spec: ListSpec,
  extra: (SQL | undefined)[] = [],
): SQL | undefined {
  const parts: (SQL | undefined)[] = [...extra]

  for (const [field, values] of Object.entries(request.filters)) {
    const column = spec.columns[field]
    parts.push(
      values.length === 1 ? eq(column, values[0]) : or(...values.map((v) => eq(column, v))),
    )
  }

  // Soft-deleted rows are invisible unless asked for by name.
  if (spec.deletedAt && !request.includeDeleted) {
    parts.push(isNull(spec.deletedAt))
  }

  if (request.cursor) {
    const column = spec.columns[request.sortBy]
    const beyond = request.descending ? lt : gt
    const value = cursorValue(request.cursor)
    parts.push(
      or(beyond(column, value), and(eq(column, value), beyond(spec.id, request.cursor.id))),
    )
  }

  const kept = parts.filter(Boolean) as SQL[]
  return kept.length ? and(...kept) : undefined
}

/** ORDER BY for a parsed list request, always with the id tiebreaker. */
export function listOrder(request: ListRequest, spec: ListSpec) {
  const direction = request.descending ? desc : asc
  return [direction(spec.columns[request.sortBy]), direction(spec.id)]
}

/**
 * Turns one page of rows into the response envelope. Fetch `pageSize + 1` rows
 * and pass them here: the extra row is how we know another page exists without
 * a second query.
 */
export function page<T extends Record<string, unknown>>(
  rows: T[],
  request: ListRequest,
  spec: ListSpec,
): { rows: T[]; nextPageToken: string | null } {
  const hasMore = rows.length > request.pageSize
  const kept = hasMore ? rows.slice(0, request.pageSize) : rows
  const last = kept.at(-1)
  if (!hasMore || !last) return { rows: kept, nextPageToken: null }

  const sortKey = rowKeyOf(spec.table, spec.columns[request.sortBy])
  const idKey = rowKeyOf(spec.table, spec.id)
  return { rows: kept, nextPageToken: encodeCursor(cursorOf(last[sortKey], String(last[idKey]))) }
}

/**
 * The row property a column lands on. `select()` keys rows by the table's JS
 * property names, not the database column names, so the cursor has to look the
 * mapping up rather than guess at snake_case.
 */
function rowKeyOf(table: object, column: Column): string {
  for (const [key, value] of Object.entries(table)) if (value === column) return key
  return column.name
}

// ── Custom actions ──────────────────────────────────────────────────
export type ActionHandler = (c: Context, target: string) => Response | Promise<Response>

/**
 * Custom verbs: `POST /tasks/{id}:complete`, `POST /carts/{id}/items:add`.
 *
 * A verb that is not a CRUD operation gets its own name rather than a magic
 * field in a PATCH body. Hono cannot put a literal colon in a path pattern, so
 * one route matches the whole `{id}:action` segment and dispatches here.
 */
/**
 * The validated body inside an action handler. `actions()` hands its handlers a
 * bare Context, so the type `body()` attached upstream is not visible here.
 * One documented cast beats one per action.
 */
export function actionBody<T>(c: Context): T {
  return (c.req as unknown as { valid: (target: "json") => T }).valid("json")
}

export function actions(param: string, handlers: Record<string, ActionHandler>) {
  return async (c: Context) => {
    const raw = c.req.param(param) ?? ""
    const at = raw.lastIndexOf(":")
    const known = Object.keys(handlers).join(", ")

    if (at < 1) return c.json({ error: `Expected {${param}}:action — one of: ${known}` }, 404)

    const name = raw.slice(at + 1)
    const handler = handlers[name]
    if (!handler) return c.json({ error: `Unknown action "${name}". Try: ${known}` }, 404)

    return handler(c, raw.slice(0, at))
  }
}
