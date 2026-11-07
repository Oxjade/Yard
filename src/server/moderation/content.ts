import "server-only"
import { and, desc, eq, inArray, ne } from "drizzle-orm"
import { activeRestriction } from "../auth/dal"
import { afterCommit, db } from "../db"
import { accountRestrictions, brandLocations, locationEvents, mediaAssets, reports, socialAccounts, socialPosts } from "../db/schema"
import { getEnv } from "../env"
import { log } from "../log"
import { notFound } from "../http/errors"
import { newId } from "../ids"
import * as media from "../media"
import { notify } from "../notify"
import * as social from "../social"
import type { ContentPostDto, IntegrationDto, PlaceDto, PlaceEventDto } from "@/lib/api/contracts/admin"
import { adminMediaSrc } from "./evidence"
import { actionReports, assertState, audit, brandMap, brandRefOf, iso, OPEN_REPORT, openReportsFor, publishCountsAfterCommit, reportIdsFor, tryFeature, type DecisionCtx } from "./shared"

/**
 * Admin › Content (§8.1): posts and uploads (content.moderate), places with their events as child
 * rows (places.moderate) and social integrations (social.manage). Every visibility change runs
 * media.refreshVisibility in the same transaction (§5.4).
 */

type PostRow = typeof socialPosts.$inferSelect
type PlaceRow = typeof brandLocations.$inferSelect
type EventRow = typeof locationEvents.$inferSelect

const IMPORT_SOURCES = ["instagram", "tiktok", "sandbox", "sample"]
const LIMIT = 300

export async function refreshMedia(ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))]
  if (list.length) await tryFeature("media.refreshVisibility", () => media.refreshVisibility(list))
}

const postMediaIds = (p: Pick<PostRow, "media">) => p.media.flatMap((m) => [m.mediaId, m.posterMediaId])

/** Marks media Yard removed (served to admins only, §5.4), or restores it. Used for posts, places, events and messages. */
export async function setMediaModeration(ids: (string | null | undefined)[], status: "removed" | "ok") {
  const list = [...new Set(ids.filter((x): x is string => !!x))]
  if (!list.length) return
  const d = await db()
  await d
    .update(mediaAssets)
    .set({ moderationStatus: status })
    .where(and(inArray(mediaAssets.id, list), status === "ok" ? eq(mediaAssets.moderationStatus, "removed") : ne(mediaAssets.moderationStatus, "removed")))
}

/* ── Posts and uploads ─────────────────────────────────────────────── */

async function postDtos(rows: PostRow[]): Promise<ContentPostDto[]> {
  const brands = await brandMap(rows.map((p) => p.brandId))
  const reports = await openReportsFor("social_post", rows.map((p) => p.id))
  const history = await reportIdsFor("social_post", rows.map((p) => p.id))
  return rows.map((p) => ({
    id: p.id,
    brand: brandRefOf(brands, p.brandId),
    source: p.source,
    kind: p.kind,
    caption: p.caption,
    permalink: p.permalink,
    media: p.media
      .map((m) => ({ src: adminMediaSrc(m.src, m.mediaId) ?? "", alt: m.alt, kind: m.kind, poster: adminMediaSrc(m.posterSrc, m.posterMediaId) }))
      .filter((m) => m.src),
    visibility: p.visibility,
    moderationStatus: p.moderationStatus as ContentPostDto["moderationStatus"],
    removedReason: p.removedReason,
    postedAt: p.postedAt.toISOString(),
    sample: p.sample,
    report: reports.get(p.id) ?? null,
    reportIds: history.get(p.id) ?? [],
  }))
}

const rank = (p: ContentPostDto) => (p.report ? 0 : p.moderationStatus === "flagged" ? 1 : p.moderationStatus === "removed" ? 2 : 3)

