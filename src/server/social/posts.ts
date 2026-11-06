import "server-only"
import { and, asc, desc, eq, inArray, like, ne, or, sql, type SQL } from "drizzle-orm"
import type { CreatePostsData, FeedSource, PatchPostBody, StudioPostStatus } from "@/lib/api/contracts/social"
import { brandById } from "@/lib/data/brands"
import { activeRestriction, assertBrandMayPublish, brandListed, requireBrandResource, type BrandActor } from "../auth/dal"
import { assertOwned, type OwnedRef } from "../auth/owned"
import { db, withTx } from "../db"
import { mediaAssets, socialPosts } from "../db/schema"
import { badRequest, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { mediaSrc } from "../media"
import { mediaIdsOf, toPostDto, toStudioPostDto, type PostRow, type StoredMedia } from "./dto"
import { refreshMedia } from "./media-ops"

/**
 * Content Studio and the public feed (§6.1). Every brand-side query is scoped to the session's
 * active brand; a removed post is locked (only uploads can be deleted); every visibility change
 * refreshes media visibility in the same transaction.
 */
const REMOVED = "Yard removed this post. You can delete it."

/** SQL for a feed source filter. "uploads" = posts on Yard itself (uploads and seeded samples). */
export function sourceWhere(source: FeedSource): SQL | undefined {
  switch (source) {
    case "instagram":
      return or(eq(socialPosts.source, "instagram"), and(eq(socialPosts.source, "sandbox"), like(socialPosts.externalId, "ig\\_%")))
    case "tiktok":
      return or(eq(socialPosts.source, "tiktok"), and(eq(socialPosts.source, "sandbox"), like(socialPosts.externalId, "tt\\_%")))
    case "uploads":
      return inArray(socialPosts.source, ["upload", "sample"])
    default:
      return undefined
  }
}

const order = [desc(socialPosts.featured), sql`${socialPosts.featureOrder} asc nulls last`, desc(socialPosts.postedAt), asc(socialPosts.id)]

/* ---------- Studio ---------- */

export async function listStudioPosts(actor: BrandActor, q: { source: FeedSource; visibility: StudioPostStatus | "all" }) {
  const d = await db()
  const rows = await d
    .select()
    .from(socialPosts)
    .where(and(eq(socialPosts.brandId, actor.brandId), sourceWhere(q.source)))
    .orderBy(...order)
    .limit(500)
  const counts = { published: 0, hidden: 0, draft: 0, removed: 0 }
  for (const r of rows) {
    if (r.moderationStatus === "removed") counts.removed++
    else counts[r.visibility as "published" | "hidden" | "draft"]++
  }
  const shown = q.visibility === "all" ? rows : rows.filter((r) => (q.visibility === "removed" ? r.moderationStatus === "removed" : r.moderationStatus !== "removed" && r.visibility === q.visibility))
  return { posts: shown.map(toStudioPostDto), counts }
}

/** A post of the active brand (404 for any other brand's post). */
export async function loadOwnPost(id: string, permission: "content.publish" | "inbox.read" = "content.publish") {
  return requireBrandResource(async (brandId) => {
    const d = await db()
    const [row] = await d
      .select()
      .from(socialPosts)
      .where(and(eq(socialPosts.id, id), eq(socialPosts.brandId, brandId)))
      .limit(1)
    return row ?? null
  }, permission)
}

/** Media rows of the active brand by id, for building upload posts. */
async function mediaRows(ids: string[], brandId: string) {
  if (!ids.length) return []
  const d = await db()
  return d
    .select()
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.brandId, brandId)))
}

/** Whether a media id is already used by a post of this brand (a file goes into one post). */
async function mediaInUse(brandId: string, mediaId: string) {
  const d = await db()
  const probe = JSON.stringify([{ mediaId }])
  const probePoster = JSON.stringify([{ posterMediaId: mediaId }])
  const [row] = await d
    .select({ id: socialPosts.id })
    .from(socialPosts)
    .where(and(eq(socialPosts.brandId, brandId), or(sql`${socialPosts.media} @> ${probe}::jsonb`, sql`${socialPosts.media} @> ${probePoster}::jsonb`)))
    .limit(1)
  return !!row
}

