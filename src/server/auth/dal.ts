import "server-only"
import { and, eq, gt, isNull, or } from "drizzle-orm"
import { connection } from "next/server"
import { cache } from "react"
import { db } from "../db"
import { accountRestrictions } from "../db/schema"
import { forbidden, notFound, restricted, unauthenticated } from "../http/errors"
import {
  adminRolePermissions,
  brandRolePermissions,
  canAdmin,
  canBrand,
  type AdminPermission,
  type AdminRole,
  type BrandPermission,
  type MemberRole,
} from "@/lib/permissions"
import { loadSession, sessionsAllowed, type SessionRow } from "./session"
import { sessionAuthOf } from "./session-auth"

/**
 * The Data Access Layer (§2.2). Every getter re-reads the session close to the data; each is
 * memoised per request with React cache() (a no-op outside a render, so never shared between
 * requests). Session reads go through cookies(), which is itself the request marker.
 */

export type ShopperActor = {
  kind: "shopper"
  sessionId: string
  userId: string
  name: string
  email: string
  status: "active" | "restricted" | "suspended"
  createdAt: Date
  demo: boolean
}

export type BrandSession = { sessionId: string; userId: string; activeBrandId: string; role: MemberRole }

export type BrandActor = {
  kind: "brand"
  sessionId: string
  userId: string
  name: string
  brandId: string
  brand: { id: string; handle: string; name: string; reviewStatus: string; currency: string; country: string; city: string; citySlug: string; timeZone: string; claimStatus: string; logoMediaId: string | null }
  /** `yard_setup` is Yard staff setting up an unclaimed founding brand (see yardSetupAllowed). */
  role: MemberRole
  permissions: BrandPermission[]
  demo: boolean
}

export type AdminActor = {
  kind: "admin"
  sessionId: string
  userId: string
  name: string
  role: AdminRole
  permissions: AdminPermission[]
  demo: boolean
}

export type Actor = ShopperActor | BrandActor | AdminActor

/** The marker every public DB read starts with (§1.6 rule 1): excludes it from prerendering. */
export async function requestScope() {
  await connection()
}

const userOf = async (s: SessionRow) => {
  const d = await db()
  return d.query.users.findFirst({ where: (u, { eq }) => eq(u.id, s.userId) })
}

/** The signed-in shopper, or null. Null when the user is suspended (their sessions are gone anyway). */
export const getShopper = cache(async (): Promise<ShopperActor | null> => {
  const s = await loadSession("shopper")
  if (!s) return null
  const u = await userOf(s)
  if (!u || u.status === "suspended" || (u.kind !== "shopper" && u.kind !== "brand_staff")) return null
  return { kind: "shopper", sessionId: s.id, userId: u.id, name: u.name, email: u.email, status: u.status as ShopperActor["status"], createdAt: u.createdAt, demo: u.demo }
})

/** An active restriction of `kind` on a user or brand, or null. */
export async function activeRestriction(subjectKind: "user" | "brand", subjectId: string, kind: string) {
  const d = await db()
  const now = new Date()
  const [row] = await d
    .select()
    .from(accountRestrictions)
    .where(
      and(
        eq(accountRestrictions.subjectKind, subjectKind),
        eq(accountRestrictions.subjectId, subjectId),
        eq(accountRestrictions.kind, kind),
        eq(accountRestrictions.status, "active"),
        or(isNull(accountRestrictions.until), gt(accountRestrictions.until, now)),
      ),
    )
    .limit(1)
  return row ?? null
}