/** Posts (imported or sample) or uploads: everything not still a draft, reported first. */
export async function listPosts(kind: "posts" | "uploads") {
  const d = await db()
  const rows = await d
    .select()
    .from(socialPosts)
    .where(and(kind === "uploads" ? eq(socialPosts.source, "upload") : inArray(socialPosts.source, IMPORT_SOURCES), ne(socialPosts.visibility, "draft")))
    .orderBy(desc(socialPosts.postedAt))
    .limit(LIMIT)
  const out = await postDtos(rows)
  return out.sort((a, b) => rank(a) - rank(b) || b.postedAt.localeCompare(a.postedAt))
}

const postWords = { hide: "post.hidden", remove: "post.removed", restore: "post.restored" } as const

/** set-post-moderation: hide (pending, the brand can't show it), remove (locked) or restore. */
export async function setPostModeration(ctx: DecisionCtx, body: { id: string; action: "hide" | "remove" | "restore"; reason: string; reportId?: string }) {
  const d = await db()
  const p = await d.query.socialPosts.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!p) throw notFound()
  const from = { hide: ["ok"], remove: ["ok", "flagged"], restore: ["flagged", "removed"] }[body.action]
  assertState(from.includes(p.moderationStatus))
  const to = { hide: "flagged", remove: "removed", restore: "ok" }[body.action]
  const [updated] = await d
    .update(socialPosts)
    .set({ moderationStatus: to, removedReason: body.action === "restore" ? null : body.reason, updatedAt: new Date() })
    .where(and(eq(socialPosts.id, p.id), inArray(socialPosts.moderationStatus, from)))
    .returning()
  assertState(!!updated)
  if (body.action === "remove") await setMediaModeration(postMediaIds(p), "removed")
  if (body.action === "restore") await setMediaModeration(postMediaIds(p), "ok")
  await refreshMedia(postMediaIds(p))
  const actioned = body.action === "restore" ? [] : await actionReports(ctx, "social_post", p.id, { subjectLabel: "a post" })
  const brands = await brandMap([p.brandId])
  const brand = brandRefOf(brands, p.brandId)
  const entry = await audit(ctx, {
    action: postWords[body.action],
    target: `${p.source === "upload" ? "Upload" : "Post"} by ${brand.name}${p.caption ? `: “${p.caption.slice(0, 40)}${p.caption.length > 40 ? "…" : ""}”` : ""}`,
    subjectType: "social_post",
    subjectId: p.id,
    brandId: p.brandId,
    reason: body.reason,
    meta: { source: p.source, reportIds: actioned.map((r) => r.id) },
  })
  if (body.action !== "restore")
    await notify({ kind: "brand", id: p.brandId }, { key: `post-moderation:${p.id}`, template: "content.removed", vars: { kind: body.action === "hide" ? "post from your feed for review" : "post", reason: body.reason }, href: "/studio/social?tab=content" })
  publishCountsAfterCommit()
  return { item: (await postDtos([updated]))[0], audit: entry }
}

/* ── Places and events ─────────────────────────────────────────────── */

const placeImages = (p: Pick<PlaceRow, "images">) => p.images.map((i) => i.mediaId)

function eventDto(e: EventRow, report: PlaceEventDto["report"], reportIds: string[]): PlaceEventDto {
  return {
    id: e.id,
    locationId: e.locationId,
    title: e.title,
    kind: e.kind,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    promo: e.promoText,
    description: e.description,
    visibility: e.visibility,
    moderationStatus: e.moderationStatus as PlaceEventDto["moderationStatus"],
    moderationReason: e.moderationReason,
    sample: e.sample,
    report,
    reportIds,
  }
}

