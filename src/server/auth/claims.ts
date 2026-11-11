import "server-only"
import { and, eq } from "drizzle-orm"
import { SELLER_AGREEMENT_VERSION, type ClaimAcceptBody } from "@/lib/api/contracts/founding"
import { writeAudit } from "../audit"
import { catalogChanged } from "../catalog/hooks"
import { db, withTx } from "../db"
import { adminMembers, brandMembers, brands, users } from "../db/schema"
import { brandInvites } from "../db/schema/identity"
import { HttpError, badRequest, conflict, notFound } from "../http/errors"
import { newId } from "../ids"
import { notifyAdmins } from "../notify"
import { sha256hex } from "../security/crypto"
import { hit } from "../security/rate-limit"
import type { ShopperActor } from "./dal"
import { credentialsOf, deletionPending, findUserByEmail, normalizeEmail, openSession, upsertCredentials, userById, type RequestMeta } from "./identity"
import { maskEmail } from "./invites"
import { limitTokenConsume } from "./limits"
import { hashPassword, passwordProblem } from "./passwords"
import { endBrandSessions } from "./session"

/**
 * Claiming a founding brand (v3). Yard emails the owner a single-use link (catalog/founding.ts
 * issueClaimLink, a brand_invites row of kind founding_claim, role owner). /auth/claim POSTs the
 * token here: preview, then accept. Accepting proves the email, records the seller agreement,
 * makes the claimant the brand's OWNER, removes every Yard setup membership and ends those
 * sessions, marks the brand claimed and opens a brand session on it. Selling turns on only once
 * the owner adds a payout account (catalog/sellable.ts brandForSaleSql).
 *
 * Refusals are distinct so the page can say what happened: unknown 404, expired 410, used 409,
 * revoked 410, brand on hold 403. Every refusal of a real link is audited; attempts are rate
 * limited per IP and per link.
 */

export const CLAIM_REDIRECT = "/studio/settings#payouts"

type Row = { invite: typeof brandInvites.$inferSelect; brand: typeof brands.$inferSelect }

async function claimByToken(token: string): Promise<Row | null> {
  if (!/^[\w-]{40,64}$/.test(token)) return null
  const d = await db()
  const [row] = await d
    .select({ invite: brandInvites, brand: brands })
    .from(brandInvites)
    .innerJoin(brands, eq(brands.id, brandInvites.brandId))
    .where(and(eq(brandInvites.tokenHash, sha256hex(token)), eq(brandInvites.kind, "founding_claim")))
    .limit(1)
  return row ?? null
}

/** The refusal for a link, or null when it can be claimed. */
function refusalOf(row: Row | null): HttpError | null {
  if (!row) return new HttpError(404, "not_found", "This claim link isn't valid. Check you opened the whole link from the email.", { link: "invalid" })
  const { invite, brand } = row
  if (invite.status === "accepted" || brand.claimStatus === "claimed") return new HttpError(409, "conflict", `${brand.name} has already been claimed with this link. Sign in to Studio to manage it.`, { link: "used" })
  if (invite.status === "revoked") return new HttpError(410, "gone", "This claim link was replaced or cancelled by Yard. Use the newest link Yard sent you, or ask Yard for a new one.", { link: "revoked" })
  if (invite.status === "expired" || invite.expiresAt.getTime() <= Date.now()) return new HttpError(410, "gone", "This claim link has expired. Ask Yard to send you a new one.", { link: "expired" })
  if (brand.reviewStatus === "suspended" || brand.reviewStatus === "restricted") return new HttpError(403, "forbidden", `${brand.name} is on hold with Yard. Contact Yard support.`, { link: "on_hold" })
  if (!brand.founding || brand.claimStatus !== "unclaimed") return new HttpError(409, "conflict", "This brand can't be claimed. Contact Yard support.", { link: "used" })
  return null
}

/** Per-link attempts: 10 per 10 minutes, whoever tries (a stolen link can't be hammered from many IPs). */
function limitLink(token: string) {
  const r = hit(`auth.claim:link:${sha256hex(token).slice(0, 24)}`, 10, 600)
  if (!r.ok) throw new HttpError(429, "rate_limited", "Too many attempts on this link. Try again in a few minutes.", undefined, r.retryAfter)
}

