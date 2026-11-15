import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { brandRolePermissions, type BrandPermission, type MemberRole } from "@/lib/permissions"
import type { Executor, Tx } from "../db"
import { brandMembers, brands, users } from "../db/schema"
import { enqueueEmail } from "../email"

/**
 * A transactional email to a brand about one of its orders. Brands have no stored contact
 * address yet, so it goes to every active owner member of the brand (one outbox row each,
 * deduplicated per address). `brand` is filled with the brand's name.
 */
export async function emailBrandOwners(tx: Tx, brandId: string, template: string, vars: Record<string, string | number>, dedupeKey: string) {
  const rows = await tx
    .select({ email: users.email, brandName: brands.name })
    .from(brandMembers)
    .innerJoin(users, eq(users.id, brandMembers.userId))
    .innerJoin(brands, eq(brands.id, brandMembers.brandId))
    .where(and(eq(brandMembers.brandId, brandId), eq(brandMembers.status, "active"), eq(brandMembers.role, "owner")))
  for (const r of rows) {
    if (!r.email) continue
    await enqueueEmail(tx, { template, to: r.email, vars: { brand: r.brandName, ...vars }, dedupeKey: `${dedupeKey}:${r.email.toLowerCase()}`.slice(0, 200) })
  }
}

/**
 * The same email to every active member whose role holds `permission` (one outbox row each,
 * deduplicated per address). Yard setup (Yard staff in an unclaimed founding brand) is never a
 * recipient. `brand` is filled with the brand's name.
 */
export async function emailBrandMembersWith(tx: Tx, brandId: string, permission: BrandPermission, template: string, vars: Record<string, string | number>, dedupeKey: string) {
  const roles = (Object.keys(brandRolePermissions) as MemberRole[]).filter((r) => r !== "yard_setup" && brandRolePermissions[r].includes(permission))
  const rows = await tx
    .select({ email: users.email, brandName: brands.name })
    .from(brandMembers)
    .innerJoin(users, eq(users.id, brandMembers.userId))
    .innerJoin(brands, eq(brands.id, brandMembers.brandId))
    .where(and(eq(brandMembers.brandId, brandId), eq(brandMembers.status, "active"), inArray(brandMembers.role, roles)))
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.email || seen.has(r.email.toLowerCase())) continue
    seen.add(r.email.toLowerCase())
    await enqueueEmail(tx, { template, to: r.email, vars: { brand: r.brandName, ...vars }, dedupeKey: `${dedupeKey}:${r.email.toLowerCase()}`.slice(0, 200) })
  }
  return seen.size
}

/** The people who run a brand: its active owners and admins (never Yard setup). */
export const BRAND_LEAD_ROLES = ["owner", "admin"] as const

/** The brand's active owners and admins with their address (one row per address). */
export async function brandLeads(tx: Tx | Executor, brandId: string): Promise<{ userId: string; name: string | null; email: string; role: string }[]> {
  const rows = await tx
    .select({ userId: users.id, name: users.name, email: users.email, role: brandMembers.role })
    .from(brandMembers)
    .innerJoin(users, eq(users.id, brandMembers.userId))
    .where(and(eq(brandMembers.brandId, brandId), eq(brandMembers.status, "active"), inArray(brandMembers.role, [...BRAND_LEAD_ROLES])))
  const seen = new Set<string>()
  return rows.filter((r) => !!r.email && !seen.has(r.email.toLowerCase()) && (seen.add(r.email.toLowerCase()), true)).map((r) => ({ ...r, email: r.email! }))
}

/**
 * An email to the people who run a brand (its active owners and admins), one outbox row each,
 * deduplicated per address. `brand` is filled with the brand's name. Returns how many were queued.
 */
export async function emailBrandLeads(tx: Tx, brandId: string, template: string, vars: Record<string, string | number>, dedupeKey: string): Promise<number> {
  const [b] = await tx.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1)
  const leads = await brandLeads(tx, brandId)
  for (const r of leads) await enqueueEmail(tx, { template, to: r.email, vars: { brand: b?.name ?? "", ...vars }, dedupeKey: `${dedupeKey}:${r.email.toLowerCase()}`.slice(0, 200) })
  return leads.length
}
