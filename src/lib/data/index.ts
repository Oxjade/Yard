import { convert } from "@/lib/money"
import type { CountryCode } from "@/config/markets"
import { brands, brandById, brandByHandle } from "./brands"
import { categories, categoryBySlug, collections, curatedCollections, drops, stories } from "./catalog"
import { products, productById, productBySlug, productStock } from "./products"
import { sponsoredBrandIds, sponsoredProductIds } from "./ads"
import { initialDropPhase } from "@/lib/drops"
import type { Aesthetic, Brand, CategorySlug, Product } from "./types"

/**
 * The frontend data layer. Every page reads through these functions; in the backend
 * phase they become database queries with the same signatures.
 * Discovery here is Phase 1 of the blueprint (§11.7): rules-based, with diversity caps.
 */

export { brands, brandById, brandByHandle, categories, categoryBySlug, collections, curatedCollections, drops, stories, products, productById, productBySlug }

export const getBrand = (handle: string) => brandByHandle.get(handle)
export const getProduct = (slug: string) => productBySlug.get(slug)
export const productsOf = (brandId: string) => products.filter((p) => p.brandId === brandId && p.status === "published")
export const collectionsOf = (brandId: string) => collections.filter((c) => c.brandId === brandId)
export const dropsOf = (brandId: string) => drops.filter((d) => d.brandId === brandId)
export const storiesOf = (brandId: string) => stories.filter((s) => s.brandId === brandId)
export const getStory = (slug: string) => stories.find((s) => s.slug === slug)
export const getDrop = (slug: string) => drops.find((d) => d.slug === slug)
export const getCuratedCollection = (slug: string) => curatedCollections.find((c) => c.slug === slug)

/** Cap items per brand so no single brand dominates a feed. */
export function diversify<T>(items: T[], brandOf: (t: T) => string, perBrand = 2) {
  const seen = new Map<string, number>()
  return items.filter((t) => {
    const b = brandOf(t)
    const n = seen.get(b) ?? 0
    if (n >= perBrand) return false
    seen.set(b, n + 1)
    return true
  })
}

/** Trending: time-decayed momentum, not lifetime popularity. */
export function trendingProducts(limit = 8) {
  return diversify([...products].sort((a, b) => b.stats.trend - a.stats.trend), (p) => p.brandId, 2).slice(0, limit)
}

/** Emerging: smaller audiences growing fast. */
export function emergingBrands(limit = 6) {
  return brands
    .filter((b) => b.followers < 30000 && b.followerGrowth30d >= 0.09)
    .sort((a, b) => b.followerGrowth30d - a.followerGrowth30d)
    .slice(0, limit)
}

export function recentlyJoinedBrands(limit = 6) {
  return [...brands].sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)).slice(0, limit)
}

export function trendingBrands(limit = 6) {
  return [...brands]
    .sort((a, b) => b.followers * b.followerGrowth30d - a.followers * a.followerGrowth30d)
    .slice(0, limit)
}

export function sponsoredBrands() {
  return sponsoredBrandIds.map((id) => brandById.get(id)).filter((b): b is Brand => !!b)
}

export function sponsoredProducts(category?: CategorySlug) {
  return sponsoredProductIds
    .map((id) => productById.get(id))
    .filter((p): p is Product => !!p && (!category || p.category === category))
}

