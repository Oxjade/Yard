import "server-only"
import { checkLate as runLateCheck } from "./late"
import { recomputeOrder } from "./orders"
import { invalidateShippingCache } from "./profile"

/**
 * Shipping contract (§1.8, §6.5). Cluster D's implementation: the estimate engine
 * (src/lib/shipping), the provider abstraction (manual rates plus a carrier stub), quotes, order
 * registration, shipment events and delivery complaints.
 */
export const IMPL: string = "D-2026-11-06"

/** Hourly: marks orders past their ship-by or arrival dates late, notifies once, and raises admin delivery issues (§6.5). */
export async function checkLate(): Promise<void> {
  await runLateCheck()
}

/** Recomputes an order's delivery estimate after a shipment event or profile change (stores a row only when it changed). */
export async function recompute(orderRefId: string, reason: string): Promise<void> {
  await recomputeOrder(orderRefId, reason)
}

/** Drops the cached profiles and holidays, e.g. after Yard edits a holiday (Admin › Delivery › Holidays). */
export function invalidate(brandId?: string) {
  invalidateShippingCache(brandId)
}

/**
 * Hourly (couriers, docs/SHIPPING.md): asks the provider about booked shipments with no news for
 * 6 hours, checks the wallet balance (Admin is told once a day when it's low) and drops expired
 * rate quotes. Nothing runs while YARD_SHIPPING_PROVIDER is off.
 */
export async function courierHourly(): Promise<void> {
  const { getCourier } = await import("./providers")
  if (!getCourier()) return
  const { syncCourierShipments } = await import("./courier-book")
  const { checkCourierWallet } = await import("./courier-admin")
  const { purgeOldCourierQuotes } = await import("./courier-quote")
  await syncCourierShipments()
  await checkCourierWallet()
  await purgeOldCourierQuotes()
}

export const jobs = { checkLate, courierHourly }