/** A caption's first line, for alt text (an upload's alt describes the post, never the file name). */
function altFrom(caption: string, brandName: string) {
  const first = caption.split(/\n|(?<=[.!?])\s/)[0]?.trim() ?? ""
  return first ? first.slice(0, 120) : `Post by ${brandName}`
}

/** POST /api/studio/social/posts: upload posts from the brand's own social_post media. */
export async function createPosts(actor: BrandActor, body: CreatePostsData) {
  if (body.publish) assertBrandMayPublish(actor)
  const posterIds = Object.values(body.posters)
  const refs: OwnedRef[] = [
    ...body.mediaIds.map((id, i) => ({ kind: "media" as const, id, field: `mediaIds.${i}`, purpose: "social_post" as const })),
    ...Object.entries(body.posters).map(([video, id]) => ({ kind: "media" as const, id, field: `posters.${video}`, purpose: "social_post" as const })),
    ...body.productIds.map((id, i) => ({ kind: "product" as const, id, field: `productIds.${i}` })),
  ]
  await assertOwned(actor, refs)
  if (new Set(body.mediaIds).size !== body.mediaIds.length) throw badRequest({ mediaIds: "A file is listed twice." })
  for (const video of Object.keys(body.posters)) if (!body.mediaIds.includes(video)) throw badRequest({ [`posters.${video}`]: "That poster belongs to no video in this post." })

  const rows = await mediaRows([...body.mediaIds, ...posterIds], actor.brandId)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const fields: Record<string, string> = {}
  for (const [i, id] of body.mediaIds.entries()) if (await mediaInUse(actor.brandId, id)) fields[`mediaIds.${i}`] = "This file is already in a post."
  for (const [video, id] of Object.entries(body.posters)) {
    if (!byId.get(id)?.mime.startsWith("image/")) fields[`posters.${video}`] = "A poster must be a photo."
    if (!byId.get(video)?.mime.startsWith("video/")) fields[`posters.${video}`] = "Only a video takes a poster."
  }
  const videos = body.mediaIds.filter((id) => byId.get(id)?.mime.startsWith("video/"))
  if (videos.length > 1) fields.mediaIds = "Upload one video at a time."
  if (body.carousel && videos.length) fields.carousel = "Carousels hold photos only. Post the video on its own."
  if (Object.keys(fields).length) throw badRequest(fields)

  const brandName = actor.brand.name
  const alt = altFrom(body.caption, brandName)
  const item = (id: string, i: number, n: number): StoredMedia => {
    const m = byId.get(id)!
    const video = m.mime.startsWith("video/")
    const poster = video ? byId.get(body.posters[id] ?? "") : undefined
    return {
      mediaId: id,
      src: mediaSrc(id),
      alt: n > 1 ? `${alt}, ${i + 1} of ${n}` : alt,
      width: poster?.width ?? m.width ?? 1080,
      height: poster?.height ?? m.height ?? (video ? 1920 : 1350),
      kind: video ? "video" : "image",
      ...(poster ? { posterMediaId: poster.id, posterSrc: mediaSrc(poster.id) } : {}),
      ...(m.durationMs ? { durationMs: m.durationMs } : {}),
    }
  }
  const groups: { kind: "image" | "video" | "carousel"; media: StoredMedia[] }[] =
    body.carousel && body.mediaIds.length > 1
      ? [{ kind: "carousel", media: body.mediaIds.map((id, i) => item(id, i, body.mediaIds.length)) }]
      : body.mediaIds.map((id) => {
          const m = item(id, 0, 1)
          return { kind: m.kind, media: [m] }
        })

  return withTx(async () => {
    const d = await db()
    const now = new Date()
    const created: PostRow[] = []
    for (const [i, g] of groups.entries()) {
      const [row] = await d
        .insert(socialPosts)
        .values({
          id: newId("sp"),
          brandId: actor.brandId,
          source: "upload",
          kind: g.kind,
          caption: body.caption,
          media: g.media,
          productIds: body.productIds,
          // Newest first in upload order: the first file leads.
          postedAt: new Date(now.getTime() - i),
          visibility: body.publish ? "published" : "draft",
          createdBy: actor.userId,
          updatedAt: now,
        })
        .returning()
      created.push(row)
    }
    const ids = [...body.mediaIds, ...posterIds]
    await d.update(mediaAssets).set({ attachedAt: now }).where(inArray(mediaAssets.id, ids))
    await refreshMedia(ids)
    return created.map(toStudioPostDto)
  })
}

