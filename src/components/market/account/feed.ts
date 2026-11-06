import { collections, drops, productById, products, stories } from "@/lib/data"
import { hash } from "@/lib/data/seed"
import { initialDropPhase } from "@/lib/drops"
import type { Collection, Drop, Product, Story } from "@/lib/data/types"
import { DEMO_NOW, daysSince } from "./format"

/**
 * The Following feed, built from the data layer: new pieces, collections, drops and
 * stories from the brands a shopper follows. Bursts of new pieces from one brand are
 * collapsed into one update per week, as the backend's feed_items will be.
 */

export type FeedKind = "products" | "collection" | "drop" | "story"

type Base = { id: string; brandId: string; at: string }
export type FeedItem =
  | (Base & { kind: "products"; products: Product[] })
  | (Base & { kind: "collection"; collection: Collection; products: Product[] })
  | (Base & { kind: "drop"; drop: Drop; event: "announced" | "live" | "released" })
  | (Base & { kind: "story"; story: Story })

const HOUR = 3_600_000
const WINDOW_DAYS = 120

export function buildFeed(brandIds: string[]): FeedItem[] {
  const following = new Set(brandIds)
  const items: FeedItem[] = []

  const weeks = new Map<string, Product[]>()
  for (const p of products) {
    if (!following.has(p.brandId) || p.status !== "published") continue
    const age = daysSince(p.createdAt)
    if (age > 90) continue
    const key = `${p.brandId}:${Math.floor(Math.max(0, age) / 7)}`
    weeks.set(key, [...(weeks.get(key) ?? []), p])
  }
  for (const [key, list] of weeks) {
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    items.push({ kind: "products", id: `new-${key}`, brandId: sorted[0].brandId, at: sorted[0].createdAt, products: sorted })
  }

  for (const c of collections) {
    if (!following.has(c.brandId)) continue
    const list = c.productIds.map((id) => productById.get(id)).filter((p): p is Product => !!p)
    if (!list.length) continue
    const at = list.map((p) => p.createdAt).sort().at(-1)!
    if (daysSince(at) > WINDOW_DAYS) continue
    items.push({ kind: "collection", id: `col-${c.id}`, brandId: c.brandId, at, collection: c, products: list })
  }

  for (const d of drops) {
    if (!following.has(d.brandId)) continue
    const phase = initialDropPhase(d)
    // Upcoming drops are announced a few days ahead; released ones are dated by their release.
    const at = phase === "upcoming" ? DEMO_NOW - (1 + (hash(d.id) % 4)) * 24 * HOUR : DEMO_NOW + d.releaseOffsetHours * HOUR
    const iso = new Date(at).toISOString()
    if (daysSince(iso) > WINDOW_DAYS) continue
    items.push({ kind: "drop", id: `drop-${d.id}`, brandId: d.brandId, at: iso, drop: d, event: phase === "upcoming" ? "announced" : phase === "live" ? "live" : "released" })
  }

  for (const s of stories) {
    if (!following.has(s.brandId)) continue
    const at = `${s.publishedAt}T09:00:00.000Z`
    if (daysSince(at) > WINDOW_DAYS) continue
    items.push({ kind: "story", id: `story-${s.id}`, brandId: s.brandId, at, story: s })
  }

  return items.sort((a, b) => b.at.localeCompare(a.at))
}
