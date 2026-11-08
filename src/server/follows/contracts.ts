import { z } from "zod"
import { currencyCodes } from "@/config/markets"
import { safeId } from "@/lib/api/contracts/common"

/** ENGAGEMENT request contracts for follows, wishlist, search and notification preferences (zod 4, strict bodies). */

export const followBody = z.strictObject({ brandId: safeId() })
export const followCountsQuery = z.object({ brandIds: z.array(safeId()).min(1).max(100) })
export const wishlistBody = z.strictObject({ productId: safeId() })
export const mergeSavedBody = z.strictObject({ productIds: z.array(safeId()).max(200).default([]), brandIds: z.array(safeId()).max(200).default([]) })
export const backInStockBody = z.strictObject({ variantId: safeId() })

export const searchQuery = z.object({
  q: z.string().max(200).optional(),
  category: safeId().optional(),
  brandIds: z.array(safeId()).max(20).optional(),
  minPrice: z.coerce.number().int().min(0).max(1_000_000_000_000).optional(),
  maxPrice: z.coerce.number().int().min(0).max(1_000_000_000_000).optional(),
  currency: z.enum(currencyCodes as [string, ...string[]]).default("USD"),
  inStock: z
    .enum(["1", "0", "true", "false"])
    .transform((v) => v === "1" || v === "true")
    .optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest"]).optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
  cursor: z.string().max(10).regex(/^\d+$/).optional(),
})
export const suggestQuery = z.object({ q: z.string().max(100).default("") })

const prefFlags = z.strictObject({ drops: z.boolean().optional(), price_drops: z.boolean().optional(), back_in_stock: z.boolean().optional(), brand_news: z.boolean().optional() })
export const preferencesPatchBody = z.strictObject({ email: prefFlags.optional(), inApp: prefFlags.optional() })
export const prefsQuery = z.object({ as: z.enum(["shopper", "brand", "admin"]) })
export const unsubscribeQuery = z.object({ token: z.string().min(10).max(600) })
