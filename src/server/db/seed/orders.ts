import "server-only"
import { sql } from "drizzle-orm"
import { customerCheckoutGroups } from "@/lib/data/orders"
import type { MerchantOrder } from "@/lib/data/types"
import { orderGroups, orderRefs } from "../schema"
import { db } from "../tx"
import type { SeedModule } from "./types"

const excluded = (column: string) => sql.raw(`excluded.${column}`)

/** "Express, international" → express. Sample orders are standard otherwise. */
const serviceOf = (o: MerchantOrder) => (/express/i.test(o.shippingMethod) ? "express" : "standard")

/**
 * Orders (F1): raw rows only, no engine (§1.5, Appendix D). One order_group per distinct sample
 * group id, and an order_ref per sample merchant order plus Ada's own history. Historical rows
 * keep DEMO_TODAY (2026-11-05) as their anchor.
 */
const seed: SeedModule = {
  key: "seed:orders",
  version: 1,
  async run(ctx) {
    const d = await db()
    const all = [...ctx.merchantOrders, ...ctx.customerOrders]
    const groupRefs = new Map(customerCheckoutGroups.map((g) => [g.id, g.reference]))
    const groups = new Map<string, { id: string; customerId: string; reference: string; createdAt: Date }>()
    for (const o of all) {
      if (groups.has(o.groupId)) continue
      // Sample merchant groups have no checkout reference of their own: a stable one is derived.
      const reference = groupRefs.get(o.groupId) ?? `YRD-S${o.groupId.replace(/^cg_/, "").toUpperCase()}`
      groups.set(o.groupId, { id: o.groupId, customerId: o.customerId, reference, createdAt: new Date(o.placedAt) })
    }
    await d
      .insert(orderGroups)
      .values([...groups.values()])
      .onConflictDoUpdate({ target: orderGroups.id, set: { reference: excluded("reference"), customerId: excluded("customer_id") } })

    const rows = all.map((o) => ({
      id: o.id,
      groupId: o.groupId,
      reference: o.reference,
      brandId: o.brandId,
      customerId: o.customerId,
      placedAt: new Date(o.placedAt),
      status: o.status,
      paid: o.paymentStatus !== "pending" && o.paymentStatus !== "failed",
      currency: o.currency,
      subtotalMinor: o.subtotal,
      shippingMinor: o.shipping,
      totalMinor: o.total,
      items: o.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, name: l.name, qty: l.quantity, unitMinor: l.unitPrice })),
      shipToCountry: o.shippingAddress.country,
      shipToCity: o.shippingAddress.city,
      service: serviceOf(o),
      quoted: null,
      source: "seed",
    }))
    for (let i = 0; i < rows.length; i += 200) {
      await d
        .insert(orderRefs)
        .values(rows.slice(i, i + 200))
        .onConflictDoUpdate({
          target: orderRefs.id,
          set: {
            status: excluded("status"),
            paid: excluded("paid"),
            placedAt: excluded("placed_at"),
            totalMinor: excluded("total_minor"),
            subtotalMinor: excluded("subtotal_minor"),
            shippingMinor: excluded("shipping_minor"),
            items: excluded("items"),
          },
        })
    }
  },
}

export default seed
