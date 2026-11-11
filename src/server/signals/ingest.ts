import "server-only"
import { and, asc, countDistinct, eq, inArray, isNull, ne, notInArray } from "drizzle-orm"
import { drops } from "@/lib/data/catalog"
import { productById } from "@/lib/data/products"
import { db, withTx } from "../db"
import { brands, chartEvents, shopperFollows, shopperReminders, shopperWishlist } from "../db/schema"
import { catalogProducts } from "../db/schema/catalog"
import { drops as dropRows } from "../db/schema/engagement"
import { refuseSampleDrop, refuseSampleProduct, refusedSampleBrand, sampleOff } from "../catalog/sample-guard"
import { brandListedSql, productPublicWhere } from "../catalog/sellable"
import { badRequest } from "../http/errors"
import { recordAbuse } from "../security/rate-limit"

/**
 * Signal ingest (§6.3, F2). The route has already checked the kind allowlist and that state kinds
 * come with a shopper session. Here:
 *  - the brand is resolved by the server: from the product or drop with the static catalogue, or
 *    (follow, unfollow, storefront_view, post_open) a brandId that must exist; post_open may
 *    name a public post instead;
 *  - follows, wishlists and reminders keep server-side state and count only real changes; a
 *    reversal (unfollow, wishlist_remove, reminder_unset) counts only when the event that set the
 *    state was counted, otherwise it takes that event's exclusion (or deduped), so a brand never
 *    loses in the charts a follow it never gained;
 *  - views and opens count once per actor, item, kind and day (partial unique index);
 *  - verdicts, in order: excluded_self (a member of that brand), excluded_restricted, deduped,
 *    excluded_anon (no established cookie), excluded_fraud (more than 3 distinct counted actors
 *    from one known ip_hash for one brand and day, rule signal_ip_cap; skipped when the IP is
 *    unknown); when the IP is unknown, anonymous actors beyond ANON_CAP_UNKNOWN_IP distinct counted
 *    ones per brand and day are excluded_fraud too (abuse rule signal_anon), because without an IP
 *    nothing else bounds how many cookies one script can mint; otherwise counted.
 * Everything happens in one transaction, so the state change and its event commit together.
 */
export type SignalKind = "follow" | "unfollow" | "wishlist_add" | "wishlist_remove" | "reminder_set" | "reminder_unset" | "product_view" | "storefront_view" | "post_open"
export type SignalInput = { kind: SignalKind | string; productId?: string; dropId?: string; brandId?: string; postId?: string }
export type SignalVerdict = "counted" | "deduped" | "excluded_self" | "excluded_restricted" | "excluded_fraud" | "excluded_anon"

export type SignalActor = {
  actorKind: "shopper" | "anon"
  actorId: string
  ipHash: string | null
  uaHash: string | null
  accountAgeDays: number | null
  /** Shoppers: the account's status. Anonymous: whether the yard_anon cookie is older than 60 s. */
  status?: "active" | "restricted" | "suspended"
  anonEstablished?: boolean
}

export const STATE_KINDS = new Set<string>(["follow", "unfollow", "wishlist_add", "wishlist_remove", "reminder_set", "reminder_unset"])
/** Each reversing kind and the kind whose state it undoes. */
const REVERSES: Record<string, string> = { unfollow: "follow", wishlist_remove: "wishlist_add", reminder_unset: "reminder_set" }
export const IP_CAP = 3
/** Distinct counted anonymous actors per brand and day while the client IP is unknown. */
export const ANON_CAP_UNKNOWN_IP = 100

const dropById = (id: string) => drops.find((d) => d.id === id)

/**
 * A product's brand from the server catalogue (a public product of a listed brand), or null. The
 * sample catalogue answers first only in demo and development; production refuses sample ids
 * before this and reads real products here, so a real piece's page view and saves count.
 */
async function catalogueProductBrand(productId: string): Promise<string | null> {
  const d = await db()
  const [row] = await d
    .select({ brandId: catalogProducts.brandId })
    .from(catalogProducts)
    .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
    .where(and(eq(catalogProducts.id, productId), productPublicWhere()))
    .limit(1)
  return row?.brandId ?? null
}

