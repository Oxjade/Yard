import { brandById } from "@/lib/data/brands"
import type { Brand, BrandMark, MerchantOrder } from "@/lib/data/types"

/**
 * The brand an order belongs to, for display: a sample brand from the static catalogue when the
 * order is one of the demo's, otherwise the name and handle the server sent with the order (every
 * founding and real brand). `sample` is set only for catalogue brands, whose processing and returns
 * days are known here; null when neither source has the brand (copy then says "the brand").
 */
export type OrderBrand = { name: string; handle: string; mark: BrandMark; logoSrc?: string | null; sample: Brand | null }

/** Up to two initials from a brand name, for the typographic mark when there's no logo. */
export function monogram(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const text = words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "").slice(0, 2)
  return text.toUpperCase() || "Y"
}

export function orderBrand(order: Pick<MerchantOrder, "brandId" | "brand">): OrderBrand | null {
  const sample = brandById.get(order.brandId)
  if (sample) return { name: sample.name, handle: sample.handle, mark: sample.mark, sample }
  if (order.brand?.name) return { name: order.brand.name, handle: order.brand.handle, mark: { text: monogram(order.brand.name), style: "grotesk" }, sample: null }
  return null
}
