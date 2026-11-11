import { variantById } from "@/lib/data/products"
import { isSampleVariant } from "@/lib/data/sample-ids"
import { sampleDataOff } from "@/lib/sample-switch"
import type { CartLine } from "@/lib/stores/cart"

/**
 * Pieces in the bag that still resolve to a product variant: what the bag drawer, the bag page
 * and checkout actually list. A saved line whose piece has left the catalogue isn't shown
 * anywhere, so it isn't counted either, and the header never says "1 item" over an empty bag.
 */
export function bagCount(lines: readonly CartLine[]) {
  // Production never counts a piece of the sample catalogue (the cart store drops them too).
  const off = sampleDataOff()
  let n = 0
  for (const l of lines) if (variantById.has(l.variantId) && !(off && isSampleVariant(l.variantId))) n += l.quantity
  return n
}