/** A brand-created public drop's brand (not draft or cancelled, listed brand), or null. */
async function catalogueDropBrand(dropId: string): Promise<string | null> {
  const d = await db()
  const [row] = await d
    .select({ brandId: dropRows.brandId })
    .from(dropRows)
    .innerJoin(brands, eq(brands.id, dropRows.brandId))
    .where(and(eq(dropRows.id, dropId), notInArray(dropRows.status, ["draft", "cancelled"]), brandListedSql()))
    .limit(1)
  return row?.brandId ?? null
}

/** The brand (and item ids) a signal is about, validated against the catalogue and the brands table. */
async function resolveTarget(input: SignalInput): Promise<{ brandId: string; productId: string | null; dropId: string | null }> {
  const d = await db()
  // Production refuses sample brand ids by identity, whatever the brands table holds.
  const brandExists = async (id: string | undefined) => !!id && !refusedSampleBrand(id) && !!(await d.query.brands.findFirst({ columns: { id: true }, where: (b, { eq }) => eq(b.id, id) }))
  switch (input.kind) {
    case "product_view":
    case "wishlist_add":
    case "wishlist_remove": {
      refuseSampleProduct(input.productId, "productId")
      const p = input.productId && !sampleOff() ? productById.get(input.productId) : undefined
      if (p) return { brandId: p.brandId, productId: p.id, dropId: null }
      const brandId = typeof input.productId === "string" && input.productId ? await catalogueProductBrand(input.productId) : null
      if (!brandId) throw badRequest({ productId: "Name a product in the catalogue." })
      return { brandId, productId: input.productId!, dropId: null }
    }
    case "reminder_set":
    case "reminder_unset": {
      refuseSampleDrop(input.dropId, "dropId")
      const drop = input.dropId && !sampleOff() ? dropById(input.dropId) : undefined
      if (drop) return { brandId: drop.brandId, productId: null, dropId: drop.id }
      const brandId = typeof input.dropId === "string" && input.dropId ? await catalogueDropBrand(input.dropId) : null
      if (!brandId) throw badRequest({ dropId: "Name a drop in the catalogue." })
      return { brandId, productId: null, dropId: input.dropId! }
    }
    case "post_open": {
      if (input.postId) {
        const post = await d.query.socialPosts.findFirst({
          columns: { brandId: true },
          where: (p, { and, eq }) => and(eq(p.id, input.postId!), eq(p.visibility, "published"), eq(p.moderationStatus, "ok")),
        })
        if (!post || (input.brandId && input.brandId !== post.brandId)) throw badRequest({ postId: "Name a published post." })
        return { brandId: post.brandId, productId: null, dropId: null }
      }
      if (!(await brandExists(input.brandId))) throw badRequest({ brandId: "Name a brand on Yard." })
      return { brandId: input.brandId!, productId: null, dropId: null }
    }
    case "follow":
    case "unfollow":
    case "storefront_view": {
      if (!(await brandExists(input.brandId))) throw badRequest({ brandId: "Name a brand on Yard." })
      return { brandId: input.brandId!, productId: null, dropId: null }
    }
    default:
      throw badRequest({ kind: "This kind of signal isn't accepted." })
  }
}

