import "server-only"
import { and, asc, desc, eq, inArray, isNotNull, lt, ne, sql } from "drizzle-orm"
import { countryTimeZone } from "@/lib/data/zones"
import { CLAIM_LINK_DAYS, type FoundingBrandRow, type FoundingCreateBody, type FoundingPatchBody, type FoundingStatus } from "@/lib/api/contracts/founding"
import { writeAudit } from "../audit"
import { requestScope, type AdminActor } from "../auth/dal"
import { authLinks } from "../auth/auth-env"
import { AUTH_EMAIL_TEMPLATES, findUserByEmail, normalizeEmail, sendAuthEmail, type RequestMeta } from "../auth/identity"
import { requireRecentReauth } from "../auth/reauth"
import { createSession, endCurrentSession, endSession } from "../auth/session"
import { recordSessionAuth } from "../auth/session-auth"
import { memo } from "../cache"
import { db, withTx, type Executor } from "../db"
import { adminMembers, brandMembers, brands, sessions, users } from "../db/schema"
import { catalogCategories, catalogProducts, storefrontDrafts, storefrontVersions } from "../db/schema/catalog"
import { brandInvites, sessionAuth } from "../db/schema/identity"
import { brandPayoutAccounts } from "../db/schema/ledger"
import { badRequest, conflict, notFound, rateLimited, rule } from "../http/errors"
import { newId } from "../ids"
import { keys } from "../security/keys"
import { hmacB64url, sha256hex } from "../security/crypto"
import { dailyHit, hit } from "../security/rate-limit"
import { createStarterShipping } from "../shipping/profile"
import { catalogChanged } from "./hooks"
import { handleStatus, type HandleStatus } from "./onboarding"
import { brandForSaleSql } from "./sellable"
import { DEFAULT_STOREFRONT } from "./storefront"
import { assertBrandImages, slugify } from "./studio"

/**
 * Founding brands (owner's launch plan): Yard creates the first real brands itself, sets them up
 * in Studio as "Yard setup", then sends each owner a single-use claim link (auth/claims.ts).
 *
 *  - A founding brand is an ordinary `brands` row: review_status 'verified', founding = true,
 *    claim_status 'unclaimed'. It is public once its storefront is published (launched_at) and
 *    never for sale until claimed AND it has a payout account (sellable.ts brandForSaleSql).
 *  - Yard setup is a temporary brand_members row (role yard_setup) plus a brand session that only
 *    openSetupSession creates (session_auth method yard_setup, 8 h). The DAL re-checks the admin's
 *    brands.founding permission and the unclaimed state on every request, and route() limits it
 *    to catalogue, storefront, shipping and uploads. Claiming removes every yard_setup row.
 *  - The claim link reuses brand_invites (kind founding_claim, role owner, sha256 token, 7 days).
 *
 * Every write here is audited as the admin and needs the owner-only permission brands.founding
 * (the routes check it; nothing here trusts the caller).
 */

const SETUP_HOURS = 8
const HOME_TTL = 60_000

const handleMessages: Record<Exclude<HandleStatus, "available">, string> = {
  "too-short": "Use at least 3 characters.",
  "too-long": "Use 30 characters or fewer.",
  characters: "Use lowercase letters, numbers and hyphens.",
  hyphen: "Hyphens go between words, one at a time.",
  reserved: "That handle is reserved. Try another.",
  taken: "Another brand already uses that handle.",
}

const adminAudit = (a: AdminActor) => ({ kind: "admin" as const, id: a.userId, name: a.name, role: a.role })

/** Handle availability for the admin create form (the same rules as onboarding). */
export async function foundingHandleStatus(handle: string) {
  const status = await handleStatus(handle.trim().toLowerCase())
  return { handle: handle.trim().toLowerCase(), status, available: status === "available", message: status === "available" ? null : handleMessages[status] }
}

