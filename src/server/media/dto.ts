import "server-only"
import type { MediaDto } from "@/lib/api/contracts/uploads"
import type { MediaRow } from "./store"

/** `/api/media/<id>` (+ `?as=` for private media): the only src the server ever builds for stored media. */
export function mediaSrc(id: string, as?: "shopper" | "brand" | "admin") {
  return `/api/media/${encodeURIComponent(id)}${as ? `?as=${as}` : ""}`
}

/**
 * The media DTO (§1.10). DTO builders append `as` for private media, so the media route reads
 * only that cookie; public media gets the bare URL every visitor shares (and caches).
 */
export function toMediaDto(row: MediaRow, as: "shopper" | "brand" | "admin"): MediaDto {
  return {
    id: row.id,
    src: row.visibility === "public" ? mediaSrc(row.id) : mediaSrc(row.id, as),
    mime: row.mime as MediaDto["mime"],
    kind: row.mime.startsWith("video/") ? "video" : "image",
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    purpose: row.purpose as MediaDto["purpose"],
    visibility: row.visibility as MediaDto["visibility"],
    createdAt: row.createdAt.toISOString(),
  }
}
