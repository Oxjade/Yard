import "server-only"
import { and, desc, eq, lt, sql } from "drizzle-orm"
import { teamRoleLabels, type TeamRole } from "@/lib/permissions"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { brandMembers, brands, users } from "../db/schema"
import { brandInvites } from "../db/schema/identity"
import { HttpError, badRequest, conflict, forbidden, notFound, rateLimited } from "../http/errors"
import { newId, randomToken } from "../ids"
import { sha256hex } from "../security/crypto"
import { hit } from "../security/rate-limit"
import { authLinks } from "./auth-env"
import type { BrandActor, ShopperActor } from "./dal"
import { AUTH_EMAIL_TEMPLATES, credentialsOf, deletionPending, findUserByEmail, normalizeEmail, openSession, sendAuthEmail, upsertCredentials, userById, type RequestMeta } from "./identity"
import { limitTokenConsume, LIMITS } from "./limits"
import { hashPassword, passwordProblem } from "./passwords"

/**
 * Brand team invites (v3). Owners and brand admins invite by email with a role from
 * src/lib/permissions.ts; the invitee accepts from the emailed link (POSTed by /auth/invite),
 * either signed in with the invited email or by creating an account there. Accepting proves the
 * email, adds an active brand_members row and opens a brand session on that brand.
 *
 * Who may invite which role: an owner any role; a brand admin any role except owner and admin.
 */
const INVITE_DAYS = 7

export type InviteDto = { id: string; email: string; role: TeamRole; roleLabel: string; status: string; invitedBy: string | null; createdAt: string; expiresAt: string }

const MANAGERS: TeamRole[] = ["owner", "admin"]

export function assertCanManageTeam(actor: BrandActor) {
  if (!MANAGERS.includes(actor.role)) throw forbidden("Only owners and admins can manage the team.")
}

export function assertCanGrant(actor: BrandActor, role: TeamRole) {
  assertCanManageTeam(actor)
  if (actor.role !== "owner" && (role === "owner" || role === "admin")) throw forbidden("Only an owner can invite owners and admins.")
}

const toDto = (r: typeof brandInvites.$inferSelect & { inviterName?: string | null }): InviteDto => ({
  id: r.id,
  email: r.email,
  role: r.role as TeamRole,
  roleLabel: teamRoleLabels[r.role as TeamRole],
  status: r.status === "pending" && r.expiresAt.getTime() <= Date.now() ? "expired" : r.status,
  invitedBy: r.inviterName ?? null,
  createdAt: r.createdAt.toISOString(),
  expiresAt: r.expiresAt.toISOString(),
})

export async function listInvites(actor: BrandActor) {
  const d = await db()
  const rows = await d
    .select({ invite: brandInvites, inviterName: users.name })
    .from(brandInvites)
    .leftJoin(users, eq(users.id, brandInvites.invitedBy))
    .where(eq(brandInvites.brandId, actor.brandId))
    .orderBy(desc(brandInvites.createdAt))
    .limit(200)
  return rows.map((r) => toDto({ ...r.invite, inviterName: r.inviterName }))
}