/** Applies a follow/wishlist/reminder state change; true when something actually changed. */
async function applyState(kind: string, userId: string, t: { brandId: string; productId: string | null; dropId: string | null }) {
  const d = await db()
  switch (kind) {
    case "follow":
      return (await d.insert(shopperFollows).values({ userId, brandId: t.brandId }).onConflictDoNothing().returning({ u: shopperFollows.userId })).length > 0
    case "unfollow":
      return (await d.delete(shopperFollows).where(and(eq(shopperFollows.userId, userId), eq(shopperFollows.brandId, t.brandId))).returning({ u: shopperFollows.userId })).length > 0
    case "wishlist_add":
      return (await d.insert(shopperWishlist).values({ userId, productId: t.productId!, brandId: t.brandId }).onConflictDoNothing().returning({ u: shopperWishlist.userId })).length > 0
    case "wishlist_remove":
      return (await d.delete(shopperWishlist).where(and(eq(shopperWishlist.userId, userId), eq(shopperWishlist.productId, t.productId!))).returning({ u: shopperWishlist.userId })).length > 0
    case "reminder_set":
      return (await d.insert(shopperReminders).values({ userId, dropId: t.dropId!, brandId: t.brandId }).onConflictDoNothing().returning({ u: shopperReminders.userId })).length > 0
    case "reminder_unset":
      return (await d.delete(shopperReminders).where(and(eq(shopperReminders.userId, userId), eq(shopperReminders.dropId, t.dropId!))).returning({ u: shopperReminders.userId })).length > 0
  }
  return false
}

/**
 * The verdict of the event that set the state a reversal now undoes (the actor's follow behind an
 * unfollow, …), or null when the state wasn't set through ingest. Replays the actor's events for
 * that target in order: a deduped event changed nothing; any other one flipped the state.
 */
async function settingVerdict(kind: string, actorId: string, t: { brandId: string; productId: string | null; dropId: string | null }): Promise<SignalVerdict | null> {
  const setKind = REVERSES[kind]
  if (!setKind) return null
  const d = await db()
  const rows = await d
    .select({ kind: chartEvents.kind, verdict: chartEvents.verdict })
    .from(chartEvents)
    .where(
      and(
        eq(chartEvents.actorId, actorId),
        inArray(chartEvents.kind, [setKind, kind]),
        eq(chartEvents.brandId, t.brandId),
        t.productId ? eq(chartEvents.productId, t.productId) : undefined,
        t.dropId ? eq(chartEvents.dropId, t.dropId) : undefined,
      ),
    )
    .orderBy(asc(chartEvents.seq))
  let on = false
  let by: SignalVerdict | null = null
  for (const r of rows) {
    if (r.verdict === "deduped") continue
    if (r.kind === setKind && !on) {
      on = true
      by = r.verdict as SignalVerdict
    } else if (r.kind === kind && on) {
      on = false
      by = null
    }
  }
  return on ? by : null
}

/** IP unknown: ANON_CAP_UNKNOWN_IP or more other anonymous actors already counted for this brand today. */
async function overAnonCap(brandId: string, day: string, actorId: string) {
  const d = await db()
  const [row] = await d
    .select({ n: countDistinct(chartEvents.actorId) })
    .from(chartEvents)
    .where(and(eq(chartEvents.brandId, brandId), eq(chartEvents.day, day), eq(chartEvents.verdict, "counted"), eq(chartEvents.actorKind, "anon"), isNull(chartEvents.ipHash), ne(chartEvents.actorId, actorId)))
  return (row?.n ?? 0) >= ANON_CAP_UNKNOWN_IP
}

/** More than IP_CAP distinct counted actors from one ip_hash for one brand and day (excluding this actor). */
async function overIpCap(ipHash: string, brandId: string, day: string, actorId: string) {
  const d = await db()
  const [row] = await d
    .select({ n: countDistinct(chartEvents.actorId) })
    .from(chartEvents)
    .where(and(eq(chartEvents.ipHash, ipHash), eq(chartEvents.brandId, brandId), eq(chartEvents.day, day), eq(chartEvents.verdict, "counted"), ne(chartEvents.actorId, actorId)))
  return (row?.n ?? 0) >= IP_CAP
}

export async function ingestSignal(input: SignalInput, who: SignalActor): Promise<SignalVerdict> {
  return (await ingestSignalDetailed(input, who)).verdict
}

