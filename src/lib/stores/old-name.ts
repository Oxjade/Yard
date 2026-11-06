import { site } from "@/config/site"

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
