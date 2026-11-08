import "server-only"
import { dropWindow } from "@/lib/drops"
import { db } from "../db"
import { dropItems, drops } from "../db/schema/engagement"
import type { SeedModule } from "../db/seed/types"
import { newDrawSeed } from "./draw"

/**
 * seed:drops — the sample drops (src/lib/data/catalog) as rows with absolute UTC times, resolved
 * from each drop's local release (lib/drops dropWindow) at seed time. Ids are kept, so existing
 * shopper_reminders rows and chart events still point at them. Variants come from the sample
 * products. Register after `brands` (and after CATALOG's seed, if it renames variant ids).
 */
const ACCESS = { "first-come": "first_come", draw: "draw", "early-access": "early_access" } as const

const seed: SeedModule = {
  key: "seed:drops",
  version: 1,
  requires: ["brands:b_null_form", "brands:b_lagos_static"],
  async run(ctx) {
    const d = await db()
    const now = ctx.now.getTime()
    const productById = new Map(ctx.products.map((p) => [p.id, p]))
    for (const s of ctx.drops) {
      const { release, end } = dropWindow(s, now)
      const startsAt = new Date(release)
      const endsAt = new Date(end)
      const access = ACCESS[s.access]
      const status = now < release ? "scheduled" : now < end ? "live" : "ended"
      const drawSeed = access === "draw" ? newDrawSeed() : null
      const earlyAccessAt = access === "early_access" ? new Date(release - 24 * 3_600_000) : null
      const inserted = await d
        .insert(drops)
        .values({
          id: s.id,
          brandId: s.brandId,
          slug: s.slug,
          name: s.name,
          description: s.description,
          image: s.image.src,
          access,
          status,
          startsAt,
          endsAt,
          earlyAccessAt,
          entryClosesAt: access === "draw" ? startsAt : null,
          limitPerCustomer: s.limitPerCustomer,
          totalUnits: s.totalUnits,
          sponsored: !!s.sponsored,
          drawSeed: drawSeed?.seed ?? null,
          drawSeedHash: drawSeed?.hash ?? null,
          // Past moments are marked done so a fresh seed never sends old reminders.
          reminderSentAt: status === "scheduled" ? null : startsAt,
          earlyAccessSentAt: earlyAccessAt && earlyAccessAt.getTime() <= now ? earlyAccessAt : null,
          startedAt: status === "scheduled" ? null : startsAt,
          endedAt: status === "ended" ? endsAt : null,
          createdBy: "seed",
        })
        .onConflictDoNothing()
        .returning({ id: drops.id })
      if (!inserted.length) continue
      const items = s.productIds.flatMap((pid) => (productById.get(pid)?.variants ?? []).map((v) => ({ dropId: s.id, productId: pid, variantId: v.id })))
      if (items.length) await d.insert(dropItems).values(items).onConflictDoNothing()
    }
  },
}

export default seed