/** As ingestSignal, with the stored event's seq (the dev endpoint and tests). */
export async function ingestSignalDetailed(input: SignalInput, who: SignalActor): Promise<{ verdict: SignalVerdict; seq: number; brandId: string }> {
  const target = await resolveTarget(input)
  const day = new Date().toISOString().slice(0, 10)
  return withTx(async () => {
    const d = await db()
    const isState = STATE_KINDS.has(input.kind)
    // State first: it's the shopper's own follow/wishlist/reminder list, whatever the verdict.
    const changed = isState && who.actorKind === "shopper" ? await applyState(input.kind, who.actorId, target) : false

    let verdict: SignalVerdict = "counted"
    if (who.actorKind === "shopper") {
      const member = await d.query.brandMembers.findFirst({ columns: { id: true }, where: (m, { and, eq }) => and(eq(m.userId, who.actorId), eq(m.brandId, target.brandId)) })
      if (member) verdict = "excluded_self"
      else if (who.status === "restricted" || who.status === "suspended") verdict = "excluded_restricted"
    }
    if (verdict === "counted" && isState && !changed) verdict = "deduped"
    if (verdict === "counted" && changed && REVERSES[input.kind]) {
      // Undoing a follow/wishlist/reminder counts only if setting it did.
      const by = await settingVerdict(input.kind, who.actorId, target)
      if (by !== "counted") verdict = by && by.startsWith("excluded_") ? by : "deduped"
    }
    if (verdict === "counted" && who.actorKind === "anon" && !who.anonEstablished) verdict = "excluded_anon"
    if (verdict === "counted" && who.actorKind === "anon" && !who.ipHash && (await overAnonCap(target.brandId, day, who.actorId))) {
      verdict = "excluded_fraud"
      await recordAbuse(`signal_anon_cap:${target.brandId}:${day}`, { kind: "anon", id: null, ipHash: null }, "signal", "signal_anon", { brandId: target.brandId, kind: input.kind, cap: ANON_CAP_UNKNOWN_IP, reason: "unknown_ip_cap" })
    }
    // A reversal whose setting event counted always counts: excluding it would keep a follow the brand lost.
    if (verdict === "counted" && who.ipHash && !REVERSES[input.kind] && (await overIpCap(who.ipHash, target.brandId, day, who.actorId))) {
      verdict = "excluded_fraud"
      await recordAbuse(`signal_ip_cap:${who.ipHash}:${target.brandId}`, { kind: who.actorKind, id: who.actorId, ipHash: who.ipHash }, "signal", "signal_ip_cap", { brandId: target.brandId, kind: input.kind, cap: IP_CAP })
    }

    const values = {
      brandId: target.brandId,
      productId: target.productId,
      dropId: target.dropId,
      kind: input.kind,
      actorKind: who.actorKind,
      actorId: who.actorId,
      accountAgeDays: who.accountAgeDays,
      ipHash: who.ipHash,
      uaHash: who.uaHash,
      day,
    }
    if (verdict === "counted" && !isState) {
      // Views and opens: one counted row per actor, item, kind and day (the partial unique index).
      const [row] = await d
        .insert(chartEvents)
        .values({ ...values, verdict: "counted" })
        .onConflictDoNothing()
        .returning({ seq: chartEvents.seq })
      if (row) return { verdict, seq: row.seq, brandId: target.brandId }
      verdict = "deduped"
    }
    const [row] = await d
      .insert(chartEvents)
      .values({ ...values, verdict })
      .returning({ seq: chartEvents.seq })
    // Repeated state toggles and cookieless anonymous signals leave a trace for Admin › Abuse (at most one row per key per minute).
    if (verdict === "deduped" && isState && !changed) await recordAbuse(`signal_dedupe:${who.actorId}`, { kind: who.actorKind, id: who.actorId, ipHash: who.ipHash }, "signal", "signal_dedupe", { brandId: target.brandId, kind: input.kind })
    if (verdict === "excluded_anon") await recordAbuse(`signal_anon:${who.ipHash ?? "unknown"}`, { kind: "anon", id: null, ipHash: who.ipHash }, "signal", "signal_anon", { brandId: target.brandId, kind: input.kind })
    return { verdict, seq: row.seq, brandId: target.brandId }
  })
}

/** Days since the account was created (chart_events.account_age_days). */
export function accountAgeDays(createdAt: Date) {
  return Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86_400_000))
}

