import { z } from "zod"
import { currencyCodes } from "@/config/markets"
import { safeId } from "@/lib/api/contracts/common"

/** ENGAGEMENT request contracts for follows, wishlist, search and notification preferences (zod 4, strict bodies). */

export const followBody = z.strictObject({ brandId: safeId() })
export const followCountsQuery = z.object({ brandIds: z.array(safeId()).min(1).max(100) })
export const wishlistBody = z.strictObject({ productId: safeId() })
export const mergeSavedBody = z.strictObject({ productIds: z.array(safeId()).max(200).default([]), brandIds: z.array(safeId()).max(200).default([]) })
export const backInStockBody = z.strictObject({ variantId: safeId() })

const searchMinor = z.coerce.number().int().min(0).max(1_000_000_000_000)

export const searchQuery = z.object({
  q: z.string().max(200).optional(),
  category: safeId().optional(),
  brand: safeId().optional(),
  brandIds: z.array(safeId()).max(20).optional(),
  min: searchMinor.optional(),
  max: searchMinor.optional(),
  minPrice: searchMinor.optional(),
  maxPrice: searchMinor.optional(),
  currency: z.enum(currencyCodes as [string, ...string[]]).default("USD"),
  inStock: z
    .enum(["1", "0", "true", "false"])
    .transform((v) => v === "1" || v === "true")
    .optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest"]).optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
  cursor: z.string().max(10).regex(/^\d+$/).optional(),
}).superRefine((query, ctx) => {
  if (query.brand && query.brandIds?.length) ctx.addIssue({ code: "custom", path: ["brand"], message: "Use brand or brandIds, not both." })
  if (query.min != null && query.minPrice != null && query.min !== query.minPrice) ctx.addIssue({ code: "custom", path: ["min"], message: "Use min or minPrice, not conflicting values." })
  if (query.max != null && query.maxPrice != null && query.max !== query.maxPrice) ctx.addIssue({ code: "custom", path: ["max"], message: "Use max or maxPrice, not conflicting values." })
})

export function normalizeSearchQuery(query: z.output<typeof searchQuery>) {
  return {
    brandIds: query.brandIds ?? (query.brand ? [query.brand] : undefined),
    minPrice: query.minPrice ?? query.min,
    maxPrice: query.maxPrice ?? query.max,
  }
}
export const suggestQuery = z.object({ q: z.string().max(100).default("") })

const prefFlags = z.strictObject({ drops: z.boolean().optional(), price_drops: z.boolean().optional(), back_in_stock: z.boolean().optional(), brand_news: z.boolean().optional() })
export const preferencesPatchBody = z.strictObject({ email: prefFlags.optional(), inApp: prefFlags.optional() })
export const prefsQuery = z.object({ as: z.enum(["shopper", "brand", "admin"]) })
export const unsubscribeQuery = z.object({ token: z.string().min(10).max(600) })
