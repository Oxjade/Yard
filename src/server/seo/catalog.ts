import "server-only"
import { and, asc, eq, sql } from "drizzle-orm"
import { categories as sampleCategories } from "@/lib/data/catalog"
import { site } from "@/config/site"
import { feedEligible, feedItemsFor, type FeedItem } from "@/lib/seo/feed"
import type { SeoProductInput, SeoShippingOption } from "@/lib/seo/json-ld"
import type { LlmsBrand, LlmsInput } from "@/lib/seo/llms"
import { shippingOptions } from "@/lib/seo/shipping"
import type { SitemapEntry } from "@/lib/seo/sitemap"
import { absoluteUrl, publicOrigin } from "@/lib/seo/url"
import { requestScope } from "../auth/dal"
import { memo } from "../cache"
import { loadChildren, toPublicProduct, type PublicProductDto } from "../catalog/dto"
import { listPublicBrands, publicCategories } from "../catalog/public"
import { refusedSampleBrand } from "../catalog/sample-guard"
import { brandForSaleSql, brandListedSql, productPublicWhere } from "../catalog/sellable"
import { db } from "../db"
import { brands } from "../db/schema"
import { catalogCollections, catalogProducts, storefrontVersions } from "../db/schema/catalog"
import { publicDropPages, upcomingReleases } from "../drops/service"
import { log } from "../log"
import { loadBrandShipping } from "../shipping/profile"

/**
 * Server reads behind Yard's machine-readable surfaces: the product feed, llms.txt and the
 * sitemap, plus the facts product pages add to their structured data (category name, the brand's
 * delivery options, an upcoming drop's release time).
 *
 * Cost follows time, not traffic: each whole document is memoised in-process (src/server/cache.ts)
 * and rebuilt at most once per TTL however often crawlers ask (feed and sitemap 30 minutes,
 * llms.txt an hour). The keys sit outside "catalog:" on purpose, so a busy shop's writes don't
 * rebuild them on every sale either. Every read goes through the public predicates
 * (productPublicWhere, brandListedSql) and the feed re-checks each product with the pure rule
 * (page-visibility.ts via feedEligible): drafts, hidden, opens-soon and restricted pieces never
 * appear.
 */
export const FEED_TTL_MS = 30 * 60_000
export const SITEMAP_TTL_MS = 30 * 60_000
export const LLMS_TTL_MS = 60 * 60_000

/** Upper bounds on one rebuild (pages of 500), far above Yard's catalogue today. */
const PAGE = 500
const MAX_PRODUCTS = 100_000

type CategoryFacts = { slug: string; name: string; description: string; productCount: number; brandCount: number }

/** Categories with their public product counts (the server's table; the bundled list if that read fails). */
export async function seoCategories(): Promise<CategoryFacts[]> {
  await requestScope()
  try {
    const { categories } = await publicCategories()
    if (categories.length) return categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description, productCount: c.productCount, brandCount: c.brandCount }))
  } catch (e) {
    log.error("[yard] seo: category read failed", e)
  }
  return sampleCategories.map((c) => ({ slug: c.slug, name: c.name, description: c.description, productCount: 0, brandCount: 0 }))
}

const categoryName = (cats: CategoryFacts[], slug: string) => cats.find((c) => c.slug === slug)?.name ?? sampleCategories.find((c) => c.slug === slug)?.name ?? slug

/** The brand's delivery options for one product (its zones, cheapest method each, rate for the price). */
export async function productShipping(brandId: string, priceMinor: number, currency: string, processingDays: [number, number] | null): Promise<SeoShippingOption[]> {
  try {
    const s = await loadBrandShipping(brandId)
    if (!s) return []
    const handling: [number, number] = processingDays ?? [s.profile.handlingMin, s.profile.handlingMax]
    return shippingOptions(s.zones, priceMinor, currency, handling)
  } catch (e) {
    log.error(`[yard] seo: shipping read failed for a brand`, e)
    return []
  }
}

