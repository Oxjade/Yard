import { site } from "@/config/site"
import { brands, brandCode } from "@/lib/data/brands"

/**
 * The platform's working name before it was called `site.name`. Wording the stores saved as text
 * before the rename (a decision on an order's timeline, a notification's title and body) still
 * spells it; each store's migration puts the current name in its place. Storage keys
 * ("nocturne-…"), event keys and ids keep the old name on purpose, so they never pass through here.
 */
const OLD_NAME = /\bnocturne\b/gi

export const withCurrentName = (text: string) => text.replace(OLD_NAME, site.name)

/** An order with its timeline labels in the current name ("Refund … approved by Yard"). */
export function renameTimeline<T extends { timeline: { label: string }[] }>(order: T): T {
  return { ...order, timeline: order.timeline.map((e) => ({ ...e, label: withCurrentName(e.label) })) }
}

/** Checkout references made before the rename ("NCT-8F2K-91"); they read "YRD-8F2K-91" now. */
const OLD_CHECKOUT = /\bNCT-(?=[0-9A-Z]{2,})/g

/**
 * Sample order references from a brand whose mark has no plain letters, which all read "BR-"
 * ("BR-10431" for Orun Studio's "Ọ"); they read the brand's code now ("OS-10431").
 */
const OLD_BRAND_PREFIX = new Map(
  brands.flatMap((b) => {
    const old = b.mark.text.replace(/[^A-Za-z]/g, "").toUpperCase() || "BR"
    return old === brandCode(b) ? [] : [[old, brandCode(b)] as const]
  }),
)
const OLD_ORDER = OLD_BRAND_PREFIX.size ? new RegExp(`\\b(${[...OLD_BRAND_PREFIX.keys()].join("|")})-(?=\\d{5}\\b)`, "g") : null

/** Order and checkout references in saved text read their current form. Ids never pass through here. */
export function currentReferences(text: string) {
  const checkout = text.replace(OLD_CHECKOUT, "YRD-")
  return OLD_ORDER ? checkout.replace(OLD_ORDER, (_, old: string) => `${OLD_BRAND_PREFIX.get(old)}-`) : checkout
}
