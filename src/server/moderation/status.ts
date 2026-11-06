import "server-only"
import { eq, inArray } from "drizzle-orm"
import { endBrandSessions, endSessionsForUser } from "../auth/session"
import { db } from "../db"
import { brandLocations, brands, locationEvents, socialPosts, users } from "../db/schema"
import { notFound, rule } from "../http/errors"
import { notify } from "../notify"
import { assertState, audit, publishCountsAfterCommit, tryFeature, type DecisionCtx } from "./shared"
import { refreshMedia } from "./content"

/**
 * Account and brand status (§2.2, §8.2), enforced on the server: one transaction writes the
 * column, ends the sessions a suspension ends, refreshes media visibility, drops the charts and
 * Around caches and writes one audit row; session.ended and moderation.counts go out after commit.
 */

const userWords = { active: "active", restricted: "restricted", suspended: "suspended" } as const

export type UserStatusDto = { id: string; name: string; email: string; status: "active" | "restricted" | "suspended"; sessionsEnded: number }
export type BrandStatusDto = { id: string; name: string; handle: string; status: "pending_review" | "verified" | "restricted" | "suspended"; sessionsEnded: number }

export async function setUserStatus(ctx: DecisionCtx, body: { id: string; status: "active" | "restricted" | "suspended"; reason: string }) {
  const d = await db()
  const u = await d.query.users.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!u) throw notFound()
  if (u.kind === "admin") throw rule("Admin accounts are managed under Security, not here.")
  assertState(u.status !== body.status, `${u.name} is already ${userWords[body.status]} — refreshed.`)
  const [row] = await d.update(users).set({ status: body.status }).where(eq(users.id, u.id)).returning()
  // A suspended account has no sessions at all, on any surface (§2.1). session.ended goes out after commit.
  const ended = body.status === "suspended" ? await endSessionsForUser(u.id, ["shopper", "brand", "admin"], "suspended") : 0
  const entry = await audit(ctx, {
    action: "user.status_changed",
    target: `${u.name}, ${u.email}`,
    subjectType: "user",
    subjectId: u.id,
    reason: body.reason,
    meta: { from: u.status, to: body.status, sessionsEnded: ended },
  })
  publishCountsAfterCommit()
  const item: UserStatusDto = { id: row.id, name: row.name, email: row.email, status: row.status as UserStatusDto["status"], sessionsEnded: ended }
  return { item, audit: entry }
}

const brandWords = { pending_review: "returned to review", verified: "verified", restricted: "restricted", suspended: "suspended" } as const

export async function setBrandStatus(ctx: DecisionCtx, body: { id: string; status: "pending_review" | "verified" | "restricted" | "suspended"; reason: string }) {
  const d = await db()
  const b = await d.query.brands.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!b) throw notFound()
  assertState(b.reviewStatus !== body.status, `${b.name} is already ${brandWords[body.status]} — refreshed.`)
  const [row] = await d
    .update(brands)
    .set({ reviewStatus: body.status, ...(body.status === "verified" ? { verified: true } : {}) })
    .where(eq(brands.id, b.id))
    .returning()
  const ended = body.status === "suspended" ? await endBrandSessions(b.id, "brand_suspended") : 0
  // A restricted or suspended brand isn't listed (brandListed), so its public media goes private.
  const [posts, places, events] = await Promise.all([
    d.select({ media: socialPosts.media }).from(socialPosts).where(eq(socialPosts.brandId, b.id)),
    d.select({ images: brandLocations.images }).from(brandLocations).where(eq(brandLocations.brandId, b.id)),
    d.select({ image: locationEvents.image }).from(locationEvents).where(eq(locationEvents.brandId, b.id)),
  ])
  await refreshMedia([...posts.flatMap((p) => p.media.flatMap((m) => [m.mediaId, m.posterMediaId])), ...places.flatMap((p) => p.images.map((i) => i.mediaId)), ...events.map((e) => e.image?.mediaId)])
  const chartsMod = await import("../charts")
  await tryFeature("charts.invalidate", () => chartsMod.invalidate(b.id))
  const aroundMod = await import("../around")
  await tryFeature("around.invalidate", () => aroundMod.invalidate())
  const entry = await audit(ctx, {
    action: "brand.status_changed",
    target: b.name,
    subjectType: "brand",
    subjectId: b.id,
    brandId: b.id,
    reason: body.reason,
    meta: { from: b.reviewStatus, to: body.status, sessionsEnded: ended },
  })
  if (body.status === "restricted" || body.status === "suspended")
    await notify({ kind: "brand", id: b.id }, { key: `brand-status:${b.id}`, template: "brand.status", vars: { status: body.status, brand: b.name, reason: body.reason }, href: "/studio/notifications" })
  publishCountsAfterCommit()
  const item: BrandStatusDto = { id: row.id, name: row.name, handle: row.handle, status: row.reviewStatus as BrandStatusDto["status"], sessionsEnded: ended }
  return { item, audit: entry }
}

/** Server statuses for the Users and Brands pages to mirror into this browser's store. */
export async function statusesFor(kind: "user" | "brand", ids: string[]) {
  const d = await db()
  if (!ids.length) return {}
  if (kind === "user") return Object.fromEntries((await d.select({ id: users.id, status: users.status }).from(users).where(inArray(users.id, ids))).map((r) => [r.id, r.status]))
  return Object.fromEntries((await d.select({ id: brands.id, status: brands.reviewStatus }).from(brands).where(inArray(brands.id, ids))).map((r) => [r.id, r.status]))
}