const untilText = (until: Date | null) => (until ? ` until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "")

export async function requireShopper(opts: { notRestricted?: "messaging" | "uploads" | "reports" } = {}): Promise<ShopperActor> {
  const s = await getShopper()
  if (!s) throw unauthenticated()
  if (opts.notRestricted) {
    const r = await activeRestriction("user", s.userId, opts.notRestricted)
    if (r) {
      const what = { messaging: "Messaging", uploads: "Uploading", reports: "Reporting" }[opts.notRestricted]
      throw restricted(`${what} is paused on your account${untilText(r.until)}.`)
    }
  }
  return s
}

/** The brand session: null when the membership is gone or the active brand is suspended. */
export const getBrandSession = cache(async (): Promise<BrandSession | null> => {
  const a = await getBrandActorInternal()
  return a ? { sessionId: a.sessionId, userId: a.userId, activeBrandId: a.brandId, role: a.role } : null
})

const getBrandActorInternal = cache(async (): Promise<BrandActor | null> => {
  const s = await loadSession("brand")
  if (!s || !s.activeBrandId) return null
  const d = await db()
  const [u, m, b] = await Promise.all([
    userOf(s),
    d.query.brandMembers.findFirst({ where: (bm, { and, eq }) => and(eq(bm.brandId, s.activeBrandId!), eq(bm.userId, s.userId), eq(bm.status, "active")) }),
    d.query.brands.findFirst({ where: (br, { eq }) => eq(br.id, s.activeBrandId!) }),
  ])
  if (!u || u.status === "suspended" || !m || !b || b.reviewStatus === "suspended") return null
  const role = m.role as MemberRole
  // Yard setup (founding brands): only a session opened by the admin setup route, only while the
  // user still holds brands.founding as an admin, and only while the brand is unclaimed.
  if (role === "yard_setup" && !(await yardSetupAllowed(s.id, u, b))) return null
  return {
    kind: "brand",
    sessionId: s.id,
    userId: u.id,
    name: u.name,
    brandId: b.id,
    brand: { id: b.id, handle: b.handle, name: b.name, reviewStatus: b.reviewStatus, currency: b.currency, country: b.country, city: b.city, citySlug: b.citySlug, timeZone: b.timeZone, claimStatus: b.claimStatus, logoMediaId: b.logoMediaId ?? null },
    role,
    permissions: brandRolePermissions[role] ?? [],
    demo: u.demo,
  }
})

async function yardSetupAllowed(sessionId: string, u: { id: string; demo: boolean }, b: { founding: boolean; claimStatus: string; reviewStatus: string }) {
  if (!b.founding || b.claimStatus !== "unclaimed" || b.reviewStatus === "restricted") return false
  const how = await sessionAuthOf(sessionId)
  if (how?.method !== "yard_setup") return false
  // A demo admin's setup session ends with demo admin sign-in.
  if (u.demo && !sessionsAllowed("admin")) return false
  const d = await db()
  const am = await d.query.adminMembers.findFirst({ where: (x, { eq }) => eq(x.userId, u.id) })
  return !!am && canAdmin(am.role as AdminRole, "brands.founding")
}

/** True for Yard staff working in an unclaimed founding brand (Studio "Yard setup"). */
export const isYardSetup = (a: { kind: string; role?: string } | null | undefined) => a?.kind === "brand" && a.role === "yard_setup"

/** The brand actor without a permission check (GET /api/session). */
export const getBrandActor = getBrandActorInternal

/** List endpoints: the active brand, permission-checked against the active membership only. */
/**
 * `allowYardSetup`: only route() passes it, because route() then applies the Yard setup path
 * allow-list (http/route.ts yardSetupMayUse). Any other caller refuses Yard setup sessions, so a
 * handler that resolves the brand itself can never widen Yard setup's reach (deny by default).
 */
export async function requireActiveBrand(permission: BrandPermission | "any_member", opts: { allowYardSetup?: boolean } = {}): Promise<BrandActor> {
  const a = await getBrandActorInternal()
  if (!a) throw unauthenticated("Sign in to Brand Studio to continue.")
  if (a.role === "yard_setup" && !opts.allowYardSetup) throw forbidden("Yard setup covers products, photos, collections, storefront, shipping and locations only.")
  if (!canBrand(a.role, permission)) throw forbidden()
  return a
}

/**
 * Loads a brand resource scoped to the session's ACTIVE brand: the loader receives the active
 * brand id and must filter by it. Another brand's resource is 404, even when the user belongs to
 * that brand under another role (§2.2).
 */
export async function requireBrandResource<T extends { brandId: string }>(
  load: (activeBrandId: string) => Promise<T | null | undefined>,
  permission: BrandPermission | "any_member",
): Promise<{ actor: BrandActor; resource: T }> {
  const actor = await requireActiveBrand(permission)
  const resource = await load(actor.brandId)
  if (!resource || resource.brandId !== actor.brandId) throw notFound()
  return { actor, resource }
}

/** Members of a restricted brand can read; writes that publish or reply are paused (§2.2). */
export function assertBrandMayPublish(actor: BrandActor) {
  if (actor.brand.reviewStatus === "restricted") throw restricted(`Yard has restricted ${actor.brand.name}, so publishing and replies are paused.`)
}

export const getAdmin = cache(async (): Promise<AdminActor | null> => {
  const s = await loadSession("admin")
  if (!s) return null
  // v3: a real (non-demo) admin session must have passed TOTP (it is only ever created after it).
  const how = await sessionAuthOf(s.id)
  if (how && how.method !== "demo" && !how.mfaAt) return null
  const d = await db()
  const [u, m] = await Promise.all([userOf(s), d.query.adminMembers.findFirst({ where: (am, { eq }) => eq(am.userId, s.userId) })])
  if (!u || u.status === "suspended" || !m) return null
  const role = m.role as AdminRole
  return { kind: "admin", sessionId: s.id, userId: u.id, name: u.name, role, permissions: adminRolePermissions[role] ?? [], demo: u.demo }
})

export async function requireAdmin(permission: AdminPermission | "any_admin"): Promise<AdminActor> {
  const a = await getAdmin()
  if (!a) throw unauthenticated("Sign in to the Control Center to continue.")
  if (!canAdmin(a.role, permission)) throw forbidden()
  return a
}

/** `brandListed(brand)`: the single predicate behind every public read (§2.2, §3.9). */
export function brandListed(brand: { reviewStatus: string; founding?: boolean; launchedAt?: Date | null }) {
  // A founding brand is listed only once it has launched (first storefront publish); callers that
  // pass the whole brand row get that gate, ordinary brands are unaffected.
  if (brand.founding && brand.launchedAt === null) return false
  return brand.reviewStatus !== "restricted" && brand.reviewStatus !== "suspended"
}