async function placeDtos(rows: PlaceRow[]): Promise<PlaceDto[]> {
  const d = await db()
  const ids = rows.map((p) => p.id)
  const events = ids.length ? await d.select().from(locationEvents).where(and(inArray(locationEvents.locationId, ids), ne(locationEvents.visibility, "draft"))) : []
  const brands = await brandMap(rows.map((p) => p.brandId))
  const placeReports = await openReportsFor("location", ids)
  const eventReports = await openReportsFor("location_event", events.map((e) => e.id))
  const placeHistory = await reportIdsFor("location", ids)
  const eventHistory = await reportIdsFor("location_event", events.map((e) => e.id))
  return rows.map((p) => {
    const b = brands.get(p.brandId)
    const img = p.images[0]
    return {
      id: p.id,
      brand: { ...brandRefOf(brands, p.brandId), verified: b?.reviewStatus === "verified" },
      name: p.name,
      kind: p.kind,
      address: p.addressLine,
      neighbourhood: p.neighbourhood,
      city: p.city,
      country: p.country,
      startsAt: iso(p.startsAt),
      endsAt: iso(p.endsAt),
      description: p.description,
      image: img ? { src: adminMediaSrc(img.src, img.mediaId) ?? "", alt: img.alt } : null,
      visibility: p.visibility,
      moderationStatus: p.moderationStatus as PlaceDto["moderationStatus"],
      moderationReason: p.moderationReason,
      reviewedAt: iso(p.reviewedAt),
      sample: p.sample,
      report: placeReports.get(p.id) ?? null,
      reportIds: placeHistory.get(p.id) ?? [],
      events: events
        .filter((e) => e.locationId === p.id)
        .sort((a, z) => a.startsAt.getTime() - z.startsAt.getTime())
        .map((e) => eventDto(e, eventReports.get(e.id) ?? null, eventHistory.get(e.id) ?? [])),
    }
  })
}

/** Whether a place (or one of its events) is waiting on a moderator. */
export const placeNeedsReview = (p: PlaceDto) => p.moderationStatus === "pending_review" || !!p.report || p.events.some((e) => e.moderationStatus === "pending_review" || !!e.report)

export async function listPlaces() {
  const d = await db()
  const rows = await d.select().from(brandLocations).where(ne(brandLocations.visibility, "draft")).orderBy(desc(brandLocations.updatedAt)).limit(LIMIT)
  const out = await placeDtos(rows)
  const weight = (p: PlaceDto) => (placeNeedsReview(p) ? 0 : p.moderationStatus === "rejected" || p.moderationStatus === "removed" ? 1 : 2)
  return out.sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name))
}

const placeOutcome = { approve: "approved", reject: "not approved", remove: "removed by Yard", restore: "restored" } as const

/** set-place-moderation: approve, reject (the brand can fix it), remove (locked) or restore. */
export async function setPlaceModeration(ctx: DecisionCtx, body: { id: string; action: "approve" | "reject" | "remove" | "restore"; reason: string; reportId?: string }) {
  const d = await db()
  const p = await d.query.brandLocations.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!p) throw notFound()
  const from = { approve: ["pending_review", "rejected"], reject: ["pending_review", "approved"], remove: ["pending_review", "approved", "rejected"], restore: ["removed"] }[body.action]
  assertState(from.includes(p.moderationStatus))
  const to = { approve: "approved", reject: "rejected", remove: "removed", restore: "approved" }[body.action]
  const now = new Date()
  const [updated] = await d
    .update(brandLocations)
    .set({ moderationStatus: to, moderationReason: to === "approved" ? null : body.reason, reviewedAt: now, updatedAt: now })
    .where(and(eq(brandLocations.id, p.id), inArray(brandLocations.moderationStatus, from)))
    .returning()
  assertState(!!updated)
  const events = await d.select().from(locationEvents).where(eq(locationEvents.locationId, p.id))
  const mediaIds = [...placeImages(p), ...events.map((e) => e.image?.mediaId)]
  if (body.action === "remove") await setMediaModeration(mediaIds, "removed")
  if (body.action === "restore") await setMediaModeration(mediaIds, "ok")
  await refreshMedia(mediaIds)
  const { invalidate } = await import("../around")
  await tryFeature("around.invalidate", () => invalidate())
  const actioned = body.action === "reject" || body.action === "remove" ? await actionReports(ctx, "location", p.id, { subjectLabel: "a place" }) : []
  const brands = await brandMap([p.brandId])
  const entry = await audit(ctx, {
    action: `location.${{ approve: "approved", reject: "rejected", remove: "removed", restore: "restored" }[body.action]}`,
    target: `${p.name}, ${brandRefOf(brands, p.brandId).name}`,
    subjectType: "location",
    subjectId: p.id,
    brandId: p.brandId,
    reason: body.reason,
    meta: { kind: p.kind, from: p.moderationStatus, reportIds: actioned.map((r) => r.id) },
  })
  await notify(
    { kind: "brand", id: p.brandId },
    { key: `place-review:${p.id}`, template: "location.review", vars: { place: p.name, outcome: placeOutcome[body.action], detail: to === "approved" ? "It can show on Yard Around now." : `Reason: ${body.reason}` }, href: `/studio/locations/edit?id=${p.id}` },
  )
  publishCountsAfterCommit()
  return { item: (await placeDtos([updated]))[0], audit: entry }
}

