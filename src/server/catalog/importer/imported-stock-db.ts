import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { availableUncounted, IMPORT_PLATFORM_LABELS, type ImportPlatform, type ImportProductDto } from "../../../lib/api/contracts/imports"
import { catalogOptions, catalogProducts, catalogVariants, productProposals, stockMovements } from "../../db/schema/catalog"
import { catalogImportItems, catalogImports, catalogSitePieces } from "../../db/schema/imports"
import { urlKey, variantLabel } from "./normalize"

/*
 * Admin › Brands › Products › "Mark imported products as available (stock not tracked)": the fix
 * for products imported before the importer learnt that "available, no count" (Shopify,
 * WooCommerce, a Bumpa product that doesn't manage stock) means in stock. Those came in with 0, so
 * they showed as sold out. No server-only and a Db parameter: the tests run it on a real database.
 *
 * A variant is marked only when all of these hold, so nothing the brand or a shopper did is undone
 * and no stock is faked:
 *   - it belongs to a product that came from this brand's website (an import or an approved piece);
 *   - it is active, tracked, at 0 with nothing held, and has never had a stock movement (no count
 *     was ever set, nothing was ever sold);
 *   - what the site showed says it can be bought without a count (availableUncounted), the admin
 *     didn't type a count for it at import, and the site hasn't since been seen sold out.
 */

export type Db = PgDatabase<PgQueryResultHKT, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export type ImportedStockPlan = {
  /** Where the products came from, by platform label ("Shopify"), from the brand's imports. */
  platforms: string[]
  /** Products imported from the brand's site that are still in the catalogue. */
  imported: number
  products: string[]
  variants: string[]
  skipped: { soldOutOnSite: number; countOnSite: number; stockSetInYard: number; unknown: number }
}

type Source = { product: ImportProductDto | null; typed: Record<string, number>; soldOutNow: boolean }