type BrandFacts = { handle: string; name: string; city: string | null; country: string | null; forSale: boolean }

/** A public product as the structured-data and feed builders take it. */
export function seoProductInput(dto: PublicProductDto, brand: BrandFacts, extras: { categoryName: string; releaseAt?: Date | null; shipping?: SeoShippingOption[] }): SeoProductInput {
  return {
    slug: dto.slug,
    name: dto.title,
    description: dto.description,
    images: dto.images.map((i) => ({ src: i.src, alt: i.alt })),
    currency: dto.currency,
    priceMinor: dto.priceMinor,
    compareAtMinor: dto.compareAtMinor,
    category: { slug: dto.category, name: extras.categoryName },
    subcategory: dto.subcategory,
    variants: dto.variants.map((v) => ({ sku: v.sku, options: v.options, priceMinor: v.priceMinor, available: v.available })),
    brand: { name: brand.name, handle: brand.handle, city: brand.city, country: brand.country },
    forSale: brand.forSale,
    releaseAt: extras.releaseAt ? extras.releaseAt.toISOString() : null,
    shipping: extras.shipping ?? [],
  }
}

/** Everything a product page's JSON-LD needs beyond the product itself. */
export async function productSeoInput(dto: PublicProductDto, brand: BrandFacts): Promise<SeoProductInput> {
  const [cats, releases, shipping] = await Promise.all([
    seoCategories(),
    upcomingReleases([dto.id]).catch(() => new Map<string, Date>()),
    productShipping(dto.brandId, Math.min(dto.priceMinor, ...dto.variants.map((v) => v.priceMinor)), dto.currency, dto.processingDays),
  ])
  return seoProductInput(dto, brand, { categoryName: categoryName(cats, dto.category), releaseAt: releases.get(dto.id) ?? null, shipping })
}

/* ---------- The public catalogue, page by page ---------- */

type CatalogueRow = { dto: PublicProductDto; updatedAt: Date; brand: BrandFacts & { id: string }; eligible: boolean }

async function* publicCatalogue(): AsyncGenerator<CatalogueRow[]> {
  const d = await db()
  for (let offset = 0; offset < MAX_PRODUCTS; offset += PAGE) {
    const rows = await d
      .select({
        p: catalogProducts,
        brand: {
          id: brands.id,
          handle: brands.handle,
          name: brands.name,
          city: brands.city,
          country: brands.country,
          founding: brands.founding,
          launchedAt: brands.launchedAt,
          reviewStatus: brands.reviewStatus,
          forSale: sql<boolean>`${brandForSaleSql()}`,
        },
      })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(productPublicWhere())
      .orderBy(asc(catalogProducts.id))
      .limit(PAGE)
      .offset(offset)
    if (!rows.length) return
    const kids = await loadChildren(
      d,
      rows.map((r) => r.p.id),
    )
    const now = new Date()
    yield rows.map((r) => {
      const dto = toPublicProduct(r.p, kids)
      const eligible = feedEligible(
        {
          product: { status: r.p.status, publishAt: r.p.publishAt, moderationStatus: r.p.moderationStatus },
          brand: { founding: r.brand.founding, launchedAt: r.brand.launchedAt, reviewStatus: r.brand.reviewStatus, sample: refusedSampleBrand(r.brand.id) },
          forSale: !!r.brand.forSale,
          variants: dto.variants.length,
          images: dto.images.length,
        },
        now,
      )
      return {
        dto,
        updatedAt: r.p.updatedAt,
        brand: { id: r.brand.id, handle: r.brand.handle, name: r.brand.name, city: r.brand.city, country: r.brand.country, forSale: !!r.brand.forSale },
        eligible,
      }
    })
    if (rows.length < PAGE) return
  }
}

/* ---------- Product feed ---------- */

export type FeedCatalogue = { items: FeedItem[]; generatedAt: string; base: string }