async function isAdminAccount(userId: string) {
  const d = await db()
  const [m] = await d.select({ id: adminMembers.userId }).from(adminMembers).where(eq(adminMembers.userId, userId)).limit(1)
  return !!m
}

/** Public preview for /auth/claim (POST, never GET: the token stays out of logs and history). */
export async function previewClaim(token: string, shopper: ShopperActor | null, meta: RequestMeta) {
  await limitTokenConsume("claim-preview", meta.ipHash)
  limitLink(token)
  const row = await claimByToken(token)
  const refusal = refusalOf(row)
  if (refusal) throw refusal
  const { invite, brand } = row!
  const user = await findUserByEmail(invite.email)
  return {
    brand: { id: brand.id, name: brand.name, handle: brand.handle, city: brand.city, country: brand.country },
    email: maskEmail(invite.email),
    /** True: sign in first with this email (as a shopper). False: create the account on the page. */
    hasAccount: !!user && !user.demo,
    /** The signed-in shopper is the invited account (accept needs no password). */
    signedInMatches: !!user && !!shopper && shopper.userId === user.id,
    expiresAt: invite.expiresAt.toISOString(),
    agreementVersion: SELLER_AGREEMENT_VERSION,
    agreementUrl: "/legal/seller-agreement",
  }
}

/**
 * Accepts a claim. Either the caller is signed in (shopper session) as the account whose email
 * the link names, or no account has that email and name + password create one (the emailed link
 * proves the address). Demo and Yard admin accounts can't claim.
 */
