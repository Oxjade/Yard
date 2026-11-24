import "server-only"
import { readFileSync } from "node:fs"
import { eq } from "drizzle-orm"
import { afterCommit, db, type Executor } from "../db"
import { brands, orderRefs } from "../db/schema"
import { orderStates } from "../db/schema/orders-v3"
import { log } from "../log"
import { countEvent } from "../monitoring/minutes"
import { yard } from "../state"
import { ApnsClient } from "./apns"
import { readApnsConfig, type ApnsConfig } from "./apns-core"
import { ordersWithTokens, startTokensFor, updateTokensFor, type Db, type TokenRow } from "./live-activity-db"
import { pushToTokens, type OrderSnapshot, type SendHooks } from "./live-activity-send"
import { liveActivityFor } from "./live-activity-state"

/**
 * iOS order-tracking Live Activity pushes, straight to APNs (not FCM): docs/APP.md › Live Activity
 * push, ios/Docs/live-activity.md.
 *
 * Whenever an order's delivery changes (a brand's shipment update, the courier webhook or poll, a
 * cancellation or return from anyone, the hourly late check), queueLiveActivityPush(orderId) runs
 * after commit, in the background: it reads that order's activity tokens (one indexed query; with
 * pushes off, not even that), and only when there are some, works out the state exactly as the
 * app does (live-activity-state.ts) in each phone's time zone and sends what changed:
 *   shipped / in transit / arriving soon / out for delivery → `update`;
 *   delivered → `end`, dismissed 2 hours later;
 *   cancelled or returned → `end`, dismissed at once.
 * An order's first shipment with no activity running yet starts one on the shopper's iOS 17.2+
 * phones (push-to-start tokens). A token APNs reports gone (410, BadDeviceToken) is deleted.
 * Counted for Admin › Health: live_activity.sent / .failed / .removed.
 */

type State = { config: ApnsConfig | null; problem: string | null; client?: ApnsClient }

function apns(): State {
  const slots = (yard.slots ??= {})
  return (slots.apnsLive ??= (() => {
    const r = readApnsConfig(process.env, (p) => readFileSync(p, "utf8"))
    return { config: r.config, problem: r.problem }
  })()) as State
}

/** Once at boot (schedulers): one line saying whether Live Activity pushes are on. */
export function logLiveActivityConfig() {
  const s = apns()
  if (s.config) log.once("push:apns-live", "info", `[yard] push: iOS Live Activity pushes on (APNs ${s.config.env}, topic ${s.config.topic}, key ${s.config.keyId})`)
  else log.once("push:apns-live", "info", `[yard] push: iOS Live Activity pushes are off (${s.problem}); activities still update when the app refreshes`)
}

export const liveActivityPushConfigured = () => !!apns().config

function client(s: State & { config: ApnsConfig }) {
  return (s.client ??= new ApnsClient(s.config))
}

/* ---------- The order as the app sees it ---------- */

type Snapshot = OrderSnapshot & { customerId: string; shipToCountry: string }

async function snapshot(d: Executor, orderRefId: string, now: number): Promise<Snapshot | null> {
  const { shipmentEventsFor } = await import("../orders/core")
  const { fulfilmentOf } = await import("../orders/views")
  const { deliveryFor } = await import("../shipping/orders")
  const [row] = await d
    .select({ order: orderRefs, state: orderStates, brandName: brands.name, brandCity: brands.city })
    .from(orderRefs)
    .leftJoin(orderStates, eq(orderStates.orderRefId, orderRefs.id))
    .leftJoin(brands, eq(brands.id, orderRefs.brandId))
    .where(eq(orderRefs.id, orderRefId))
    .limit(1)
  if (!row) return null
  const events = (await shipmentEventsFor(d, [orderRefId])).get(orderRefId) ?? []
  const f = fulfilmentOf(row.order, row.state, events)
  const deliveredAt = f.deliveredAt ?? row.state?.deliveredAt ?? null
  const delivery = await deliveryFor(row.order, "shopper")
  // Exactly the fields the app reads from GET /api/orders/{id} and /delivery (LiveActivityOrder.swift).
  const orderDto = { brand: { name: row.brandName ?? "The brand" }, shipToPreview: { city: row.order.shipToCity }, states: { fulfilment: f.fulfilment }, deliveredAt: deliveredAt?.toISOString() ?? null }
  return {
    orderId: row.order.id,
    customerId: row.order.customerId,
    shipToCountry: row.order.shipToCountry,
    closedAs: f.fulfilment === "cancelled" ? "cancelled" : "returned",
    at: (timeZone) => liveActivityFor(orderDto, delivery, row.brandCity ?? "", now, timeZone),
  }
}

