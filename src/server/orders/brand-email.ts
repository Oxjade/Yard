import "server-only"
import { and, eq } from "drizzle-orm"
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