const eventOutcome = { approve: "approved", hide: "hidden by Yard", remove: "removed by Yard" } as const

/** set-event-moderation: approve, hide (rejected; the brand can fix and resubmit) or remove (locked). */
export async function setEventModeration(ctx: DecisionCtx, body: { id: string; action: "approve" | "hide" | "remove"; reason: string; reportId?: string }) {
  const d = await db()
  const e = await d.query.locationEvents.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!e) throw notFound()
  const from = { approve: ["pending_review", "rejected"], hide: ["pending_review", "approved"], remove: ["pending_review", "approved", "rejected"] }[body.action]
  assertState(from.includes(e.moderationStatus))
  const to = { approve: "approved", hide: "rejected", remove: "removed" }[body.action]
  const now = new Date()
  const [updated] = await d
    .update(locationEvents)
    .set({ moderationStatus: to, moderationReason: to === "approved" ? null : body.reason, reviewedAt: now, updatedAt: now })
    .where(and(eq(locationEvents.id, e.id), inArray(locationEvents.moderationStatus, from)))
    .returning()
  assertState(!!updated)
  if (body.action === "remove") await setMediaModeration([e.image?.mediaId], "removed")
  await refreshMedia([e.image?.mediaId])
  const { invalidate } = await import("../around")
  await tryFeature("around.invalidate", () => invalidate())
  const actioned = body.action === "approve" ? [] : await actionReports(ctx, "location_event", e.id, { subjectLabel: "an event" })
  const place = await d.query.brandLocations.findFirst({ where: (x, { eq }) => eq(x.id, e.locationId) })
  const brands = await brandMap([e.brandId])
  const entry = await audit(ctx, {
    action: `location_event.${{ approve: "approved", hide: "hidden", remove: "removed" }[body.action]}`,
    target: `${e.title} at ${place?.name ?? "a place"}, ${brandRefOf(brands, e.brandId).name}`,
    subjectType: "location_event",
    subjectId: e.id,
    brandId: e.brandId,
    reason: body.reason,
    meta: { locationId: e.locationId, from: e.moderationStatus, reportIds: actioned.map((r) => r.id) },
  })
  await notify(
    { kind: "brand", id: e.brandId },
    { key: `event-review:${e.id}`, template: "location.review", vars: { place: e.title, outcome: eventOutcome[body.action], detail: to === "approved" ? "It can show on Yard Around now." : `Reason: ${body.reason}` }, href: `/studio/locations/edit?id=${e.locationId}` },
  )
  publishCountsAfterCommit()
  const reports = await openReportsFor("location_event", [e.id])
  const history = await reportIdsFor("location_event", [e.id])
  return { item: eventDto(updated, reports.get(e.id) ?? null, history.get(e.id) ?? []), audit: entry }
}

/* ── Social integrations ───────────────────────────────────────────── */