/** The storefront intro holds 600 characters; the story can be longer, so it's cut at a word. */
function introFrom(story: string | null | undefined) {
  const s = (story ?? "").trim()
  if (s.length <= 600) return s
  const cut = s.slice(0, 597)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 400)).trimEnd()}…`
}

async function loadFounding(d: Executor, brandId: string, lock = false) {
  const q = d.select().from(brands).where(and(eq(brands.id, brandId), eq(brands.founding, true)))
  const [b] = lock ? await q.for("update").limit(1) : await q.limit(1)
  if (!b) throw notFound("That founding brand doesn't exist.")
  return b
}

function assertUnclaimed(b: typeof brands.$inferSelect, what: string) {
  if (b.claimStatus !== "unclaimed") throw rule(`${b.name} has been claimed by its owner, so ${what} isn't possible any more.`)
}

function assertNotOnHold(b: typeof brands.$inferSelect) {
  if (b.reviewStatus === "suspended" || b.reviewStatus === "restricted") throw rule(`Yard has ${b.reviewStatus} ${b.name}. Reinstate it from Brands first.`)
}

/* ---------- Status and rows ---------- */

export function deriveFoundingStatus(b: { claimStatus: string; launchedAt: Date | null }, opts: { pendingLink: boolean; hasPayoutAccount: boolean }): FoundingStatus {
  if (b.claimStatus === "claimed") return opts.hasPayoutAccount && b.launchedAt ? "live" : "claimed"
  return opts.pendingLink ? "link_sent" : "setting_up"
}

const mediaRef = (id: string | null | undefined) => (id ? { mediaId: id, src: `/api/media/${encodeURIComponent(id)}?as=admin` } : null)

async function rowsFor(d: Executor, list: (typeof brands.$inferSelect)[]): Promise<FoundingBrandRow[]> {
  if (!list.length) return []
  const ids = list.map((b) => b.id)
  const [links, payout, live, drafts, counts, claimers] = await Promise.all([
    d
      .select()
      .from(brandInvites)
      .where(and(inArray(brandInvites.brandId, ids), eq(brandInvites.kind, "founding_claim"), eq(brandInvites.status, "pending")))
      .orderBy(desc(brandInvites.createdAt)),
    d.select({ brandId: brandPayoutAccounts.brandId }).from(brandPayoutAccounts).where(inArray(brandPayoutAccounts.brandId, ids)),
    d.selectDistinct({ brandId: storefrontVersions.brandId }).from(storefrontVersions).where(inArray(storefrontVersions.brandId, ids)),
    d.select({ brandId: storefrontDrafts.brandId, config: storefrontDrafts.config }).from(storefrontDrafts).where(inArray(storefrontDrafts.brandId, ids)),
    d
      .select({ brandId: catalogProducts.brandId, total: sql<number>`count(*)`.mapWith(Number), published: sql<number>`count(*) filter (where ${catalogProducts.status} = 'published')`.mapWith(Number) })
      .from(catalogProducts)
      .where(and(inArray(catalogProducts.brandId, ids), ne(catalogProducts.status, "archived")))
      .groupBy(catalogProducts.brandId),
    d
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, list.map((b) => b.claimedBy).filter((x): x is string => !!x).concat("-"))),
  ])
  const now = Date.now()
  return list.map((b) => {
    const link = links.find((l) => l.brandId === b.id) ?? null
    const pendingLive = !!link && link.expiresAt.getTime() > now
    const hasPayoutAccount = payout.some((p) => p.brandId === b.id)
    const draft = drafts.find((x) => x.brandId === b.id)
    const cover = typeof draft?.config.coverMediaId === "string" ? draft.config.coverMediaId : null
    const c = counts.find((x) => x.brandId === b.id)
    const claimer = claimers.find((u) => u.id === b.claimedBy)
    return {
      id: b.id,
      handle: b.handle,
      name: b.name,
      city: b.city,
      country: b.country,
      currency: b.currency,
      category: b.categories[0] ?? null,
      story: b.story,
      instagram: b.instagram,
      tiktok: b.tiktok,
      logo: mediaRef(b.logoMediaId),
      banner: mediaRef(cover),
      foundingBadge: b.foundingBadge,
      reviewStatus: b.reviewStatus,
      claimStatus: b.claimStatus === "claimed" ? "claimed" : "unclaimed",
      status: deriveFoundingStatus(b, { pendingLink: pendingLive, hasPayoutAccount }),
      createdAt: b.joinedAt,
      launchedAt: b.launchedAt?.toISOString() ?? null,
      claimedAt: b.claimedAt?.toISOString() ?? null,
      claimedBy: claimer ? { id: claimer.id, name: claimer.name } : null,
      hasPayoutAccount,
      storefrontPublished: live.some((v) => v.brandId === b.id),
      products: { total: c?.total ?? 0, published: c?.published ?? 0 },
      claimLink: link ? { id: link.id, email: link.email, status: pendingLive ? "pending" : "expired", createdAt: link.createdAt.toISOString(), expiresAt: link.expiresAt.toISOString() } : null,
    }
  })
}