export async function acceptClaim(input: ClaimAcceptBody, shopper: ShopperActor | null, meta: RequestMeta) {
  await limitTokenConsume("claim-accept", meta.ipHash)
  limitLink(input.token)
  const row = await claimByToken(input.token)
  const refusal = refusalOf(row)
  if (refusal) {
    if (row)
      await writeAudit({ actor: { kind: shopper ? "shopper" : "system", id: shopper?.userId ?? null, name: shopper?.name ?? null }, action: "founding.claim_refused", target: row.brand.name, subjectType: "brand_invite", subjectId: row.invite.id, brandId: row.brand.id, ipHash: meta.ipHash, meta: { status: refusal.status, code: refusal.code } }).catch(() => {})
    throw refusal
  }
  const { invite, brand } = row!
  if (input.acceptAgreement !== true) throw badRequest({ acceptAgreement: "Accept the seller agreement to claim your store." })
  if (input.agreementVersion !== SELLER_AGREEMENT_VERSION) throw conflict("The seller agreement changed since you opened this page. Reload to read the latest version.")

  const existing = await findUserByEmail(invite.email)
  let hash: string | null = null
  if (existing?.demo) throw new HttpError(422, "rule", "This email belongs to a demo account. Ask Yard to send the link to a real email address.")
  if (existing && (await isAdminAccount(existing.id))) throw new HttpError(422, "rule", "Yard admin accounts can't own a brand. Ask Yard to send the link to the owner's own email.")
  if (existing) {
    if (!shopper || shopper.userId !== existing.id) {
      await writeAudit({ actor: { kind: shopper ? "shopper" : "system", id: shopper?.userId ?? null, name: shopper?.name ?? null }, action: "founding.claim_refused", target: brand.name, subjectType: "brand_invite", subjectId: invite.id, brandId: brand.id, ipHash: meta.ipHash, meta: { status: 401, code: shopper ? "wrong_account" : "sign_in_required" } }).catch(() => {})
      throw new HttpError(401, "unauthenticated", `Sign in with ${maskEmail(invite.email)} to claim ${brand.name}.`)
    }
    if (existing.status === "suspended") throw new HttpError(403, "suspended", "This account is suspended.")
    if (await deletionPending(existing.id)) throw notFound("This claim link isn't valid.")
  } else {
    const fields: Record<string, string> = {}
    if (!input.name?.trim()) fields.name = "Enter your name."
    if (!input.password) fields.password = "Choose a password."
    else {
      const problem = passwordProblem(input.password, invite.email)
      if (problem) fields.password = problem
    }
    if (Object.keys(fields).length) throw badRequest(fields)
    hash = await hashPassword(input.password!) // outside the transaction (scrypt)
  }

  const out = await withTx(async (tx) => {
    const now = new Date()
    // 1. The link, once (compare-and-set): two accepts can't both claim.
    const [claimed] = await tx
      .update(brandInvites)
      .set({ status: "accepted", acceptedAt: now, agreementVersion: SELLER_AGREEMENT_VERSION, agreementAcceptedAt: now })
      .where(and(eq(brandInvites.id, invite.id), eq(brandInvites.status, "pending")))
      .returning()
    if (!claimed) throw new HttpError(409, "conflict", `${brand.name} has already been claimed with this link.`)
    // 2. The brand, still unclaimed (locked).
    const [b] = await tx.select().from(brands).where(eq(brands.id, brand.id)).for("update").limit(1)
    if (!b || b.claimStatus !== "unclaimed") throw new HttpError(409, "conflict", `${brand.name} has already been claimed.`)
    if (b.reviewStatus === "suspended" || b.reviewStatus === "restricted") throw new HttpError(403, "forbidden", `${b.name} is on hold with Yard. Contact Yard support.`)
    // 3. The account (created here when none had this email; the emailed token proves the address).
    let userId = existing?.id ?? null
    if (!userId) {
      userId = newId("u")
      await tx.insert(users).values({ id: userId, kind: "brand_staff", name: input.name!.trim(), email: normalizeEmail(invite.email), status: "active", demo: false })
      await upsertCredentials(userId, { passwordHash: hash, passwordUpdatedAt: now })
    }
    const user = await userById(userId)
    if (!user || user.status === "suspended") throw new HttpError(403, "suspended", "This account is suspended.")
    const cred = await credentialsOf(user.id)
    if (!cred?.emailVerifiedAt) await upsertCredentials(user.id, { emailVerifiedAt: now })
    await tx.update(brandInvites).set({ acceptedBy: user.id }).where(eq(brandInvites.id, invite.id))
    // 4. Owner, claimed, agreement stored.
    await tx
      .update(brands)
      .set({ claimStatus: "claimed", claimedAt: now, claimedBy: user.id, sellerAgreementVersion: SELLER_AGREEMENT_VERSION, sellerAgreementAcceptedAt: now })
      .where(eq(brands.id, b.id))
    // 5. Yard setup ends: every yard_setup membership goes and every session on the brand ends
    //    (only Yard setup sessions can exist on an unclaimed brand).
    await tx.delete(brandMembers).where(and(eq(brandMembers.brandId, b.id), eq(brandMembers.role, "yard_setup")))
    const ended = await endBrandSessions(b.id, "brand_claimed")
    await tx
      .insert(brandMembers)
      .values({ id: newId("tm"), brandId: b.id, userId: user.id, role: "owner", status: "active" })
      .onConflictDoUpdate({ target: [brandMembers.brandId, brandMembers.userId], set: { role: "owner", status: "active", grantedBy: null } })
    // Any other pending claim link of this brand stops working.
    await tx
      .update(brandInvites)
      .set({ status: "revoked", revokedAt: now })
      .where(and(eq(brandInvites.brandId, b.id), eq(brandInvites.kind, "founding_claim"), eq(brandInvites.status, "pending")))
    await writeAudit({
      actor: { kind: "brand", id: user.id, name: user.name, role: "owner" },
      action: "founding.claimed",
      target: b.name,
      subjectType: "brand",
      subjectId: b.id,
      brandId: b.id,
      ipHash: meta.ipHash,
      meta: { invite: invite.id, agreementVersion: SELLER_AGREEMENT_VERSION, newAccount: !existing, setupSessionsEnded: ended },
    })
    await notifyAdmins("brands.founding", { key: `founding-claimed:${b.id}`, template: "founding.claimed", vars: { brand: b.name, owner: user.name }, href: `/admin/brands?tab=founding&brand=${b.id}` })
    catalogChanged({ brands: [b.id] })
    const session = await openSession({ actor: "brand", user, brandId: b.id, method: "claim", meta })
    return { profile: session.profile, brandId: b.id }
  })
  return { status: "signed_in" as const, actor: "brand" as const, profile: out.profile, brandId: out.brandId, redirect: CLAIM_REDIRECT }
}
