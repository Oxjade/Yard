import "server-only"
import { countries } from "@/config/markets"
import { categoryBySlug } from "@/lib/data/catalog"
import { cityBySlug } from "@/lib/around/gazetteer"
import { listed, type BrandRow, type Universe } from "./metrics"

/**
 * Chart scopes (§3.5 chart_snapshots.scope): 'global', 'city:<slug>', 'country:<CC>',
 * 'category:<slug>', or a place and a category joined with '|'.
 */
export type Scope = { city?: string; country?: string; category?: string }

/** Scoped boards need at least this many eligible brands; City charts always do. */
export const MIN_COHORT = 3

export function scopeKey(s: Scope): string {
  const parts: string[] = []
  if (s.city) parts.push(`city:${s.city}`)
  else if (s.country) parts.push(`country:${s.country}`)
  if (s.category) parts.push(`category:${s.category}`)
  return parts.length ? parts.join("|") : "global"
}

export function parseScope(key: string): Scope {
  const out: Scope = {}
  if (key === "global") return out
  for (const part of key.split("|")) {
    const [k, v] = part.split(":")
    if (k === "city") out.city = v
    else if (k === "country") out.country = v
    else if (k === "category") out.category = v
  }
  return out
}

export const inScope = (b: BrandRow, s: Scope) => (!s.city || b.citySlug === s.city) && (!s.country || b.country === s.country) && (!s.category || b.categories.includes(s.category))

/**
 * Eligible brands for an edition (§6.3 "Eligible brands"): listed (not restricted or suspended),
 * no active charts_freeze, not held by an open high flag from that date on, joined by then, and in
 * scope.
 */
export function eligibleBrands(u: Universe, s: Scope, edition: string): BrandRow[] {
  return u.brands.filter((b) => {
    if (!listed(b) || u.frozen.has(b.id)) return false
    const hold = u.holds.get(b.id)
    if (hold && hold <= edition) return false
    if (b.joinedAt > edition) return false
    return inScope(b, s)
  })
}

/**
 * Names for scopes, from Yard's own lists only: an unknown code or slug gives null (never the slug
 * itself), so nothing a visitor types into the URL can end up in Yard's copy.
 */
export const countryName = (code: string): string | null => (countries as Record<string, { name: string } | undefined>)[code]?.name ?? null
export const cityName = (slug: string, fallback?: string): string | null => cityBySlug(slug)?.name ?? fallback ?? null
export const categoryLabel = (slug: string): string | null => categoryBySlug.get(slug as never)?.name ?? null

/** "Lagos", "Germany", "Home & lifestyle brands in Berlin": a scope in words. */
export function scopeLabel(s: Scope): { place: string | null; category: string | null } {
  return { place: s.city ? cityName(s.city) : s.country ? countryName(s.country) : null, category: s.category ? categoryLabel(s.category) : null }
}