/** The plan for one brand: which variants would become "available, stock not tracked", and why the rest stay. */
export async function planImportedStock(d: Db, brandId: string): Promise<ImportedStockPlan> {
  const imports = await d.select({ id: catalogImports.id, platform: catalogImports.platform, found: catalogImports.found }).from(catalogImports).where(eq(catalogImports.brandId, brandId)).orderBy(asc(catalogImports.createdAt))
  // What each import's scan found, by key and by address (a later scan wins).
  const foundByKey = new Map<string, ImportProductDto>()
  const foundByUrl = new Map<string, ImportProductDto>()
  for (const imp of imports) {
    for (const raw of imp.found ?? []) {
      const p = raw as unknown as ImportProductDto
      if (!p || typeof p !== "object" || !Array.isArray(p.variants)) continue
      foundByKey.set(`${imp.id}:${p.key}`, p)
      if (p.sourceUrl) foundByUrl.set(urlKey(p.sourceUrl), p)
    }
  }

  // Products that came from the site: import items (through their accepted suggestion) and pieces.
  const sources = new Map<string, Source>()
  const items = await d
    .select({ importId: catalogImportItems.importId, key: catalogImportItems.key, sourceUrl: catalogImportItems.sourceUrl, choice: catalogImportItems.choice, productId: productProposals.productId })
    .from(catalogImportItems)
    .innerJoin(productProposals, eq(productProposals.id, catalogImportItems.proposalId))
    .where(and(eq(catalogImportItems.brandId, brandId), isNotNull(productProposals.productId)))
  for (const it of items) {
    const typed = (it.choice as { stock?: Record<string, number> } | null)?.stock ?? {}
    sources.set(it.productId!, { product: foundByKey.get(`${it.importId}:${it.key}`) ?? foundByUrl.get(urlKey(it.sourceUrl)) ?? null, typed, soldOutNow: false })
  }
  const pieces = await d
    .select({ sourceUrl: catalogSitePieces.sourceUrl, product: catalogSitePieces.product, change: catalogSitePieces.change, productId: catalogSitePieces.productId, proposalProductId: productProposals.productId })
    .from(catalogSitePieces)
    .leftJoin(productProposals, eq(productProposals.id, catalogSitePieces.proposalId))
    .where(and(eq(catalogSitePieces.brandId, brandId), inArray(catalogSitePieces.status, ["imported", "approved"])))
  for (const pc of pieces) {
    const productId = pc.productId ?? pc.proposalProductId
    if (!productId) continue
    const soldOutNow = !!(pc.change as { soldOut?: boolean } | null)?.soldOut
    const prev = sources.get(productId)
    const product = prev?.product ?? (pc.product as unknown as ImportProductDto | null) ?? foundByUrl.get(urlKey(pc.sourceUrl)) ?? null
    sources.set(productId, { product, typed: prev?.typed ?? {}, soldOutNow })
  }

  const plan: ImportedStockPlan = {
    platforms: [...new Set(imports.map((i) => i.platform).filter((p): p is ImportPlatform => !!p && p in IMPORT_PLATFORM_LABELS))].map((p) => IMPORT_PLATFORM_LABELS[p]),
    imported: 0,
    products: [],
    variants: [],
    skipped: { soldOutOnSite: 0, countOnSite: 0, stockSetInYard: 0, unknown: 0 },
  }
  const productIds = [...sources.keys()]
  if (!productIds.length) return plan

  const [products, options, variants, moved] = await Promise.all([
    d.select({ id: catalogProducts.id }).from(catalogProducts).where(and(inArray(catalogProducts.id, productIds), eq(catalogProducts.brandId, brandId), ne(catalogProducts.status, "archived"))),
    d.select({ productId: catalogOptions.productId, name: catalogOptions.name, position: catalogOptions.position }).from(catalogOptions).where(inArray(catalogOptions.productId, productIds)).orderBy(asc(catalogOptions.position)),
    d
      .select({ id: catalogVariants.id, productId: catalogVariants.productId, options: catalogVariants.options, onHand: catalogVariants.onHand, held: catalogVariants.held, trackStock: catalogVariants.trackStock })
      .from(catalogVariants)
      .where(and(inArray(catalogVariants.productId, productIds), eq(catalogVariants.brandId, brandId), eq(catalogVariants.status, "active")))
      .orderBy(asc(catalogVariants.productId), asc(catalogVariants.id)),
    d.selectDistinct({ variantId: stockMovements.variantId }).from(stockMovements).innerJoin(catalogVariants, eq(catalogVariants.id, stockMovements.variantId)).where(inArray(catalogVariants.productId, productIds)),
  ])
  const live = new Set(products.map((p) => p.id))
  const hasMoves = new Set(moved.map((m) => m.variantId))
  const orderOf = new Map<string, string[]>()
  for (const o of options) orderOf.set(o.productId, [...(orderOf.get(o.productId) ?? []), o.name])
  plan.imported = live.size

  const marked = new Set<string>()
  for (const v of variants) {
    if (!live.has(v.productId) || !v.trackStock) continue
    const src = sources.get(v.productId)!
    if (v.onHand !== 0 || v.held !== 0 || hasMoves.has(v.id)) {
      if (v.onHand === 0) plan.skipped.stockSetInYard++
      continue
    }
    const p = src.product
    const label = variantLabel(v.options, orderOf.get(v.productId) ?? [])
    if (src.soldOutNow || p?.availability === "out_of_stock") {
      plan.skipped.soldOutOnSite++
      continue
    }
    if (label in src.typed) {
      // The admin typed a count at import (a 0 there means sold out); it's theirs, not the site's.
      plan.skipped.stockSetInYard++
      continue
    }
    if (!p) {
      plan.skipped.unknown++
      continue
    }
    const order = p.options.map((o) => o.name)
    const site = p.variants.find((x) => variantLabel(x.options, order) === label)
    // A size the admin added at import has no row on the site: the product's own availability decides.
    const verdict = site ? availableUncounted(site, p.availability) : p.availability === "in_stock"
    if (site?.available === false) plan.skipped.soldOutOnSite++
    else if (site && site.stock != null) plan.skipped.countOnSite++
    else if (!verdict) plan.skipped.unknown++
    else {
      plan.variants.push(v.id)
      marked.add(v.productId)
    }
  }
  plan.products = [...marked]
  return plan
}

/**
 * Applies a plan made in the same transaction: each variant flips only while it is still at 0,
 * holds nothing and is tracked (a sale or a count since the plan leaves it alone). Returns the
 * variants and products changed.
 */
export async function applyImportedStock(d: Db, brandId: string, plan: ImportedStockPlan, now = new Date()) {
  if (!plan.variants.length) return { variants: [] as string[], products: [] as string[] }
  const rows = await d
    .update(catalogVariants)
    .set({ trackStock: false, updatedAt: now })
    .where(and(inArray(catalogVariants.id, plan.variants), eq(catalogVariants.brandId, brandId), eq(catalogVariants.trackStock, true), eq(catalogVariants.onHand, 0), eq(catalogVariants.held, 0), sql`not exists (select 1 from catalog_stock_movements sm where sm.variant_id = ${catalogVariants.id})`))
    .returning({ id: catalogVariants.id, productId: catalogVariants.productId })
  return { variants: rows.map((r) => r.id), products: [...new Set(rows.map((r) => r.productId))] }
}
