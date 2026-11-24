/**
 * "Ask the brand" on a sold-out piece (PDP, quick add): a message to the brand with the piece
 * attached and this text in the composer, editable before it's sent. Pure, shared by the entry
 * button, the inbox composer and the tests.
 */

/** The `ask` query value /inbox reads to prefill the availability question once. */
export const ASK_AVAILABILITY = "availability"

/** "Hi! Is the Okarun Tee (Size M) available, or coming back soon?" */
export function askAvailabilityText(productName: string, variantLabel?: string | null) {
  const name = productName.trim() || "this piece"
  const label = variantLabel?.trim()
  return `Hi! Is the ${name}${label ? ` (${label})` : ""} available, or coming back soon?`
}

/** /inbox?brand=…&product=…[&variant=…]&ask=availability: the brand's thread with the piece and the question ready. */
export function askBrandHref(brand: { handle: string }, productId: string, variantId?: string | null) {
  const q = new URLSearchParams({ brand: brand.handle, product: productId })
  if (variantId) q.set("variant", variantId)
  q.set("ask", ASK_AVAILABILITY)
  return `/inbox?${q.toString()}`
}