async function integrationDtos(rows: (typeof socialAccounts.$inferSelect)[]): Promise<IntegrationDto[]> {
  const brands = await brandMap(rows.map((a) => a.brandId))
  const d = await db()
  const paused = new Set(
    (
      await d
        .select({ id: accountRestrictions.subjectId })
        .from(accountRestrictions)
        .where(and(eq(accountRestrictions.subjectKind, "brand"), eq(accountRestrictions.kind, "social_disabled"), eq(accountRestrictions.status, "active")))
    ).map((r) => r.id),
  )
  return rows.map((a) => ({
    id: a.id,
    brand: brandRefOf(brands, a.brandId),
    provider: a.provider as IntegrationDto["provider"],
    mode: a.mode as IntegrationDto["mode"],
    handle: a.handle,
    status: a.status,
    statusDetail: a.statusDetail,
    lastErrorCode: a.lastErrorCode,
    connectedAt: a.connectedAt.toISOString(),
    lastSyncAt: iso(a.lastSyncAt),
    nextSyncAfter: iso(a.nextSyncAfter),
    tokenExpiresAt: iso(a.tokenExpiresAt),
    paused: paused.has(a.brandId),
  }))
}

export async function listIntegrations() {
  const d = await db()
  // Metadata only: social_tokens isn't in the runtime schema, so nothing here can load a token (§5.5).
  const rows = await d.select().from(socialAccounts).orderBy(desc(socialAccounts.connectedAt)).limit(LIMIT)
  const pausedRows = await d
    .select()
    .from(accountRestrictions)
    .where(and(eq(accountRestrictions.subjectKind, "brand"), eq(accountRestrictions.kind, "social_disabled"), eq(accountRestrictions.status, "active")))
  const brands = await brandMap(pausedRows.map((r) => r.subjectId))
  const env = getEnv()
  return {
    integrations: await integrationDtos(rows),
    paused: pausedRows.map((r) => ({ restrictionId: r.id, brand: brandRefOf(brands, r.subjectId), since: r.createdAt.toISOString(), reason: r.reason })),
    setup: {
      sandboxEnabled: env.sandboxEnabled,
      providers: [
        { provider: "instagram" as const, configured: env.instagram.configured, envVars: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "INSTAGRAM_GRAPH_VERSION"], redirectUri: `${env.publicOrigin}/api/social/instagram/callback` },
        { provider: "tiktok" as const, configured: env.tiktok.configured, envVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_USE_PKCE"], redirectUri: `${env.publicOrigin}/api/social/tiktok/callback` },
      ],
    },
  }
}

/** retry-social-sync: due now; the sync itself (network) runs after commit, outside the transaction. */
export async function retrySocialSync(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const a = await d.query.socialAccounts.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!a) throw notFound()
  assertState(a.status !== "disconnected" && a.status !== "revoked", "This account isn't connected any more — refreshed.")
  const [updated] = await d.update(socialAccounts).set({ nextSyncAfter: new Date() }).where(eq(socialAccounts.id, a.id)).returning()
  const brands = await brandMap([a.brandId])
  const entry = await audit(ctx, {
    action: "social.sync_retried",
    target: `${a.provider === "instagram" ? "Instagram" : "TikTok"} ${a.handle ? `@${a.handle}` : ""} for ${brandRefOf(brands, a.brandId).name}`.replace("  ", " "),
    subjectType: "social_account",
    subjectId: a.id,
    brandId: a.brandId,
    reason: body.reason,
    meta: { provider: a.provider, mode: a.mode, status: a.status },
  })
  // S's retrySync does the provider calls, so it runs after commit, outside the transaction (§1.3).
  afterCommit(async () => {
    const retry = (social as unknown as { retrySync?: (id: string) => Promise<unknown> }).retrySync
    await tryFeature("social.retrySync", () => (retry ? retry(a.id) : social.syncDue())).catch((e) => log.warn(`[yard] moderation: retry sync for ${a.id} failed after commit`, e))
  })
  return { item: (await integrationDtos([updated]))[0], audit: entry }
}

