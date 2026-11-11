import "server-only"
import { notSampleBrandSql } from "../catalog/sample-guard"
import { and, asc, eq, gt, inArray, notInArray, or, type SQL } from "drizzle-orm"
import { db, t } from "../db"

/**
 * The one public predicate (§6.4 Around API, §3.9). Every public read of places and events goes
 * through here:
 * - places: published ∧ approved ∧ brandListed(brand) ∧ (store or showroom, or ends_at > now);
 * - events: the same, plus their place passes, and ends_at > now.
 * So a draft, hidden, pending, rejected, removed or ended place, or one of a restricted or
 * suspended brand, never reaches the map, the list, a detail page or PlaceBadge.
 */

const UNLISTED = ["restricted", "suspended"]

export function publicPlaceWhere(now: Date): SQL {
  return and(
    eq(t.brandLocations.visibility, "published"),
    eq(t.brandLocations.moderationStatus, "approved"),
    notInArray(t.brands.reviewStatus, UNLISTED),
    // Production: never a sample brand's place, even from a demo-seeded database.
    notSampleBrandSql(t.brandLocations.brandId),
    or(inArray(t.brandLocations.kind, ["store", "showroom"]), gt(t.brandLocations.endsAt, now)),
  )!
}

/** A public place with its brand's public facts (name, handle, categories), so DTOs never need the sample catalogue. */
export type PublicPlaceRow = typeof t.brandLocations.$inferSelect & { brandReviewStatus: string; brandName: string; brandHandle: string; brandVerified: boolean; brandCategories: string[] }
export type PublicEventRow = typeof t.locationEvents.$inferSelect

export type PublicFilter = { tiles?: string[]; brandId?: string; id?: string; citySlug?: string; kind?: string; now?: Date; limit?: number }

/** Places that publicPlaces() returns, optionally narrowed. */
export async function publicPlaces(f: PublicFilter = {}): Promise<PublicPlaceRow[]> {
  const now = f.now ?? new Date()
  const d = await db()
  const conds: SQL[] = [publicPlaceWhere(now)]
  if (f.tiles?.length) conds.push(inArray(t.brandLocations.tileKey, f.tiles))
  if (f.brandId) conds.push(eq(t.brandLocations.brandId, f.brandId))
  if (f.id) conds.push(eq(t.brandLocations.id, f.id))
  if (f.citySlug) conds.push(eq(t.brandLocations.citySlug, f.citySlug))
  if (f.kind) conds.push(eq(t.brandLocations.kind, f.kind))
  const rows = await d
    .select({ place: t.brandLocations, brandReviewStatus: t.brands.reviewStatus, brandName: t.brands.name, brandHandle: t.brands.handle, brandVerified: t.brands.verified, brandCategories: t.brands.categories })
    .from(t.brandLocations)
    .innerJoin(t.brands, eq(t.brands.id, t.brandLocations.brandId))
    .where(and(...conds))
    .orderBy(asc(t.brandLocations.id))
    .limit(f.limit ?? 2000)
  return rows.map((r) => ({ ...r.place, brandReviewStatus: r.brandReviewStatus, brandName: r.brandName, brandHandle: r.brandHandle, brandVerified: r.brandVerified, brandCategories: r.brandCategories }))
}

/** Public events of places that already passed publicPlaces(): published ∧ approved ∧ ends_at > now. */
export async function publicEvents(locationIds: string[], now = new Date()): Promise<PublicEventRow[]> {
  if (!locationIds.length) return []
  const d = await db()
  return d
    .select()
    .from(t.locationEvents)
    .where(and(inArray(t.locationEvents.locationId, locationIds), eq(t.locationEvents.visibility, "published"), eq(t.locationEvents.moderationStatus, "approved"), gt(t.locationEvents.endsAt, now)))
    .orderBy(asc(t.locationEvents.startsAt))
}

/** The same predicate in JS, for rows a memo already holds (ended pop-ups and events drop out at once). */
export function stillPublic(p: { kind: string; endsAt: Date | null }, now: number) {
  return p.kind === "store" || p.kind === "showroom" || (p.endsAt !== null && p.endsAt.getTime() > now)
}
export const eventStillPublic = (e: { endsAt: Date }, now: number) => e.endsAt.getTime() > now