/** Rules-based personal ranking from interests, follows and saves. Pure — safe on the client. */
export function recommendProducts(input: { interests: CategorySlug[]; aesthetics: Aesthetic[]; following: string[]; wishlist: string[]; viewed: string[] }, limit = 8) {
  const savedCategories = new Set(input.wishlist.map((id) => productById.get(id)?.category).filter(Boolean) as CategorySlug[])
  const scored = products
    .filter((p) => !input.wishlist.includes(p.id))
    .map((p) => {
      const brand = brandById.get(p.brandId)!
      let score = p.stats.trend * 0.3
      if (input.interests.includes(p.category)) score += 30
      if (savedCategories.has(p.category)) score += 18
      if (input.following.includes(p.brandId)) score += 22
      if (brand.aesthetics.some((a) => input.aesthetics.includes(a))) score += 12
      if (brand.followers < 20000) score += 8 // fair exposure for smaller brands
      if (input.viewed.includes(p.id)) score -= 10
      return { p, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((s) => s.p)
  return diversify(scored, (p) => p.brandId, 2).slice(0, limit)
}

export function recommendBrands(input: { interests: CategorySlug[]; following: string[] }, limit = 4) {
  return brands
    .filter((b) => !input.following.includes(b.id))
    .map((b) => ({ b, score: b.categories.filter((c) => input.interests.includes(c)).length * 10 + b.followerGrowth30d * 40 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.b)
}

export function similarProducts(p: Product, limit = 4) {
  return diversify(
    products
      .filter((x) => x.id !== p.id && x.brandId !== p.brandId)
      .map((x) => ({ x, score: (x.category === p.category ? 10 : 0) + (x.subcategory === p.subcategory ? 6 : 0) + x.tags.filter((t) => p.tags.includes(t)).length * 3 }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.x),
    (x) => x.brandId,
    1,
  ).slice(0, limit)
}

export function upcomingDrops() {
  return drops.filter((d) => initialDropPhase(d) === "upcoming").sort((a, b) => a.releaseOffsetHours - b.releaseOffsetHours)
}
export function liveDrops() {
  return drops.filter((d) => initialDropPhase(d) === "live")
}
export function pastDrops() {
  return drops.filter((d) => ["sold-out", "ended"].includes(initialDropPhase(d))).sort((a, b) => b.releaseOffsetHours - a.releaseOffsetHours)
}

/* ---------- Catalogue search & filters ---------- */

export type ProductSort = "trending" | "newest" | "price-asc" | "price-desc"

export type ProductQuery = {
  q?: string
  category?: CategorySlug
  subcategory?: string
  brands?: string[]
  /** USD major units */
  minPrice?: number
  maxPrice?: number
  inStock?: boolean
  country?: CountryCode
  sort?: ProductSort
}

export function priceUsd(p: Product) {
  return convert(p.price, p.currency, "USD") / 100
}

export function searchProducts(query: ProductQuery) {
  const q = query.q?.trim().toLowerCase()
  let list = products.filter((p) => p.status === "published")
  if (q) {
    list = list.filter((p) => {
      const brand = brandById.get(p.brandId)!
      return [p.name, p.description, p.subcategory, p.category, brand.name, ...p.tags].join(" ").toLowerCase().includes(q)
    })
  }
  if (query.category) list = list.filter((p) => p.category === query.category)
  if (query.subcategory) list = list.filter((p) => p.subcategory === query.subcategory)
  if (query.brands?.length) list = list.filter((p) => query.brands!.includes(brandById.get(p.brandId)!.handle))
  if (query.minPrice !== undefined) list = list.filter((p) => priceUsd(p) >= query.minPrice!)
  if (query.maxPrice !== undefined) list = list.filter((p) => priceUsd(p) <= query.maxPrice!)
  if (query.inStock) list = list.filter((p) => productStock(p) > 0)
  if (query.country) list = list.filter((p) => brandById.get(p.brandId)!.country === query.country)
  const sort = query.sort ?? "trending"
  list = [...list].sort((a, b) => {
    if (sort === "newest") return b.createdAt.localeCompare(a.createdAt)
    if (sort === "price-asc") return priceUsd(a) - priceUsd(b)
    if (sort === "price-desc") return priceUsd(b) - priceUsd(a)
    return b.stats.trend - a.stats.trend
  })
  return list
}

export type BrandSort = "trending" | "newest" | "followers" | "emerging"

export function searchBrands(query: { q?: string; category?: CategorySlug; aesthetic?: Aesthetic; country?: CountryCode; sort?: BrandSort }) {
  const q = query.q?.trim().toLowerCase()
  let list = [...brands]
  if (q) list = list.filter((b) => [b.name, b.tagline, b.city, b.description].join(" ").toLowerCase().includes(q))
  if (query.category) list = list.filter((b) => b.categories.includes(query.category!))
  if (query.aesthetic) list = list.filter((b) => b.aesthetics.includes(query.aesthetic!))
  if (query.country) list = list.filter((b) => b.country === query.country)
  const sort = query.sort ?? "trending"
  return list.sort((a, b) => {
    if (sort === "newest") return b.joinedAt.localeCompare(a.joinedAt)
    if (sort === "followers") return b.followers - a.followers
    if (sort === "emerging") return b.followerGrowth30d - a.followerGrowth30d
    return b.followers * b.followerGrowth30d - a.followers * a.followerGrowth30d
  })
}

export const aestheticLabels: Record<Aesthetic, string> = {
  minimalist: "Minimalist",
  vintage: "Vintage",
  "avant-garde": "Avant-garde",
  streetwear: "Streetwear",
  contemporary: "Contemporary",
  luxury: "Luxury",
  experimental: "Experimental",
}
