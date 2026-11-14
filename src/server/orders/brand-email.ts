import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { brandRolePermissions, type BrandPermission, type MemberRole } from "@/lib/permissions"
import type { Tx } from "../db"
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
