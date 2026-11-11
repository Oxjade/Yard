import { z } from "zod"
import { countryCodes, currencyCodes } from "@/config/markets"
import { safeId } from "@/lib/api/contracts/common"

/** ENGAGEMENT request contracts for follows, wishlist, search and notification preferences (zod 4, strict bodies). */

export const followBody = z.strictObject({ brandId: safeId() })
export const followCountsQuery = z.object({ brandIds: z.array(safeId()).min(1).max(100) })
export const wishlistBody = z.strictObject({ productId: safeId() })
export const mergeSavedBody = z.strictObject({ productIds: z.array(safeId()).max(200).default([]), brandIds: z.array(safeId()).max(200).default([]) })
export const backInStockBody = z.strictObject({ variantId: safeId() })

const searchMinor = z.coerce.number().int().min(0).max(1_000_000_000_000)

/** A listing's filters (everything a search narrows by except its words), shared by search and suggest. */
const searchScopeFields = {
  category: safeId().optional(),
  subcategory: z.string().max(60).optional(),
  brand: safeId().optional(),
  brandIds: z.array(safeId()).max(20).optional(),
  brandHandles: z.string().max(1300).optional(),
  sizes: z.string().max(300).optional(),
  country: z.enum(countryCodes as [string, ...string[]]).optional(),
  min: searchMinor.optional(),
  max: searchMinor.optional(),
  minPrice: searchMinor.optional(),
  maxPrice: searchMinor.optional(),
  currency: z.enum(currencyCodes as [string, ...string[]]).default("USD"),
  inStock: z
    .enum(["1", "0", "true", "false"])
    .transform((v) => v === "1" || v === "true")
    .optional(),
}

export const searchQuery = z.object({
  q: z.string().max(200).optional(),
  ...searchScopeFields,
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest", "trending"]).optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
  cursor: z.string().max(10).regex(/^\d+$/).optional(),
  /** Next page of the brand facet (its `brandsNextCursor`). */
  brandCursor: z.string().max(6).regex(/^\d+$/).optional(),
}).superRefine((query, ctx) => {
  if (query.brand && query.brandIds?.length) ctx.addIssue({ code: "custom", path: ["brand"], message: "Use brand or brandIds, not both." })
  if (query.min != null && query.minPrice != null && query.min !== query.minPrice) ctx.addIssue({ code: "custom", path: ["min"], message: "Use min or minPrice, not conflicting values." })
  if (query.max != null && query.maxPrice != null && query.max !== query.maxPrice) ctx.addIssue({ code: "custom", path: ["max"], message: "Use max or maxPrice, not conflicting values." })
})

export function normalizeSearchQuery(query: Pick<z.output<typeof searchQuery>, "brand" | "brandIds" | "brandHandles" | "sizes" | "min" | "max" | "minPrice" | "maxPrice">) {
  return {
    brandIds: query.brandIds ?? (query.brand ? [query.brand] : undefined),
    brandHandles: query.brandHandles?.split(",").map((handle) => handle.trim()).filter(Boolean).slice(0, 20),
    sizes: query.sizes?.split(",").map((size) => size.trim()).filter(Boolean).slice(0, 12),
    minPrice: query.minPrice ?? query.min,
    maxPrice: query.maxPrice ?? query.max,
  }
}
/** `scoped=1` adds per-completion counts within the listing's filters (the other fields). */
export const suggestQuery = z.object({ q: z.string().max(100).default(""), scoped: z.enum(["1"]).optional(), ...searchScopeFields })

const prefFlags = z.strictObject({ drops: z.boolean().optional(), price_drops: z.boolean().optional(), back_in_stock: z.boolean().optional(), brand_news: z.boolean().optional() })
export const preferencesPatchBody = z.strictObject({ email: prefFlags.optional(), inApp: prefFlags.optional() })
export const prefsQuery = z.object({ as: z.enum(["shopper", "brand", "admin"]) })
export const unsubscribeQuery = z.object({ token: z.string().min(10).max(600) })