type Opts = { mayStart?: boolean; refresh?: boolean }

/** Pushes this order's current state to its activities (and may start one). Callers catch and log. */
export async function pushOrderActivity(orderRefId: string, opts: Opts = {}) {
  const s = apns()
  if (!s.config) return { sent: 0 }
  const cfg = s as State & { config: ApnsConfig }
  const ex = await db()
  const d = ex as unknown as Db
  const tokens = await updateTokensFor(d, orderRefId)
  let starts: TokenRow[] = []
  if (!tokens.length) {
    if (!opts.mayStart) return { sent: 0 }
    const [o] = await d.select({ customerId: orderRefs.customerId }).from(orderRefs).where(eq(orderRefs.id, orderRefId)).limit(1)
    if (!o) return { sent: 0 }
    starts = await startTokensFor(d, o.customerId)
    if (!starts.length) return { sent: 0 }
  }
  const now = Date.now()
  const snap = await snapshot(ex, orderRefId, now)
  if (!snap) return { sent: 0 }
  const { destTimeZone } = await import("../shipping/quote")
  const fallbackTz = destTimeZone(snap.shipToCountry)
  const hooks: SendHooks = { count: (e) => countEvent(e), warn: (m, e) => log.warn(m, e) }
  const r = await pushToTokens(d, client(cfg), hooks, { tokens, starts, snap, fallbackTz, now, refresh: !!opts.refresh })
  return { sent: r.sent }
}

/**
 * Queues the push for an order whose delivery may have changed. Call it where the change is
 * written (inside its transaction or not): it runs after commit, in the background, and costs
 * nothing when pushes are off. `mayStart`: the order just shipped for the first time.
 */
export function queueLiveActivityPush(orderRefId: string, opts: { mayStart?: boolean } = {}) {
  if (!apns().config) return
  afterCommit(() => runSerial(orderRefId, !!opts.mayStart))
}

/**
 * One run per order at a time: a second change while one is sending (a courier event and its
 * announce in the same transaction) waits and runs once after it, reading what the first stored,
 * so the same state is never pushed twice.
 */
function runSerial(orderRefId: string, mayStart: boolean) {
  const running = ((yard.slots ??= {}).liveActivityRuns ??= new Map()) as Map<string, { again: boolean; mayStart: boolean }>
  const busy = running.get(orderRefId)
  if (busy) {
    busy.again = true
    busy.mayStart ||= mayStart
    return
  }
  const entry = { again: false, mayStart: false }
  running.set(orderRefId, entry)
  void (async () => {
    let start = mayStart
    for (;;) {
      try {
        await pushOrderActivity(orderRefId, { mayStart: start })
      } catch (e) {
        log.warn("[yard] push: Live Activity delivery failed", e)
      }
      if (!entry.again) break
      start = entry.mayStart
      entry.again = false
      entry.mayStart = false
    }
    running.delete(orderRefId)
  })()
}

/**
 * Hourly: every order with a running activity is re-read, so time-based changes (progress along
 * the line, "Arriving soon" on the first day of the window) reach the phone and the activity
 * never goes stale while the parcel is on its way. Cost scales with running activities, hourly.
 */
export async function refreshLiveActivities() {
  if (!apns().config) return { orders: 0, sent: 0 }
  const d = (await db()) as unknown as Db
  const ids = await ordersWithTokens(d)
  let sent = 0
  for (const id of ids) {
    try {
      sent += (await pushOrderActivity(id, { refresh: true })).sent
    } catch (e) {
      log.warn(`[yard] push: Live Activity refresh of ${id} failed`, e)
    }
  }
  if (sent) log.info(`[yard] push: Live Activity refresh: ${ids.length} orders, ${sent} pushes`)
  return { orders: ids.length, sent }
}