/** force-disconnect-social: S's contract disconnects, deletes the sealed tokens and hides imports. */
export async function forceDisconnectSocial(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const a = await d.query.socialAccounts.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!a) throw notFound()
  assertState(a.status !== "disconnected", "This account is already disconnected — refreshed.")
  // No fallback: only src/server/social may touch tokens, so a stub stops the decision (503).
  await social.forceDisconnect(a.id, body.reason)
  const brands = await brandMap([a.brandId])
  const entry = await audit(ctx, {
    action: "social.force_disconnected",
    target: `${a.provider === "instagram" ? "Instagram" : "TikTok"}${a.handle ? ` @${a.handle}` : ""} for ${brandRefOf(brands, a.brandId).name}`,
    subjectType: "social_account",
    subjectId: a.id,
    brandId: a.brandId,
    reason: body.reason,
    meta: { provider: a.provider, mode: a.mode },
  })
  await notify({ kind: "brand", id: a.brandId }, { key: `social-disconnect:${a.id}`, template: "social.status", vars: { provider: a.provider === "instagram" ? "Instagram" : "TikTok", detail: `Yard disconnected it. Reason: ${body.reason}` }, href: "/studio/social?tab=connections" })
  const fresh = (await d.query.socialAccounts.findFirst({ where: (x, { eq }) => eq(x.id, a.id) }))!
  return { item: (await integrationDtos([fresh]))[0], audit: entry }
}

/** set-social-paused: a social_disabled restriction hides the brand's whole feed (or lifts it). */
export async function setSocialPaused(ctx: DecisionCtx, body: { id: string; paused: boolean; reason: string }) {
  const d = await db()
  const brands = await brandMap([body.id])
  if (!brands.has(body.id)) throw notFound()
  const brand = brandRefOf(brands, body.id)
  const current = await activeRestriction("brand", body.id, "social_disabled")
  const now = new Date()
  let restrictionId: string
  if (body.paused) {
    assertState(!current, `${brand.name}'s social feed is already paused — refreshed.`)
    restrictionId = newId("rs")
    await d.insert(accountRestrictions).values({ id: restrictionId, subjectKind: "brand", subjectId: body.id, kind: "social_disabled", reason: body.reason, status: "active", requestedBy: ctx.actor.userId, approvedBy: ctx.actor.userId, createdAt: now })
  } else {
    assertState(!!current, `${brand.name}'s social feed isn't paused — refreshed.`)
    restrictionId = current!.id
    await d.update(accountRestrictions).set({ status: "lifted", liftedAt: now, liftedBy: ctx.actor.userId }).where(eq(accountRestrictions.id, current!.id))
  }
  const posts = await d.select({ media: socialPosts.media }).from(socialPosts).where(eq(socialPosts.brandId, body.id))
  await refreshMedia(posts.flatMap(postMediaIds))
  const entry = await audit(ctx, {
    action: body.paused ? "social.paused" : "social.resumed",
    target: `${brand.name}'s social feed`,
    subjectType: "brand",
    subjectId: body.id,
    brandId: body.id,
    reason: body.reason,
    meta: { restrictionId },
  })
  await notify(
    { kind: "brand", id: body.id },
    { key: `social-paused:${body.id}`, template: "social.status", vars: { provider: "Your social feed", detail: body.paused ? `Yard paused it. Reason: ${body.reason}` : "Yard resumed it. Posts you show are public again." }, href: "/studio/social?tab=content" },
  )
  const accounts = await d.select().from(socialAccounts).where(eq(socialAccounts.brandId, body.id))
  return { item: { brand, paused: body.paused, restrictionId, accounts: await integrationDtos(accounts) }, audit: entry }
}

export async function contentCounts() {
  const d = await db()
  const reported = async (sources: string[]) => {
    const rows = await d
      .selectDistinct({ id: reports.subjectId })
      .from(reports)
      .innerJoin(socialPosts, eq(socialPosts.id, reports.subjectId))
      .where(and(eq(reports.subjectType, "social_post"), inArray(reports.status, [...OPEN_REPORT]), inArray(socialPosts.source, sources)))
    return rows.length
  }
  const [posts, uploads, places, integrations] = await Promise.all([
    reported(IMPORT_SOURCES),
    reported(["upload"]),
    listPlaces().then((list) => list.filter(placeNeedsReview).length),
    d.select({ id: socialAccounts.id }).from(socialAccounts).where(inArray(socialAccounts.status, ["error", "needs_reauth"])).then((r) => r.length),
  ])
  return { posts, uploads, places, integrations }
}