/** Admin list, newest first, keyset paged by brand id (ids sort by time). */
export async function listFoundingBrands(input: { cursor?: string; limit?: number }) {
  const limit = Math.min(100, Math.max(1, input.limit ?? 50))
  const d = await db()
  const list = await d
    .select()
    .from(brands)
    .where(and(eq(brands.founding, true), input.cursor ? lt(brands.id, input.cursor) : undefined))
    .orderBy(desc(brands.id))
    .limit(limit + 1)
  const page = list.slice(0, limit)
  return { items: await rowsFor(d, page), nextCursor: list.length > limit ? page[page.length - 1].id : null }
}

export async function getFoundingBrand(brandId: string) {
  const d = await db()
  const b = await loadFounding(d, brandId)
  const [row] = await rowsFor(d, [b])
  return { brand: row }
}

/* ---------- Create ---------- */

/**
 * Creates a founding brand: verified, founding, badge on, unclaimed; starter shipping (domestic,
 * handling 1–3 days); a storefront draft whose intro is the story. Idempotent per (admin, key): a
 * replay with the same handle returns the brand created first (200), a different one is 409.
 */
export async function createFoundingBrand(actor: AdminActor, body: FoundingCreateBody, ipHash: string | null): Promise<{ status: 200 | 201; brand: FoundingBrandRow }> {
  const d0 = await db()
  const replay = async () => {
    const [b] = await d0
      .select()
      .from(brands)
      .where(and(eq(brands.createdBy, actor.userId), eq(brands.creationKey, body.idempotencyKey)))
      .limit(1)
    if (!b) return null
    if (b.handle !== body.handle) throw conflict("This request key was already used for another brand. Reload and try again.")
    return { status: 200 as const, brand: (await rowsFor(d0, [b]))[0] }
  }
  const again = await replay()
  if (again) return again

  const fields: Record<string, string> = {}
  const h = await handleStatus(body.handle)
  if (h !== "available") fields.handle = handleMessages[h]
  const [cat] = await d0.select({ slug: catalogCategories.slug }).from(catalogCategories).where(eq(catalogCategories.slug, body.category)).limit(1)
  if (!cat) fields.category = "Choose one of Yard's categories."
  if (Object.keys(fields).length) throw badRequest(fields)

  try {
    const created = await withTx(async (tx) => {
      const id = newId("b")
      const now = new Date()
      const [b] = await tx
        .insert(brands)
        .values({
          id,
          handle: body.handle,
          name: body.name.trim(),
          city: body.city.trim(),
          citySlug: slugify(body.city),
          country: body.country,
          currency: body.currency,
          categories: [body.category],
          verified: false,
          reviewStatus: "verified",
          joinedAt: now.toISOString().slice(0, 10),
          followersBase: 0,
          timeZone: (countryTimeZone as Record<string, string>)[body.country] ?? "UTC",
          founding: true,
          foundingBadge: true,
          claimStatus: "unclaimed",
          story: body.story?.trim() || null,
          instagram: body.instagram || null,
          tiktok: body.tiktok || null,
          createdBy: actor.userId,
          creationKey: body.idempotencyKey,
        })
        .returning()
      await createStarterShipping(b, { handling: [1, 3], delivery: ["domestic"] })
      const config = { ...DEFAULT_STOREFRONT, intro: introFrom(b.story), mark: { text: b.name.replace(/[^A-Za-z0-9&]/g, "").slice(0, 2).toUpperCase() || "YD", style: "condensed" } }
      await tx.insert(storefrontDrafts).values({ brandId: id, config, revision: 1, baseVersion: 0, updatedBy: actor.userId })
      await writeAudit({ actor: adminAudit(actor), action: "founding.created", target: b.name, subjectType: "brand", subjectId: id, brandId: id, ipHash, meta: { handle: b.handle, country: b.country, currency: b.currency, category: body.category } })
      catalogChanged({ brands: [id] })
      return b
    })
    return { status: 201, brand: (await rowsFor(d0, [created]))[0] }
  } catch (e) {
    // A concurrent create with the same key or handle: answer as the winner left it.
    if ((e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") {
      const r = await replay()
      if (r) return r
      throw badRequest({ handle: handleMessages.taken })
    }
    throw e
  }
}

/* ---------- Update (profile, logo, banner, badge) ---------- */

export async function updateFoundingBrand(actor: AdminActor, brandId: string, body: FoundingPatchBody, ipHash: string | null) {
  return withTx(async (tx) => {
    const b = await loadFounding(tx, brandId, true)
    const profileKeys = (Object.keys(body) as (keyof FoundingPatchBody)[]).filter((k) => k !== "foundingBadge")
    if (profileKeys.length) {
      assertUnclaimed(b, "editing its profile from the Control Center")
      assertNotOnHold(b)
    }
    const patch: Partial<typeof brands.$inferInsert> = {}
    if (body.name !== undefined) patch.name = body.name.trim()
    if (body.city !== undefined) {
      patch.city = body.city.trim()
      patch.citySlug = slugify(body.city)
    }
    if (body.story !== undefined) patch.story = body.story?.trim() || null
    if (body.instagram !== undefined) patch.instagram = body.instagram || null
    if (body.tiktok !== undefined) patch.tiktok = body.tiktok || null
    if (body.foundingBadge !== undefined) patch.foundingBadge = body.foundingBadge
    if (body.logoMediaId) await assertBrandImages(tx, b.id, [body.logoMediaId], "logoMediaId")
    if (body.bannerMediaId) await assertBrandImages(tx, b.id, [body.bannerMediaId], "bannerMediaId")
    if (body.logoMediaId !== undefined) patch.logoMediaId = body.logoMediaId
    if (Object.keys(patch).length) await tx.update(brands).set(patch).where(eq(brands.id, b.id))
    if (body.bannerMediaId !== undefined || body.story !== undefined) {
      // The banner is the storefront cover; the story becomes the intro. Both land in the draft (live on publish).
      const [draft] = await tx.select().from(storefrontDrafts).where(eq(storefrontDrafts.brandId, b.id)).for("update").limit(1)
      const base = (draft?.config ?? { ...DEFAULT_STOREFRONT }) as Record<string, unknown>
      const config = { ...base }
      if (body.bannerMediaId !== undefined) {
        if (body.bannerMediaId) config.coverMediaId = body.bannerMediaId
        else delete config.coverMediaId
      }
      if (body.story !== undefined) config.intro = introFrom(body.story)
      if (draft) await tx.update(storefrontDrafts).set({ config, revision: draft.revision + 1, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(storefrontDrafts.brandId, b.id))
      else await tx.insert(storefrontDrafts).values({ brandId: b.id, config, revision: 1, baseVersion: 0, updatedBy: actor.userId })
    }
    const changed = Object.keys(body)
    await writeAudit({
      actor: adminAudit(actor),
      action: changed.length === 1 && body.foundingBadge !== undefined ? (body.foundingBadge ? "founding.badge_on" : "founding.badge_off") : "founding.updated",
      target: b.name,
      subjectType: "brand",
      subjectId: b.id,
      brandId: b.id,
      ipHash,
      meta: { fields: changed },
    })
    // A rename or move changes the brand's search rows (and its products' brand name).
    catalogChanged(body.name !== undefined || body.city !== undefined ? { reindexBrands: [b.id] } : { brands: [b.id] })
    const [fresh] = await tx.select().from(brands).where(eq(brands.id, b.id)).limit(1)
    return { brand: (await rowsFor(tx, [fresh]))[0] }
  })
}

/* ---------- Yard setup sessions ---------- */

/**
 * Opens Studio on an unclaimed founding brand as Yard setup: a yard_setup membership for this
 * admin and a brand session (method yard_setup, 8 h absolute) that replaces this browser's brand
 * session. Sign-in, demo sign-in and brand switch can never reach the brand this way
 * (identity.ts brandForUser skips yard_setup rows); only this route does.
 */
export async function openSetupSession(actor: AdminActor, brandId: string, meta: RequestMeta) {
  return withTx(async (tx) => {
    const b = await loadFounding(tx, brandId, true)
    assertUnclaimed(b, "Yard setup")
    assertNotOnHold(b)
    const [existing] = await tx
      .select()
      .from(brandMembers)
      .where(and(eq(brandMembers.brandId, b.id), eq(brandMembers.userId, actor.userId)))
      .limit(1)
    if (existing && existing.role !== "yard_setup") throw rule("You're already on this brand's team. Use Studio sign-in instead.")
    if (!existing) await tx.insert(brandMembers).values({ id: newId("tm"), brandId: b.id, userId: actor.userId, role: "yard_setup", status: "active", grantedBy: actor.userId })
    else await tx.update(brandMembers).set({ status: "active", grantedBy: actor.userId }).where(eq(brandMembers.id, existing.id))
    const previous = await endCurrentSession("brand", "replaced")
    const row = await createSession("brand", actor.userId, b.id, { userAgent: meta.userAgent, ipHash: meta.ipHash }, { absoluteMs: SETUP_HOURS * 3600_000 })
    await recordSessionAuth({ sessionId: row.id, userId: actor.userId, method: "yard_setup" })
    await writeAudit({ actor: adminAudit(actor), action: "founding.setup_opened", target: b.name, subjectType: "brand", subjectId: b.id, brandId: b.id, ipHash: meta.ipHash, meta: { session: row.id, replacedSession: previous?.id ?? null, hours: SETUP_HOURS } })
    return { brandId: b.id, handle: b.handle, expiresAt: row.absoluteExpiresAt.toISOString(), studioUrl: "/studio" }
  })
}

/** Ends this admin's Yard setup on a brand: their setup sessions and their yard_setup membership. */
export async function endSetupSession(actor: AdminActor, brandId: string, meta: RequestMeta) {
  return withTx(async (tx) => {
    const b = await loadFounding(tx, brandId)
    const mine = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .innerJoin(sessionAuth, eq(sessionAuth.sessionId, sessions.id))
      .where(and(eq(sessions.userId, actor.userId), eq(sessions.actor, "brand"), eq(sessions.activeBrandId, b.id), eq(sessionAuth.method, "yard_setup")))
    for (const s of mine) await endSession(s.id, "setup_ended")
    const gone = await tx
      .delete(brandMembers)
      .where(and(eq(brandMembers.brandId, b.id), eq(brandMembers.userId, actor.userId), eq(brandMembers.role, "yard_setup")))
      .returning({ id: brandMembers.id })
    if (gone.length || mine.length) await writeAudit({ actor: adminAudit(actor), action: "founding.setup_ended", target: b.name, subjectType: "brand", subjectId: b.id, brandId: b.id, ipHash: meta.ipHash, meta: { sessions: mine.length } })
    return { ended: mine.length, removed: gone.length > 0 }
  })
}

/* ---------- Claim links ---------- */

/**
 * Issues (or re-issues) the claim link for an unclaimed founding brand, bound to `email`. Any
 * earlier pending link stops working. The token is derived from the admin's idempotency key, so a
 * retry of the same action returns the same link without a second email; a new key (re-send)
 * mints a new one. The URL is returned to copy; only its sha256 is stored. Re-auth ≤ 10 min,
 * 10 an hour and 30 a day per brand.
 */
export async function issueClaimLink(actor: AdminActor, brandId: string, input: { email: string; idempotencyKey: string }, meta: RequestMeta) {
  await requireRecentReauth(actor, 600)
  const email = normalizeEmail(input.email)
  const token = hmacB64url(keys().session, `yard/founding-claim/v1|${brandId}|${actor.userId}|${input.idempotencyKey}|${email}`)
  const tokenHash = sha256hex(token)
  const d0 = await db()
  const [prior] = await d0.select().from(brandInvites).where(eq(brandInvites.tokenHash, tokenHash)).limit(1)
  if (prior) {
    if (prior.brandId !== brandId || prior.kind !== "founding_claim") throw conflict("This request key was already used. Reload and try again.")
    if (prior.status !== "pending" || prior.expiresAt.getTime() <= Date.now()) throw conflict("That link was already used, revoked or has expired. Generate a new one.")
    return { created: false, url: authLinks.claim(token), link: linkDto(prior) }
  }
  const r = hit(`founding.claim_link:${brandId}`, 10, 3600)
  if (!r.ok) throw rateLimited(r.retryAfter, "You've sent this brand a lot of links this hour. Try again later.")
  const day = await dailyHit(`founding.claim_link:day:${brandId}`, 30)
  if (!day.ok) throw rateLimited(day.retryAfter, "You've sent this brand a lot of links today. Try again tomorrow.")
  const user = await findUserByEmail(email)
  if (user?.demo) throw rule("This email belongs to a demo account. Use the owner's real email address.")
  if (user) {
    const [am] = await d0.select({ id: adminMembers.userId }).from(adminMembers).where(eq(adminMembers.userId, user.id)).limit(1)
    if (am) throw rule("This email belongs to a Yard admin account. Use the brand owner's own email address.")
    if (user.status === "suspended") throw rule("This email belongs to a suspended account.")
  }
  return withTx(async (tx) => {
    const b = await loadFounding(tx, brandId, true)
    assertUnclaimed(b, "sending a claim link")
    // Restricted brands are on hold too: the claim page would refuse the link (auth/claims.ts).
    assertNotOnHold(b)
    const now = new Date()
    const revoked = await tx
      .update(brandInvites)
      .set({ status: "revoked", revokedAt: now, revokedBy: actor.userId })
      .where(and(eq(brandInvites.brandId, b.id), eq(brandInvites.kind, "founding_claim"), eq(brandInvites.status, "pending")))
      .returning({ id: brandInvites.id })
    const expiresAt = new Date(now.getTime() + CLAIM_LINK_DAYS * 86_400_000)
    const [row] = await tx
      .insert(brandInvites)
      .values({ id: newId("inv"), brandId: b.id, email, role: "owner", kind: "founding_claim", tokenHash, status: "pending", invitedBy: actor.userId, expiresAt })
      .returning()
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.foundingClaim, email, { brand: b.name, handle: b.handle, url: authLinks.claim(token), expiresDays: CLAIM_LINK_DAYS }, `founding-claim:${row.id}`)
    await writeAudit({ actor: adminAudit(actor), action: "founding.claim_link_issued", target: email, subjectType: "brand_invite", subjectId: row.id, brandId: b.id, ipHash: meta.ipHash, meta: { replaced: revoked.map((x) => x.id), expiresDays: CLAIM_LINK_DAYS } })
    return { created: true, url: authLinks.claim(token), link: linkDto(row) }
  })
}

function linkDto(r: typeof brandInvites.$inferSelect) {
  const expired = r.status === "pending" && r.expiresAt.getTime() <= Date.now()
  return { id: r.id, email: r.email, status: expired ? "expired" : r.status, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() }
}

/** Revokes the brand's pending claim link (404 when there is none). */
export async function revokeClaimLink(actor: AdminActor, brandId: string, meta: RequestMeta) {
  return withTx(async (tx) => {
    const b = await loadFounding(tx, brandId)
    const [row] = await tx
      .update(brandInvites)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy: actor.userId })
      .where(and(eq(brandInvites.brandId, b.id), eq(brandInvites.kind, "founding_claim"), eq(brandInvites.status, "pending")))
      .returning()
    if (!row) throw notFound("There's no pending claim link for this brand.")
    await writeAudit({ actor: adminAudit(actor), action: "founding.claim_link_revoked", target: row.email, subjectType: "brand_invite", subjectId: row.id, brandId: b.id, ipHash: meta.ipHash })
    return { link: linkDto(row) }
  })
}