/** PATCH /api/studio/social/posts/{id}. A removed post is locked (422); captions only for uploads. */
export async function patchPost(id: string, body: PatchPostBody) {
  const { actor, resource: post } = await loadOwnPost(id)
  if (post.moderationStatus === "removed") throw rule(REMOVED)
  if (body.caption !== undefined && post.source !== "upload") throw rule(post.source === "sample" ? "Sample posts keep their caption." : "Imported captions come from the original post. Edit it there.")
  if (body.visibility === "published") assertBrandMayPublish(actor)
  if (body.productIds?.length) await assertOwned(actor, body.productIds.map((p, i) => ({ kind: "product" as const, id: p, field: `productIds.${i}` })))
  return withTx(async () => {
    const d = await db()
    const set: Partial<typeof socialPosts.$inferInsert> = { updatedAt: new Date() }
    if (body.visibility !== undefined) set.visibility = body.visibility
    if (body.caption !== undefined) set.caption = body.caption
    if (body.productIds !== undefined) set.productIds = body.productIds
    if (body.featured === true && !post.featured) {
      const [m] = await d
        .select({ max: sql<number | null>`max(${socialPosts.featureOrder})` })
        .from(socialPosts)
        .where(and(eq(socialPosts.brandId, actor.brandId), eq(socialPosts.featured, true)))
      set.featured = true
      set.featureOrder = (Number(m?.max) || 0) + 1
    } else if (body.featured === false) {
      set.featured = false
      set.featureOrder = null
    }
    const [row] = await d
      .update(socialPosts)
      .set(set)
      .where(and(eq(socialPosts.id, post.id), eq(socialPosts.brandId, actor.brandId), ne(socialPosts.moderationStatus, "removed")))
      .returning()
    if (!row) throw rule(REMOVED)
    if (body.visibility !== undefined && body.visibility !== post.visibility) await refreshMedia(mediaIdsOf(row.media as StoredMedia[]))
    return toStudioPostDto(row)
  })
}

/** The bulk bar: show or hide several posts in one transaction. Removed posts can't be shown or hidden. */
export async function bulkVisibility(actor: BrandActor, ids: string[], visibility: "published" | "hidden") {
  if (visibility === "published") assertBrandMayPublish(actor)
  const unique = [...new Set(ids)]
  return withTx(async () => {
    const d = await db()
    const rows = await d
      .select()
      .from(socialPosts)
      .where(and(eq(socialPosts.brandId, actor.brandId), inArray(socialPosts.id, unique)))
    if (rows.length !== unique.length) throw notFound("Some of these posts no longer exist. Reload and try again.")
    if (rows.some((r) => r.moderationStatus === "removed")) throw rule("Yard removed one of these posts. Unselect it and try again.")
    const changed = await d
      .update(socialPosts)
      .set({ visibility, updatedAt: new Date() })
      .where(and(eq(socialPosts.brandId, actor.brandId), inArray(socialPosts.id, unique), ne(socialPosts.visibility, visibility)))
      .returning()
    await refreshMedia(changed.flatMap((r) => mediaIdsOf(r.media as StoredMedia[])))
    const all = await d
      .select()
      .from(socialPosts)
      .where(and(eq(socialPosts.brandId, actor.brandId), inArray(socialPosts.id, unique)))
    return all.map(toStudioPostDto)
  })
}

