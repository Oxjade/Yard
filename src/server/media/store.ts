import "server-only"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { sql } from "drizzle-orm"
import { db, withTx } from "../db"
import { mediaAssets, rateLimitBuckets } from "../db/schema"
import { getEnv } from "../env"
import { log } from "../log"
import { sha256hex } from "../security/crypto"
import type { Sniffed } from "./sniff"

export type MediaPurpose = "social_post" | "inbox_attachment" | "location_image" | "social_import" | "sample"
export type MediaRow = typeof mediaAssets.$inferSelect

/** Size caps by purpose and kind (§5.4 step 2). */
export const MEDIA_CAPS = { inbox_attachment: 8 << 20, social_post_image: 10 << 20, social_post_video: 50 << 20, location_image: 10 << 20, social_import_image: 10 << 20, social_import_video: 50 << 20 } as const

/** The largest file a purpose takes before its kind is known (the Content-Length check). */
export function headerCap(purpose: "social_post" | "inbox_attachment" | "location_image") {
  return purpose === "social_post" ? MEDIA_CAPS.social_post_video : purpose === "inbox_attachment" ? MEDIA_CAPS.inbox_attachment : MEDIA_CAPS.location_image
}

/** The cap for a sniffed file. */
export function kindCap(purpose: "social_post" | "inbox_attachment" | "location_image", kind: "image" | "video") {
  if (purpose === "social_post") return kind === "video" ? MEDIA_CAPS.social_post_video : MEDIA_CAPS.social_post_image
  return purpose === "inbox_attachment" ? MEDIA_CAPS.inbox_attachment : MEDIA_CAPS.location_image
}

/** ${dataDir}/<env>/uploads */
export const uploadsRoot = () => path.join(getEnv().envDir, "uploads")

/** Resolves a stored path under the uploads root, refusing anything that escapes it. */
export function resolveStored(storagePath: string) {
  if (storagePath.startsWith("/media/")) {
    // Seed sample rows point at a public file.
    const pub = path.join(process.cwd(), "public")
    const abs = path.resolve(pub, "." + storagePath)
    return abs.startsWith(pub + path.sep) ? abs : null
  }
  const root = uploadsRoot()
  const abs = path.resolve(root, storagePath)
  return abs.startsWith(root + path.sep) ? abs : null
}

/** 128-bit random media ids (§3.2). */
export const newMediaId = () => `med_${randomBytes(16).toString("base64url")}`

/** Per-brand daily upload volume (2 GB/day, §5.1), counted in KiB in rate_limit_buckets. */
export const BRAND_DAILY_KIB = 2 * 1024 * 1024
const bytesBucket = (brandId: string, now = new Date()) => `uploads:bytes:${brandId}:${now.toISOString().slice(0, 10)}`

export async function brandBytesToday(brandId: string) {
  const d = await db()
  const row = await d.query.rateLimitBuckets.findFirst({ where: (b, { eq }) => eq(b.key, bytesBucket(brandId)) })
  return row?.count ?? 0
}

async function addBrandBytes(brandId: string, bytes: number) {
  const d = await db()
  const now = new Date()
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2))
  await d
    .insert(rateLimitBuckets)
    .values({ key: bytesBucket(brandId, now), count: Math.ceil(bytes / 1024), expiresAt: tomorrow })
    .onConflictDoUpdate({ target: rateLimitBuckets.key, set: { count: sql`${rateLimitBuckets.count} + ${Math.ceil(bytes / 1024)}` } })
}

export type StoreInput = {
  bytes: Buffer
  sniffed: Sniffed
  purpose: MediaPurpose
  ownerKind: "brand" | "user"
  ownerId: string
  brandId: string | null
  conversationId: string | null
  targetBrandId: string | null
  createdBy: string
  width: number | null
  height: number | null
  durationMs: number | null
  source?: "upload" | "instagram" | "tiktok" | "sandbox" | "seed"
}

/**
 * Writes the (already stripped) bytes to uploads/tmp, moves them to
 * uploads/<purpose>/<brandId|userId>/<mediaId>.<ext>, then inserts the row in one short withTx
 * (§5.4 step 6). No file I/O happens inside the transaction; if the insert fails the file is
 * unlinked. Visibility starts private and only refreshVisibility changes it.
 */
export async function storeUpload(input: StoreInput): Promise<MediaRow> {
  if (!/^[\w-]+$/.test(input.ownerId)) throw new Error("storeUpload: bad owner id")
  const id = newMediaId()
  const root = uploadsRoot()
  const tmpDir = path.join(root, "tmp")
  const rel = path.posix.join(input.purpose, input.ownerId, `${id}.${input.sniffed.ext}`)
  const finalPath = path.join(root, rel)
  await mkdir(tmpDir, { recursive: true, mode: 0o700 })
  await mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 })
  const tmp = path.join(tmpDir, randomUUID())
  await writeFile(tmp, input.bytes, { mode: 0o600 })
  const sha256 = sha256hex(input.bytes)
  try {
    await rename(tmp, finalPath)
  } catch (e) {
    await unlink(tmp).catch(() => {})
    throw e
  }
  try {
    return await withTx(async () => {
      const d = await db()
      const [row] = await d
        .insert(mediaAssets)
        .values({
          id,
          ownerKind: input.ownerKind,
          ownerId: input.ownerId,
          brandId: input.brandId,
          conversationId: input.conversationId,
          targetBrandId: input.targetBrandId,
          purpose: input.purpose,
          mime: input.sniffed.mime,
          ext: input.sniffed.ext,
          bytes: input.bytes.length,
          width: input.width,
          height: input.height,
          durationMs: input.durationMs,
          sha256,
          storagePath: rel,
          visibility: "private",
          moderationStatus: "ok",
          source: input.source ?? "upload",
          createdBy: input.createdBy,
        })
        .returning()
      if (input.brandId) await addBrandBytes(input.brandId, input.bytes.length)
      return row
    })
  } catch (e) {
    await unlink(finalPath).catch((err) => log.error("[yard] unlinking an upload whose row failed", err))
    throw e
  }
}