export async function createInvite(actor: BrandActor, input: { email: string; role: TeamRole }, meta: RequestMeta) {
  assertCanGrant(actor, input.role)
  const email = normalizeEmail(input.email)
  const r = hit(`auth.invite:brand:${actor.brandId}`, LIMITS.invitesPerBrandDay.limit, LIMITS.invitesPerBrandDay.windowSec)
  if (!r.ok) throw rateLimited(r.retryAfter, "You've sent a lot of invites today. Try again tomorrow.")
  const token = randomToken(32)
  return withTx(async (tx) => {
    const d = await db()
    // Already a member?
    const existingUser = await findUserByEmail(email)
    if (existingUser) {
      const [m] = await d
        .select()
        .from(brandMembers)
        .where(and(eq(brandMembers.brandId, actor.brandId), eq(brandMembers.userId, existingUser.id), eq(brandMembers.status, "active")))
        .limit(1)
      if (m) throw badRequest({ email: "This person is already on your team." })
    }
    // Expire stale pending invites, then refuse a second live one for the same email.
    await d
      .update(brandInvites)
      .set({ status: "expired" })
      .where(and(eq(brandInvites.brandId, actor.brandId), eq(brandInvites.status, "pending"), lt(brandInvites.expiresAt, new Date())))
    const [live] = await d
      .select({ id: brandInvites.id })
      .from(brandInvites)
      .where(and(eq(brandInvites.brandId, actor.brandId), eq(brandInvites.status, "pending"), sql`lower(${brandInvites.email}) = ${email}`))
      .limit(1)
    if (live) throw conflict("There's already a pending invite for this email. Revoke it to send a new one.")
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000)
    const [row] = await d
      .insert(brandInvites)
      .values({ id: newId("inv"), brandId: actor.brandId, email, role: input.role, tokenHash: sha256hex(token), status: "pending", invitedBy: actor.userId, expiresAt })
      .returning()
    await sendAuthEmail(tx, AUTH_EMAIL_TEMPLATES.brandInvite, email, { brand: actor.brand.name, role: teamRoleLabels[input.role], inviter: actor.name, url: authLinks.invite(token), expiresDays: INVITE_DAYS }, `invite:${row.id}`)
    await writeAudit({ actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role }, action: "team.invite_created", target: email, subjectType: "brand_invite", subjectId: row.id, brandId: actor.brandId, ipHash: meta.ipHash, meta: { role: input.role } })
    return toDto({ ...row, inviterName: actor.name })
  })
}

export async function revokeInvite(actor: BrandActor, inviteId: string, meta: RequestMeta) {
  assertCanManageTeam(actor)
  return withTx(async () => {
    const d = await db()
    const [row] = await d
      .select()
      .from(brandInvites)
      .where(and(eq(brandInvites.id, inviteId), eq(brandInvites.brandId, actor.brandId)))
      .limit(1)
    if (!row) throw notFound()
    if (row.status !== "pending") throw conflict(row.status === "accepted" ? "This invite was already accepted." : "This invite isn't pending any more.")
    assertCanGrant(actor, row.role as TeamRole)
    const [updated] = await d
      .update(brandInvites)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy: actor.userId })
      .where(and(eq(brandInvites.id, row.id), eq(brandInvites.status, "pending")))
      .returning()
    if (!updated) throw conflict("This invite changed. Reload and try again.")
    await writeAudit({ actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role }, action: "team.invite_revoked", target: row.email, subjectType: "brand_invite", subjectId: row.id, brandId: actor.brandId, ipHash: meta.ipHash, meta: { role: row.role } })
    return toDto(updated)
  })
}

async function inviteByToken(token: string) {
  if (!/^[\w-]{40,64}$/.test(token)) return null
  const d = await db()
  const [row] = await d
    .select({ invite: brandInvites, brandName: brands.name, brandHandle: brands.handle, brandStatus: brands.reviewStatus })
    .from(brandInvites)
    .innerJoin(brands, eq(brands.id, brandInvites.brandId))
    .where(eq(brandInvites.tokenHash, sha256hex(token)))
    .limit(1)
  return row ?? null
}

const maskEmail = (email: string) => {
  const [local, domain] = email.split("@")
  return `${local.slice(0, 1)}${"•".repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`
}

/** Public preview for the /auth/invite page. Unknown, used, revoked and expired invites all read as "no longer valid". */
export async function previewInvite(token: string, meta: RequestMeta) {
  await limitTokenConsume("invite-preview", meta.ipHash)
  const row = await inviteByToken(token)
  if (!row || row.invite.status !== "pending" || row.invite.expiresAt.getTime() <= Date.now() || row.brandStatus === "suspended") throw notFound("This invite is no longer valid. Ask the brand to send a new one.")
  const user = await findUserByEmail(row.invite.email)
  return {
    brand: { name: row.brandName, handle: row.brandHandle },
    role: row.invite.role as TeamRole,
    roleLabel: teamRoleLabels[row.invite.role as TeamRole],
    email: maskEmail(row.invite.email),
    /** Whether the invitee should sign in first (true) or create an account on the page (false). */
    hasAccount: !!user && !user.demo,
    expiresAt: row.invite.expiresAt.toISOString(),
  }
}

