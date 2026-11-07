import "server-only"
import type { SocialPostDto, SocialPostMediaDto, StudioSocialPostDto } from "@/lib/api/contracts/social"
import { isSafeEmbed, isSafeMediaSrc, isSafePermalink } from "@/lib/api/contracts/social"
import type { socialPosts, SocialPostMedia } from "../db/schema"
import { mediaSrc } from "../media"

/**
 * Post DTOs (§1.10): built from a row, never the row itself. Every src is rebuilt from the media
 * id (`/api/media/<id>`, plus `?as=brand` in Studio so private media load for members); only
 * seeded rows carry /media/… paths. Permalinks and embeds are re-checked on the way out.
 */
export type PostRow = typeof socialPosts.$inferSelect
/** What sync and uploads store per media item (the schema type plus the video's duration). */
export type StoredMedia = SocialPostMedia & { durationMs?: number }

/** Every media id a post references (files and poster frames), for refreshVisibility. */
export function mediaIdsOf(media: StoredMedia[] | null | undefined) {
  const ids = new Set<string>()
  for (const m of media ?? []) {
    if (m.mediaId) ids.add(m.mediaId)
    if (m.posterMediaId) ids.add(m.posterMediaId)
  }
  return [...ids]
}

/** The network a post came from: imports by source, sandbox imports by their id prefix. */
export function providerOf(row: Pick<PostRow, "source" | "externalId">): "instagram" | "tiktok" | null {
  if (row.source === "instagram" || row.source === "tiktok") return row.source
  if (row.source === "sandbox") return row.externalId?.startsWith("tt_") ? "tiktok" : "instagram"
  return null
}

function mediaDto(m: StoredMedia, as?: "brand"): SocialPostMediaDto | null {
  const src = m.mediaId ? mediaSrc(m.mediaId, as) : m.src
  const poster = m.posterMediaId ? mediaSrc(m.posterMediaId, as) : m.posterSrc
  if (!isSafeMediaSrc(src)) return null
  const out: SocialPostMediaDto = { src, alt: m.alt || "", width: m.width || 1080, height: m.height || 1350, kind: m.kind }
  if (poster && isSafeMediaSrc(poster)) out.posterSrc = poster
  if (m.durationMs) out.durationMs = m.durationMs
  // A video kept as its poster only (too large to import, or a TikTok cover) has no file to play.
  if (m.kind === "video" && m.mediaId && m.mediaId === m.posterMediaId) out.playable = false
  return out
}

export function toPostDto(row: PostRow, as?: "brand"): SocialPostDto {
  const dto: SocialPostDto = {
    id: row.id,
    brandId: row.brandId,
    source: row.source as SocialPostDto["source"],
    provider: providerOf(row),
    kind: row.kind as SocialPostDto["kind"],
    caption: row.caption,
    postedAt: row.postedAt.toISOString(),
    media: ((row.media ?? []) as StoredMedia[]).map((m) => mediaDto(m, as)).filter((m): m is SocialPostMediaDto => !!m),
    productIds: row.productIds ?? [],
    featured: row.featured,
    featureOrder: row.featureOrder ?? null,
    sample: row.sample,
  }
  if (isSafePermalink(row.permalink)) dto.permalink = row.permalink
  if (isSafeEmbed(row.embedUrl)) dto.embedUrl = row.embedUrl
  return dto
}

/** `importLocked`: an import whose account isn't connected (posts.ts works it out per list). */
export function toStudioPostDto(row: PostRow, importLocked = false): StudioSocialPostDto {
  return {
    ...toPostDto(row, "brand"),
    visibility: row.visibility as StudioSocialPostDto["visibility"],
    moderationStatus: row.moderationStatus as StudioSocialPostDto["moderationStatus"],
    removedReason: row.moderationStatus === "removed" ? row.removedReason : null,
    upstreamMissingAt: row.upstreamMissingAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    importLocked,
  }
}
