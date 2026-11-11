import "server-only"
import { and, asc, eq, inArray, ne } from "drizzle-orm"
import { db } from "../db"
import { adminMembers, brandMembers, brands, users } from "../db/schema"
import { getEnv } from "../env"
import { badRequest, notFound, suspended } from "../http/errors"
import { adminRoleLabels, teamRoleLabels, type AdminRole, type TeamRole } from "@/lib/permissions"
import type { DemoAccountDto } from "@/lib/api/contracts/session"
import type { ActorKind } from "./session"

/**
 * Demo sign-in (§2.3). There are no passwords or identity providers in this build. The ONE gate
 * for every demo session is demoAuthEnabled(actor): on in development; in production shopper
 * and brand need YARD_DEMO_AUTH=1 and admin also needs YARD_DEMO_ADMIN=1. Otherwise GET and
 * POST /api/auth/demo answer 404 for that actor, and every existing session of that kind is
 * void (loadSession, purgeDisabledSessions). DELETE (sign-out) always works.
 */
export function demoAuthEnabled(actor: ActorKind) {
  return getEnv().demoAuth[actor]
}

/** The Studio picker's accounts, in order; `more` ones sit under "More test accounts". */
export const brandPickerAccounts = [
  { userId: "u_b_tobi", brandId: "b_lagos_static" },
  { userId: "u_b_kemi", brandId: "b_lagos_static" },
  { userId: "u_b_minji", brandId: "b_null_form", note: "For testing that brands can't see each other" },
  { userId: "u_b_orun", brandId: "b_orun_studio", note: "A brand that isn't verified yet" },
  { userId: "u_b_designer", brandId: "b_lagos_static", more: true },
  { userId: "u_b_viewer", brandId: "b_lagos_static", more: true },
] as const

/** The Admin picker: Kemi Ajayi (Owner), Aisha Bello (Trust & safety), Ngozi Eze (Support), Sam Lee (Ads operations). */
export const adminPickerAccounts = ["adm_1", "adm_3", "adm_5", "adm_4"] as const

/** The marketplace signs in as Ada only: the browser stores aren't per-account (§2.3). */
export const MARKET_DEMO_ACCOUNT = "u_ada"

export async function listDemoAccounts(actor: ActorKind): Promise<DemoAccountDto[]> {
  const d = await db()
  if (actor === "brand") {
    const ids = brandPickerAccounts.map((a) => a.userId)
    const rows = await d
      .select({ userId: users.id, name: users.name, userStatus: users.status, brandId: brands.id, brandName: brands.name, reviewStatus: brands.reviewStatus, role: brandMembers.role })
      .from(brandMembers)
      .innerJoin(users, eq(users.id, brandMembers.userId))
      .innerJoin(brands, eq(brands.id, brandMembers.brandId))
      .where(and(inArray(brandMembers.userId, ids), eq(brandMembers.status, "active"), ne(brandMembers.role, "yard_setup")))
    return brandPickerAccounts.flatMap((a) => {
      const r = rows.find((x) => x.userId === a.userId && x.brandId === a.brandId)
      if (!r) return []
      const off = r.userStatus === "suspended" ? "This demo account is suspended." : r.reviewStatus === "suspended" ? "Suspended by Yard" : null
      return [
        {
          actor: "brand" as const,
          account: r.userId,
          brandId: r.brandId,
          name: r.name,
          role: teamRoleLabels[r.role as TeamRole],
          brandName: r.brandName,
          note: "note" in a ? a.note : undefined,
          more: "more" in a ? a.more : false,
          disabledReason: off ?? undefined,
        },
      ]
    })
  }
  if (actor === "admin") {
    const rows = await d
      .select({ userId: users.id, name: users.name, status: users.status, role: adminMembers.role })
      .from(adminMembers)
      .innerJoin(users, eq(users.id, adminMembers.userId))
      .where(inArray(adminMembers.userId, [...adminPickerAccounts]))
    return adminPickerAccounts.flatMap((id) => {
      const r = rows.find((x) => x.userId === id)
      if (!r) return []
      return [{ actor: "admin" as const, account: r.userId, name: r.name, role: adminRoleLabels[r.role as AdminRole], more: false, disabledReason: r.status === "suspended" ? "This demo account is suspended." : undefined }]
    })
  }
  const ada = await d.query.users.findFirst({ where: (u, { eq }) => eq(u.id, MARKET_DEMO_ACCOUNT) })
  return ada ? [{ actor: "shopper", account: ada.id, name: ada.name, role: "Shopper", more: false, disabledReason: ada.status === "suspended" ? "This demo account is suspended." : undefined }] : []
}

/**
 * Checks that `account` may hold a demo session of kind `actor` (§2.3 Eligibility) and returns
 * the user and, for brands, the active brand. Unknown → 404; suspended → 403 suspended.
 */
export async function eligibleAccount(actor: ActorKind, account: string, brandId?: string) {
  const d = await db()
  const user = await d.query.users.findFirst({ where: (u, { eq }) => eq(u.id, account) })
  // v3: demo sign-in only ever opens DEMO accounts; a real account (demo = false) needs its password.
  if (!user || !user.demo) throw notFound("There's no demo account with that id.")
  if (actor === "shopper") {
    if (user.kind !== "shopper" && user.kind !== "brand_staff") throw notFound("There's no demo shopper with that id.")
    if (user.status === "suspended") throw suspended()
    return { user, activeBrandId: null as string | null }
  }
  if (actor === "admin") {
    const member = await d.query.adminMembers.findFirst({ where: (m, { eq }) => eq(m.userId, account) })
    if (!member) throw notFound("There's no demo admin with that id.")
    if (user.status === "suspended") throw suspended()
    return { user, activeBrandId: null as string | null }
  }
  const memberships = await d
    .select({ brandId: brandMembers.brandId, reviewStatus: brands.reviewStatus })
    .from(brandMembers)
    .innerJoin(brands, eq(brands.id, brandMembers.brandId))
    .where(and(eq(brandMembers.userId, account), eq(brandMembers.status, "active"), ne(brandMembers.role, "yard_setup")))
    .orderBy(asc(brandMembers.createdAt), asc(brandMembers.id))
  if (!memberships.length) throw notFound("That account isn't a member of any brand.")
  if (user.status === "suspended") throw suspended()
  const chosen = brandId ? memberships.find((m) => m.brandId === brandId) : memberships[0]
  if (!chosen) throw badRequest({ brandId: "That account isn't a member of this brand." })
  if (chosen.reviewStatus === "suspended") throw suspended("This brand is suspended by Yard.")
  return { user, activeBrandId: chosen.brandId }
}
