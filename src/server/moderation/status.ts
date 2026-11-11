import "server-only"
import { and, desc, eq, inArray } from "drizzle-orm"
import { endBrandSessions, endSessionsForUser } from "../auth/session"
import { catalogChanged } from "../catalog/hooks"
import { db } from "../db"
import { auditLog, brandLocations, brands, locationEvents, socialPosts, users } from "../db/schema"
import { notFound, rule } from "../http/errors"
import { assertState, audit, publishCountsAfterCommit, tryFeature, notify, type DecisionCtx } from "./shared"
import { refreshMedia } from "./content"

/**
 * Account and brand status (§2.2, §8.2), enforced on the server: one transaction writes the
 * column, ends the sessions a suspension ends, refreshes media visibility, drops the charts and
 * Around caches and writes one audit row; session.ended and moderation.counts go out after commit.
 */

const userWords = { active: "active", restricted: "restricted", suspended: "suspended" } as const
const userTargetWords = { active: "reinstated (active)", restricted: "restricted", suspended: "suspended" } as const

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
    // The new status is in the target, so Activity and the audit log say what changed (meta isn't in the DTO).
    target: `${u.name}, ${u.email}: ${userTargetWords[body.status]}`,
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
type BrandStatus = keyof typeof brandWords
const OUT_OF_STANDING: readonly string[] = ["restricted", "suspended"]

/**
 * The status a restricted or suspended brand had before Yard took it out of good standing, read
 * from its own brand.status_changed rows (meta.from), newest first, through any chain of
 * restrictions and suspensions. Unknown (seeded sample statuses have no audit row) → pending_review,
 * so a reinstatement never verifies a brand that wasn't verified (I's off-platform payment hold
 * applies to every brand that isn't verified).
 */
export async function statusBeforeSuspension(brandId: string): Promise<"pending_review" | "verified"> {
  const d = await db()
  const rows = await d
    .select({ meta: auditLog.meta })
    .from(auditLog)
    .where(and(eq(auditLog.action, "brand.status_changed"), eq(auditLog.subjectType, "brand"), eq(auditLog.subjectId, brandId)))
    .orderBy(desc(auditLog.at))
    .limit(50)
  for (const r of rows) {
    const m = (r.meta ?? {}) as { from?: unknown; to?: unknown }
    if (typeof m.to !== "string" || !OUT_OF_STANDING.includes(m.to)) break
    if (m.from === "verified" || m.from === "pending_review") return m.from
  }
  return "pending_review"
}

export async function setBrandStatus(ctx: DecisionCtx, body: { id: string; status: BrandStatus | "reinstate"; reason: string }) {
  const d = await db()
  const b = await d.query.brands.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!b) throw notFound()
  // Reinstate restores what the brand had before its restriction or suspension, decided here on the
  // server (never "verified" by default).
  if (body.status === "reinstate") assertState(OUT_OF_STANDING.includes(b.reviewStatus), `${b.name} isn't restricted or suspended — refreshed.`)
  const next: BrandStatus = body.status === "reinstate" ? await statusBeforeSuspension(b.id) : body.status
  assertState(b.reviewStatus !== next, `${b.name} is already ${brandWords[next]} — refreshed.`)
  const [row] = await d
    .update(brands)
    // brands.verified follows review_status on every change, so a demotion clears it too.
    .set({ reviewStatus: next, verified: next === "verified" })
    .where(eq(brands.id, b.id))
    .returning()
  const ended = next === "suspended" ? await endBrandSessions(b.id, "brand_suspended") : 0
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
  // Listing follows review_status (brandListedSql), so drop the public catalogue memos (the home
  // hero, the founding rail, the storefront) and refresh the brand's catalogue photo visibility now,
  // not when the 60 s memo runs out. After commit, like every catalogue write.
  catalogChanged({ brands: [b.id] })
  const reinstated = OUT_OF_STANDING.includes(b.reviewStatus) && !OUT_OF_STANDING.includes(next)
  const entry = await audit(ctx, {
    action: "brand.status_changed",
    target: `${b.name}: ${reinstated ? `reinstated (${next === "verified" ? "verified" : "in review"})` : brandWords[next]}`,
    subjectType: "brand",
    subjectId: b.id,
    brandId: b.id,
    reason: body.reason,
    meta: { from: b.reviewStatus, to: next, sessionsEnded: ended, ...(body.status === "reinstate" ? { reinstate: true } : {}) },
  })
  if (next === "restricted" || next === "suspended")
    await notify({ kind: "brand", id: b.id }, { key: `brand-status:${b.id}`, template: "brand.status", vars: { status: next, brand: b.name, reason: body.reason }, href: "/studio/notifications" })
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

/** For restricted or suspended brands: the status Reinstate would restore (the Brands page says it first). */
export async function reinstateTargets(ids: string[]) {
  const d = await db()
  if (!ids.length) return {}
  const out = (await d.select({ id: brands.id, status: brands.reviewStatus }).from(brands).where(inArray(brands.id, ids))).filter((r) => OUT_OF_STANDING.includes(r.status))
  return Object.fromEntries(await Promise.all(out.map(async (r) => [r.id, await statusBeforeSuspension(r.id)] as const)))
}
