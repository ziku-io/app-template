import { createWriteStream } from "node:fs"
import { mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { randomUUID } from "node:crypto"

const ROOT = path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads")

export const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024

/**
 * Local disk storage. ponytail: no S3 SDK until a client needs shared or
 * off-box storage — swap these three functions and nothing else changes.
 */

/** Sharded by date so one directory never holds a hundred thousand entries. */
export function newKey(filename: string) {
  const stamp = new Date().toISOString().slice(0, 7) // YYYY-MM
  return path.join(stamp, `${randomUUID()}${path.extname(filename).slice(0, 10)}`)
}

export function resolveKey(key: string) {
  const full = path.resolve(ROOT, key)
  // A key is never user input we trust: refuse anything that climbs out.
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key")
  return full
}

export async function write(key: string, data: ReadableStream<Uint8Array> | Buffer) {
  const full = resolveKey(key)
  await mkdir(path.dirname(full), { recursive: true })
  if (Buffer.isBuffer(data)) {
    await pipeline(Readable.from(data), createWriteStream(full))
  } else {
    await pipeline(Readable.fromWeb(data as never), createWriteStream(full))
  }
  return (await stat(full)).size
}

export async function remove(key: string) {
  await rm(resolveKey(key), { force: true })
}