/**
 * Accepts an invite. Either the caller is signed in as a shopper whose email matches the invite,
 * or no account has that email and `name` + `password` create one. Opens a brand session on the
 * inviting brand.
 */
export async function acceptInvite(input: { token: string; name?: string; password?: string }, shopper: ShopperActor | null, meta: RequestMeta) {
  await limitTokenConsume("invite-accept", meta.ipHash)
  const row = await inviteByToken(input.token)
  if (!row || row.invite.status !== "pending" || row.invite.expiresAt.getTime() <= Date.now()) throw notFound("This invite is no longer valid. Ask the brand to send a new one.")
  if (row.brandStatus === "suspended") throw new HttpError(403, "suspended", "This brand is suspended by Yard.")
  const invite = row.invite
  const existing = await findUserByEmail(invite.email)
  let hash: string | null = null
  if (existing && !existing.demo) {
    if (!shopper || shopper.userId !== existing.id) throw new HttpError(401, "unauthenticated", "Sign in with the invited email address to accept this invite.")
    if (await deletionPending(existing.id)) throw notFound("This invite is no longer valid.")
  } else if (existing && existing.demo) {
    // Demo accounts are seeded fixtures; a real invite never attaches to them.
    throw new HttpError(422, "rule", "This email belongs to a demo account. Invite a real email address.")
  } else {
    if (!input.name?.trim()) throw badRequest({ name: "Enter your name." })
    if (!input.password) throw badRequest({ password: "Choose a password." })
    const problem = passwordProblem(input.password, invite.email)
    if (problem) throw badRequest({ password: problem })
    hash = await hashPassword(input.password) // outside the transaction
  }
  return withTx(async () => {
    const d = await db()
    // Claim the invite first (compare-and-set), so two accepts can't both add a member.
    const [claimed] = await d
      .update(brandInvites)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(and(eq(brandInvites.id, invite.id), eq(brandInvites.status, "pending")))
      .returning()
    if (!claimed) throw notFound("This invite is no longer valid.")
    let userId = existing?.id ?? null
    if (!userId) {
      userId = newId("u")
      await d.insert(users).values({ id: userId, kind: "brand_staff", name: input.name!.trim(), email: normalizeEmail(invite.email), status: "active", demo: false })
      await upsertCredentials(userId, { passwordHash: hash, passwordUpdatedAt: new Date() })
    }
    const user = await userById(userId)
    if (!user || user.status === "suspended") throw new HttpError(403, "suspended", "This account is suspended.")
    // The emailed token proves the address.
    const cred = await credentialsOf(user.id)
    if (!cred?.emailVerifiedAt) await upsertCredentials(user.id, { emailVerifiedAt: new Date() })
    await d.update(brandInvites).set({ acceptedBy: user.id }).where(eq(brandInvites.id, invite.id))
    await d
      .insert(brandMembers)
      .values({ id: newId("bm"), brandId: invite.brandId, userId: user.id, role: invite.role, status: "active" })
      .onConflictDoUpdate({ target: [brandMembers.brandId, brandMembers.userId], set: { role: invite.role, status: "active" } })
    await writeAudit({ actor: { kind: "brand", id: user.id, name: user.name, role: invite.role }, action: "team.invite_accepted", target: user.name, subjectType: "brand_invite", subjectId: invite.id, brandId: invite.brandId, ipHash: meta.ipHash, meta: { role: invite.role } })
    const out = await openSession({ actor: "brand", user, brandId: invite.brandId, method: "invite", meta })
    return { status: "signed_in" as const, actor: "brand" as const, profile: out.profile }
  })
}