/** Every sellable variant of every live product, built at most once per FEED_TTL_MS. */
export async function feedCatalogue(): Promise<FeedCatalogue> {
  await requestScope()
  const base = publicOrigin()
  return memo(`seo:feed:${base}`, FEED_TTL_MS, async () => {
    const cats = await seoCategories()
    const items: FeedItem[] = []
    const now = new Date()
    for await (const page of publicCatalogue()) {
      const rows = page.filter((r) => r.eligible)
      const releases = await upcomingReleases(
        rows.map((r) => r.dto.id),
        now,
      ).catch(() => new Map<string, Date>())
      for (const r of rows) {
        const shipping = await productShipping(r.dto.brandId, Math.min(...r.dto.variants.map((v) => v.priceMinor)), r.dto.currency, r.dto.processingDays)
        items.push(...feedItemsFor(base, seoProductInput(r.dto, r.brand, { categoryName: categoryName(cats, r.dto.category), releaseAt: releases.get(r.dto.id) ?? null, shipping }), now))
      }
    }
    return { items, generatedAt: now.toISOString(), base }
  })
}

/* ---------- llms.txt ---------- */

/** The facts llms.txt and llms-full.txt are written from, built at most once per LLMS_TTL_MS. */
export async function llmsInput(): Promise<LlmsInput> {
  await requestScope()
  const base = publicOrigin()
  return memo(`seo:llms:${base}`, LLMS_TTL_MS, async () => {
    const d = await db()
    const cats = await seoCategories()
    const counts = await d
      .select({ brandId: catalogProducts.brandId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(catalogProducts)
      .innerJoin(brands, eq(brands.id, catalogProducts.brandId))
      .where(productPublicWhere())
      .groupBy(catalogProducts.brandId)
    const perBrand = new Map(counts.map((c) => [c.brandId, c.n]))
    const list: LlmsBrand[] = []
    for (let offset: number | null = 0, n = 0; offset !== null && n < 200; n++) {
      const page = await listPublicBrands({ sort: "name", limit: 60, offset })
      for (const b of page.brands) list.push({ name: b.name, handle: b.handle, oneLine: b.story, city: b.city || null, country: b.country || null, productCount: perBrand.get(b.id) ?? 0 })
      offset = page.nextOffset
    }
    return {
      base,
      name: site.name,
      tagline: site.tagline,
      description: site.description,
      categories: cats,
      totals: { brands: list.length, products: counts.reduce((n, c) => n + c.n, 0) },
      brands: list,
      generatedAt: new Date().toISOString(),
    }
  })
}

/* ---------- Sitemap ---------- */

const STATIC_PAGES: { path: string; priority: number; changeFrequency: SitemapEntry["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/shop", priority: 0.9, changeFrequency: "daily" },
  { path: "/brands", priority: 0.9, changeFrequency: "daily" },
  { path: "/drops", priority: 0.8, changeFrequency: "daily" },
  { path: "/categories", priority: 0.7, changeFrequency: "weekly" },
  { path: "/charts", priority: 0.6, changeFrequency: "weekly" },
  { path: "/around", priority: 0.6, changeFrequency: "weekly" },
  { path: "/sell", priority: 0.8, changeFrequency: "monthly" },
  { path: "/support", priority: 0.4, changeFrequency: "monthly" },
  { path: "/legal/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/refunds", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/seller-agreement", priority: 0.2, changeFrequency: "yearly" },
]

const later = (a: Date | null | undefined, b: Date | null | undefined) => (!a ? (b ?? null) : !b ? a : a > b ? a : b)

/**
 * Every public page: the fixed pages, then each listed brand, live product, category, published
 * collection and public drop, with lastModified. Opens-soon brands and their pieces are not listed
 * (they aren't public), nor drafts, hidden pieces or restricted brands. At most once per SITEMAP_TTL_MS.
 */
export async function sitemapEntries(): Promise<SitemapEntry[]> {
  await requestScope()
  const base = publicOrigin()
  const fixed = () => STATIC_PAGES.map((p): SitemapEntry => ({ url: absoluteUrl(base, p.path), changeFrequency: p.changeFrequency, priority: p.priority }))
  // A failed read isn't memoised (memo drops a rejected load): crawlers get the fixed pages this time.
  return memo(`seo:sitemap:${base}`, SITEMAP_TTL_MS, async () => {
    const out = fixed()
    const d = await db()
    const brandUpdated = new Map<string, Date>()
    const categoryUpdated = new Map<string, Date>()
    const products: SitemapEntry[] = []
    for await (const page of publicCatalogue()) {
      for (const r of page) {
        brandUpdated.set(r.brand.id, later(brandUpdated.get(r.brand.id), r.updatedAt)!)
        categoryUpdated.set(r.dto.category, later(categoryUpdated.get(r.dto.category), r.updatedAt)!)
        products.push({
          url: absoluteUrl(base, `/products/${encodeURIComponent(r.dto.slug)}`),
          lastModified: r.updatedAt.toISOString(),
          changeFrequency: "weekly",
          priority: 0.7,
          images: r.dto.images.slice(0, 5).map((i) => absoluteUrl(base, i.src)),
        })
      }
    }
    // Listed brands (brandListedSql: not restricted or suspended, founding brands once launched, no samples in production).
    const listed = await d
      .select({
        id: brands.id,
        handle: brands.handle,
        launchedAt: brands.launchedAt,
        published: sql<Date | string | null>`(select max(sv.published_at) from ${storefrontVersions} sv where sv.brand_id = ${brands.id})`,
      })
      .from(brands)
      .where(brandListedSql())
      .orderBy(asc(brands.handle))
      .limit(MAX_PRODUCTS)
    const handleOf = new Map(listed.map((b) => [b.id, b.handle]))
    for (const b of listed) {
      const published = b.published ? new Date(b.published) : null
      const last = later(later(published, b.launchedAt), brandUpdated.get(b.id))
      out.push({ url: absoluteUrl(base, `/brands/${encodeURIComponent(b.handle)}`), ...(last ? { lastModified: last.toISOString() } : {}), changeFrequency: "weekly", priority: 0.8 })
    }
    for (const c of await seoCategories()) {
      const last = categoryUpdated.get(c.slug)
      out.push({ url: absoluteUrl(base, `/categories/${encodeURIComponent(c.slug)}`), ...(last ? { lastModified: last.toISOString() } : {}), changeFrequency: "daily", priority: 0.7 })
    }
    const collections = await d
      .select({ handle: catalogCollections.handle, brandId: catalogCollections.brandId, updatedAt: catalogCollections.updatedAt })
      .from(catalogCollections)
      .innerJoin(brands, eq(brands.id, catalogCollections.brandId))
      .where(and(eq(catalogCollections.status, "published"), brandListedSql()))
      .orderBy(asc(catalogCollections.brandId), asc(catalogCollections.position))
      .limit(MAX_PRODUCTS)
    for (const c of collections) {
      const handle = handleOf.get(c.brandId)
      if (!handle) continue
      out.push({
        url: absoluteUrl(base, `/brands/${encodeURIComponent(handle)}/collections/${encodeURIComponent(c.handle)}`),
        lastModified: c.updatedAt.toISOString(),
        changeFrequency: "weekly",
        priority: 0.6,
      })
    }
    for (const drop of await publicDropPages()) {
      if (!handleOf.has(drop.brandId)) continue
      out.push({ url: absoluteUrl(base, `/drops/${encodeURIComponent(drop.slug)}`), lastModified: drop.updatedAt.toISOString(), changeFrequency: "daily", priority: 0.7 })
    }
    out.push(...products)
    return out
  }).catch((e: unknown) => {
    log.error("[yard] sitemap: catalogue read failed", e)
    return fixed()
  })
}
