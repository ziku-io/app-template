import { describeRoute, resolver, validator } from "hono-openapi"
import type { OpenAPIV3_1 } from "openapi-types"
import { z, type ZodType } from "zod"

/**
 * Thin conventions over `hono-openapi`, so a module documents a route in a few
 * lines. The spec is assembled from the routes actually mounted, so it always
 * describes exactly the modules this app was built with.
 */

const errorSchema = z.object({
  error: z.union([z.string(), z.record(z.string(), z.string())]),
})

const asJson = (schema: ZodType) => ({
  content: { "application/json": { schema: resolver(schema) } },
})

/** Every list endpoint answers with the same envelope. */
export const listOf = (row: ZodType) => z.object({ rows: z.array(row), total: z.number().int() })

/** Cursor-paged lists: follow `nextPageToken` until it comes back null. */
export const pageOf = (row: ZodType) =>
  z.object({
    rows: z.array(row),
    nextPageToken: z
      .string()
      .nullable()
      .describe("Pass as ?pageToken= for the next page. Null on the last page."),
  })

export interface Param {
  name: string
  in: "query" | "path"
  description?: string
  required?: boolean
  schema: Record<string, unknown>
}

/** The standard list parameters, naming the columns this endpoint allows. */
export function listParams(columns: string[], extra: Param[] = []): Param[] {
  const allowed = columns.join(", ")
  return [
    {
      name: "pageSize",
      in: "query",
      description: `Rows per page, 1-200 (default 50)`,
      schema: { type: "integer" },
    },
    {
      name: "pageToken",
      in: "query",
      description: "Cursor from the previous page's nextPageToken",
      schema: { type: "string" },
    },
    {
      name: "sort_by",
      in: "query",
      description: `One of: ${allowed}. Prefix with - for descending.`,
      schema: { type: "string" },
    },
    {
      name: "filter",
      in: "query",
      description: `field:value pairs, e.g. status:Lead,Active. Fields: ${allowed}. Repeatable.`,
      schema: { type: "string" },
    },
    { name: "q", in: "query", description: "Free-text search", schema: { type: "string" } },
    {
      name: "includeDeleted",
      in: "query",
      description: "Include soft-deleted rows",
      schema: { type: "boolean" },
    },
    ...extra,
  ]
}

/** The query parameters every list endpoint accepts. */
export const listQuery: Param[] = [
  { name: "q", in: "query", description: "Free-text search", schema: { type: "string" } },
  {
    name: "sort",
    in: "query",
    description: "Column name; prefix with `-` for descending",
    schema: { type: "string" },
  },
  {
    name: "limit",
    in: "query",
    description: "Max rows, capped at 1000",
    schema: { type: "integer" },
  },
  { name: "offset", in: "query", description: "Rows to skip", schema: { type: "integer" } },
]

/** `:id` path parameter, the one every module repeats. */
export const idParam: Param = {
  name: "id",
  in: "path",
  required: true,
  description: "Record id",
  schema: { type: "string" },
}

const ERROR_TEXT: Record<number, string> = {
  400: "Bad request, e.g. an unknown sort_by or filter field",
  401: "No session",
  429: "Rate limited; see the RateLimit-* headers",
  403: "Not allowed",
  404: "Not found",
  409: "Conflict",
  413: "Payload too large",
  422: "Invalid body",
}

export interface RouteDoc {
  /** Groups the route in the reference. Use the module id. */
  tag: string
  summary: string
  description?: string
  /** Success response schema. Omit for a 204, or use `okContent` for non-JSON. */
  ok?: ZodType
  /** Raw OpenAPI content for a success body that is not JSON, e.g. a download. */
  okContent?: Record<string, OpenAPIV3_1.MediaTypeObject>
  /** Raw OpenAPI content for a request body that is not JSON, e.g. multipart. */
  requestContent?: Record<string, OpenAPIV3_1.MediaTypeObject>
  /** Status for the success response. Defaults to 200, or 204 without `ok`. */
  okStatus?: number
  params?: Param[]
  /** Error statuses beyond the 401 every guarded route can return. */
  errors?: number[]
  /** Routes needing no session. Everything else documents a 401. */
  public?: boolean
}

/** Documents one route. Mount it as middleware before the handler. */
export function describe(doc: RouteDoc) {
  const statuses = new Set<number>(doc.errors ?? [])
  if (!doc.public) statuses.add(401)

  const okStatus = doc.okStatus ?? (doc.ok || doc.okContent ? 200 : 204)
  const responses: Record<string, unknown> = {
    [okStatus]: doc.okContent
      ? { description: "Success", content: doc.okContent }
      : doc.ok
        ? { description: "Success", ...asJson(doc.ok) }
        : { description: "Success, no content" },
  }
  for (const status of statuses) {
    responses[status] = { description: ERROR_TEXT[status] ?? "Error", ...asJson(errorSchema) }
  }

  return describeRoute({
    tags: [doc.tag],
    summary: doc.summary,
    description: doc.description,
    parameters: doc.params,
    ...(doc.requestContent ? { requestBody: { required: true, content: doc.requestContent } } : {}),
    responses: responses as never,
  })
}

/**
 * Validates a JSON body and documents it in one step. Read the result with
 * `c.req.valid("json")` — no hand-rolled safeParse in the handler.
 * Invalid bodies get a 422 with one message per field.
 */
export function body<T extends ZodType>(schema: T) {
  return validator("json", schema, (result, c) => {
    if (result.success) return
    const fields: Record<string, string> = {}
    for (const issue of result.error) {
      fields[issue.path?.map(String).join(".") || "_"] = issue.message
    }
    return c.json({ error: fields }, 422)
  })
}