/** DELETE: uploads only (removed ones too). Imports can only be hidden. */
export async function deletePost(id: string) {
  const { actor, resource: post } = await loadOwnPost(id)
  if (post.source !== "upload") throw rule(post.source === "sample" ? "Sample posts can be hidden, not deleted." : "Imported posts can only be hidden. Disconnect the account to remove them all.")
  await withTx(async () => {
    const d = await db()
    await d.delete(socialPosts).where(and(eq(socialPosts.id, post.id), eq(socialPosts.brandId, actor.brandId)))
    // Unreferenced now, so private at once; the hourly purge deletes the files after 7 days.
    await refreshMedia(mediaIdsOf(post.media as StoredMedia[]))
  })
}

/** PUT featured-order: each id must be a featured post of the active brand. */
export async function setFeaturedOrder(actor: BrandActor, ids: string[]) {
  return withTx(async () => {
    const d = await db()
    const rows = ids.length
      ? await d
          .select({ id: socialPosts.id, featured: socialPosts.featured, moderation: socialPosts.moderationStatus })
          .from(socialPosts)
          .where(and(eq(socialPosts.brandId, actor.brandId), inArray(socialPosts.id, ids)))
      : []
    const ok = new Map(rows.map((r) => [r.id, r]))
    const fields: Record<string, string> = {}
    ids.forEach((id, i) => {
      const r = ok.get(id)
      if (!r || !r.featured || r.moderation === "removed") fields[`ids.${i}`] = "That post isn't one of your featured posts."
    })
    if (new Set(ids).size !== ids.length) fields.ids = "A post is listed twice."
    if (Object.keys(fields).length) throw badRequest(fields)
    for (const [i, id] of ids.entries()) await d.update(socialPosts).set({ featureOrder: i + 1, updatedAt: new Date() }).where(and(eq(socialPosts.id, id), eq(socialPosts.brandId, actor.brandId)))
    return { ids }
  })
}

/* ---------- Public ---------- */

const publicWhere = (brandId: string) => and(eq(socialPosts.brandId, brandId), eq(socialPosts.visibility, "published"), eq(socialPosts.moderationStatus, "ok"))

/**
 * GET /api/brands/{brandId}/social-posts: published, ok posts of a listed brand that Yard hasn't
 * paused (social_disabled). Pinned ids come first whatever the limit; `product` keeps only posts
 * tagging that piece. Unknown brand → 404; unlisted or paused → an empty list.
 */
export async function publicPosts(brandId: string, q: { source: FeedSource; limit: number; product?: string; pinned: string[] }) {
  const d = await db()
  const brand = await d.query.brands.findFirst({ where: (b, { eq }) => eq(b.id, brandId) })
  if (!brand || !brandById.has(brandId)) throw notFound()
  if (!brandListed(brand) || (await activeRestriction("brand", brandId, "social_disabled"))) return { posts: [] }
  const productWhere = q.product ? sql`${socialPosts.productIds} @> array[${q.product}]::text[]` : undefined
  const pinned = q.pinned.length && !q.product ? await d.select().from(socialPosts).where(and(publicWhere(brandId), inArray(socialPosts.id, q.pinned))) : []
  const rest = await d
    .select()
    .from(socialPosts)
    .where(and(publicWhere(brandId), sourceWhere(q.source), productWhere, pinned.length ? sql`${socialPosts.id} not in (${sql.join(pinned.map((p) => sql`${p.id}`), sql`, `)})` : undefined))
    .orderBy(...order)
    .limit(q.limit)
  const byId = new Map(pinned.map((p) => [p.id, p]))
  const ordered = [...q.pinned.map((id) => byId.get(id)).filter((p): p is PostRow => !!p), ...rest]
  return { posts: ordered.map((r) => toPostDto(r)) }
}

/** For the Studio setup card and checks: whether the brand has any upload post. */
export async function hasUploads(brandId: string) {
  const d = await db()
  const [row] = await d
    .select({ id: socialPosts.id })
    .from(socialPosts)
    .where(and(eq(socialPosts.brandId, brandId), eq(socialPosts.source, "upload")))
    .limit(1)
  return !!row
}
