import "server-only"
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm"
import type { AdminCouriersDto } from "@/lib/api/contracts/shipping"
import { formatMoney } from "@/lib/money"
import type { CurrencyCode } from "@/config/markets"
import { db } from "../db"
import { brands, orderRefs } from "../db/schema"
import { courierEvents, courierShipments } from "../db/schema/courier"
import { ledgerAccounts } from "../db/schema/ledger"
import { PLATFORM } from "../ledger/core"
import { newId } from "../ids"
import { log } from "../log"
import { notifyAdmins } from "../notify"
import { noteCourierFailure } from "./courier-quote"
import { courierConfig, getCourier } from "./providers"
import type { WalletBalance } from "./providers/courier-types"

/**
 * Admin › Delivery › Couriers (docs/SHIPPING.md): booked shipments, courier money (collected vs
 * spent, from the ledger), provider failures and the wallet balance (read-only). The wallet is read
 * at most once a minute per process, whatever the number of admins.
 */

let walletCache: { at: number; value: AdminCouriersDto["wallet"] } | null = null

async function wallet(force = false): Promise<AdminCouriersDto["wallet"]> {
  const p = getCourier()
  if (!p?.walletBalance) return null
  if (!force && walletCache && Date.now() - walletCache.at < (walletCache.value && "error" in walletCache.value ? 20_000 : 60_000)) return walletCache.value
  const cfg = courierConfig()
  let value: AdminCouriersDto["wallet"]
  try {
    const w: WalletBalance = await p.walletBalance()
    value = { amountMinor: w.amountMinor, currency: w.currency, low: w.amountMinor < cfg.walletLowMinor, lowAtMinor: cfg.walletLowMinor, readAt: new Date().toISOString() }
  } catch (e) {
    await noteCourierFailure(p.id, "wallet_failed", e)
    value = { error: `${p.label} didn't return the wallet balance.` }
  }
  walletCache = { at: Date.now(), value }
  return value
}

export async function adminCouriers(): Promise<AdminCouriersDto> {
  const p = getCourier()
  const cfg = courierConfig()
  const d = await db()
  const accounts = await d
    .select({ kind: ledgerAccounts.kind, currency: ledgerAccounts.currency, b: ledgerAccounts.balanceMinor })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerKind, "platform"), eq(ledgerAccounts.ownerId, PLATFORM), inArray(ledgerAccounts.kind, ["shipping_collected", "shipping_spent"])))
  const currencies = [...new Set(accounts.map((a) => a.currency))].sort()
  const counts = await d.select({ status: courierShipments.status, n: sql<number>`count(*)::int`.mapWith(Number) }).from(courierShipments).groupBy(courierShipments.status)
  const rows = await d
    .select({ s: courierShipments, reference: orderRefs.reference, brand: brands.name })
    .from(courierShipments)
    .innerJoin(orderRefs, eq(orderRefs.id, courierShipments.orderRefId))
    .innerJoin(brands, eq(brands.id, courierShipments.brandId))
    .orderBy(desc(courierShipments.updatedAt))
    .limit(100)
  const failures = await d.select().from(courierEvents).where(ne(courierEvents.kind, "webhook")).orderBy(desc(courierEvents.createdAt)).limit(50)
  return {
    provider: p ? { id: p.id, label: p.label, sandbox: p.sandbox } : null,
    wallet: await wallet(),
    absorbCapMinor: cfg.absorbCapMinor,
    totals: currencies.map((c) => ({
      currency: c,
      collectedMinor: accounts.find((a) => a.currency === c && a.kind === "shipping_collected")?.b ?? 0,
      spentMinor: accounts.find((a) => a.currency === c && a.kind === "shipping_spent")?.b ?? 0,
    })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    shipments: rows.map(({ s, reference, brand }) => ({
      id: s.id,
      orderId: s.orderRefId,
      reference,
      brand,
      status: s.status,
      courierName: s.courierName,
      trackingCode: s.trackingCode,
      trackingUrl: s.trackingUrl,
      labelUrl: s.labelUrl,
      currency: s.currency,
      collectedMinor: s.collectedMinor,
      costMinor: s.costMinor,
      priceDiffMinor: s.priceDiffMinor,
      requoted: s.requoted,
      overCap: s.overCap,
      error: s.error,
      bookedAt: s.bookedAt?.toISOString() ?? null,
      updatedAt: s.updatedAt.toISOString(),
    })),
    failures: failures.map((f) => ({ id: f.id, kind: f.kind, detail: f.detail, orderId: f.orderRefId, at: f.createdAt.toISOString() })),
  }
}

/** Hourly: reads the wallet and alerts admins once a day while it's under YARD_COURIER_WALLET_LOW. */
export async function checkCourierWallet(now = Date.now()) {
  const p = getCourier()
  if (!p?.walletBalance) return { checked: false }
  const w = await wallet(true)
  if (!w || "error" in w || !w.low) return { checked: true, low: false }
  const day = new Date(now).toISOString().slice(0, 10)
  const d = await db()
  const amount = (() => {
    try {
      return formatMoney(w.amountMinor, w.currency as CurrencyCode)
    } catch {
      return `${(w.amountMinor / 100).toFixed(2)} ${w.currency}`
    }
  })()
  const [row] = await d
    .insert(courierEvents)
    .values({ id: newId("cev"), provider: p.id, kind: "wallet_low", eventKey: `wallet_low:${p.id}:${day}`, detail: `${p.label} wallet at ${amount}, under the alert line. Top it up so pickups can be booked.` })
    .onConflictDoNothing()
    .returning({ id: courierEvents.id })
  if (row) {
    await notifyAdmins("shipping.view", { key: `courier-wallet-low:${day}`, template: "delivery.courier_wallet_low", vars: { amount, provider: p.label }, href: "/admin/delivery#couriers" })
    log.warn(`[yard] couriers: ${p.label} wallet is low (${amount})`)
  }
  return { checked: true, low: true }
}