/* ---------- Home page ---------- */

export type FoundingHomeBrand = {
  id: string
  handle: string
  name: string
  city: string
  country: string
  story: string | null
  logoSrc: string | null
  coverSrc: string | null
  foundingBadge: boolean
  forSale: boolean
}

/**
 * The home page "Founding brands" section: founding brands with a published storefront, of
 * listed brands, newest launch first. Memoised 60 s (catalog: prefix, so catalog writes drop it).
 * Only public media: the logo and the live cover are public once the brand has launched.
 */
export async function listFoundingBrandsForHome(limit = 12): Promise<FoundingHomeBrand[]> {
  await requestScope()
  return memo(`catalog:founding:home:${limit}`, HOME_TTL, async () => {
    const d = await db()
    const rows = await d
      .select({
        id: brands.id,
        handle: brands.handle,
        name: brands.name,
        city: brands.city,
        country: brands.country,
        story: brands.story,
        logoMediaId: brands.logoMediaId,
        foundingBadge: brands.foundingBadge,
        forSale: sql<boolean>`${brandForSaleSql()}`,
        // Qualified by hand: inside a select, drizzle may print a column without its table, and a bare
        // "id" here would resolve to the subquery's own sv.id (so no cover was ever found).
        cover: sql<string | null>`(select sv.config ->> 'coverMediaId' from catalog_storefront_versions sv where sv.brand_id = "brands"."id" order by sv.version desc limit 1)`,
      })
      .from(brands)
      .where(and(eq(brands.founding, true), isNotNull(brands.launchedAt), sql`${brands.reviewStatus} not in ('restricted', 'suspended')`))
      .orderBy(desc(brands.launchedAt), asc(brands.id))
      .limit(Math.min(48, Math.max(1, limit)))
    return rows.map((r) => ({
      id: r.id,
      handle: r.handle,
      name: r.name,
      city: r.city,
      country: r.country,
      story: r.story ? (r.story.length > 160 ? `${r.story.slice(0, 157).trimEnd()}…` : r.story) : null,
      logoSrc: r.logoMediaId ? `/api/media/${encodeURIComponent(r.logoMediaId)}` : null,
      coverSrc: r.cover ? `/api/media/${encodeURIComponent(r.cover)}` : null,
      foundingBadge: r.foundingBadge,
      forSale: !!r.forSale,
    }))
  })
}
