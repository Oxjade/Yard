"use client"

import { brandById } from "@/lib/data/brands"
import { productById, variantById } from "@/lib/data/products"
import type { Product } from "@/lib/data/types"
import { catalogBrand, toCatalogProduct, type PublicCatalogProduct } from "./catalog-products"

/**
 * Products that exist only in the live catalogue (created in Studio, or every product when the
 * sample seed is off) are unknown to the bundled sample maps that the bag, its count, the shipping
 * quote and checkout resolve lines through. In the browser they are added to those maps once seen
 * (a product page, the shop listing) or fetched for the lines the server cart returns. Sample ids
 * are never replaced, and the brand storefront map (brandByHandle) is left alone, so brand links
 * still know which brands have a storefront page.
 *
 * Browser only: on the server these maps are shared by every request.
 */
export function registerLiveProducts(products: Product[]) {
  if (typeof window === "undefined") return 0
  let added = 0
  for (const p of products) {
    if (productById.has(p.id)) continue
    productById.set(p.id, p)
    for (const v of p.variants) variantById.set(v.id, { product: p, variant: v })
    if (!brandById.has(p.brandId)) brandById.set(p.brandId, catalogBrand(p))
    added++
  }
  return added
}

/** Fetches live products by id (for cart lines the sample maps don't know) and registers them. */
export async function loadLiveProducts(ids: string[]) {
  const unknown = [...new Set(ids)].filter((id) => !productById.has(id))
  let added = 0
  for (let i = 0; i < unknown.length; i += 60) {
    const chunk = unknown.slice(i, i + 60)
    const query = new URLSearchParams({ limit: "60" })
    for (const id of chunk) query.append("ids", id)
    const response = await fetch(`/api/catalog/products?${query}`, { credentials: "same-origin" })
    if (!response.ok) throw new Error("The cart's products could not be loaded.")
    const page = (await response.json()) as { products: PublicCatalogProduct[] }
    added += registerLiveProducts(page.products.map(toCatalogProduct))
  }
  return added
}
