import "server-only"
import { createHash } from "node:crypto"
import { and, desc, eq, gte, inArray, max, or, sql } from "drizzle-orm"
import type { AdminRole } from "@/lib/permissions"
import { db } from "../db"
import { checkouts, orderRefs, payments, providerEvents, refunds } from "../db/schema"
import { getEnv } from "../env"
import { financeOverview } from "../ledger/read"
import { buildBachsAdminView, TtlCache, type BachsAdminView, type OrderLink, type OrderLookup, type OrderLookupKeys, type StoredEvent, type WebhookLog } from "./bachs-admin-core"
import { paymentsConfig } from "./config"
import { bachsRead } from "./providers"

/**
 * Admin › Finance › Bachs (READ-ONLY): wires bachs-admin-core.ts to the configured Bachs client
 * (paymentsConfig, the same key and client checkout uses), the ledger and Yard's own records.
 * One cache per server process: each Bachs list is read at most once a minute however many admins
 * have Finance open. Nothing here creates, changes or moves anything at Bachs.
 */
const cache = new TtlCache()

export function bachsAdminView(role: AdminRole): Promise<BachsAdminView> {
  const cfg = paymentsConfig()
  const bachs = cfg.provider === "bachs" ? cfg.bachs : null
  return buildBachsAdminView(role, {
    payments: {
      provider: cfg.provider,
      // The key itself never leaves this function: only a short fingerprint, so a rotated key starts a fresh cache.
      bachs: bachs ? { live: bachs.live, apiBase: bachs.apiBase, webhookSecretSet: bachs.webhookSecrets.length > 0, keyFingerprint: createHash("sha256").update(bachs.secretKey).digest("hex").slice(0, 12) } : null,
    },
    publicOrigin: getEnv().publicOrigin,
    bachsGet: (path) => {
      if (!bachs) throw new Error("Bachs isn't configured")
      return bachsRead(bachs, path)
    },
    cache,
    ledger: async () => (await financeOverview()).currencies,
    webhookLog,
    lookupOrders,
    lastCheckoutAttempt,
  })
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

async function webhookLog(): Promise<WebhookLog> {
  const d = await db()
  const fields = { id: providerEvents.id, eventType: providerEvents.eventType, status: providerEvents.status, source: providerEvents.source, subjectRef: providerEvents.subjectRef, error: providerEvents.error, receivedAt: providerEvents.receivedAt, processedAt: providerEvents.processedAt }
  const toEvent = (r: { id: string; eventType: string; status: string; source: string; subjectRef: string | null; error: string | null; receivedAt: Date; processedAt: Date | null }): StoredEvent => ({ ...r, error: r.error?.slice(0, 300) ?? null, receivedAt: r.receivedAt.toISOString(), processedAt: iso(r.processedAt) })
  const bachs = eq(providerEvents.provider, "bachs")
  const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  const [recent, failures, [stats]] = await Promise.all([
    d.select(fields).from(providerEvents).where(and(bachs, eq(providerEvents.source, "webhook"))).orderBy(desc(providerEvents.receivedAt)).limit(15),
    d.select(fields).from(providerEvents).where(and(bachs, eq(providerEvents.status, "failed"))).orderBy(desc(providerEvents.receivedAt)).limit(5),
    d
      .select({
        lastReceived: max(sql`case when ${providerEvents.source} = 'webhook' then ${providerEvents.receivedAt} end`).mapWith((v) => (v ? new Date(v as string) : null)),
        lastProcessed: max(sql`case when ${providerEvents.status} = 'processed' and ${providerEvents.source} = 'webhook' then ${providerEvents.processedAt} end`).mapWith((v) => (v ? new Date(v as string) : null)),
        failedOpen: sql<number>`count(*) filter (where ${providerEvents.status} = 'failed')`.mapWith(Number),
        received7d: sql<number>`count(*) filter (where ${providerEvents.source} = 'webhook' and ${providerEvents.receivedAt} >= ${weekAgo})`.mapWith(Number),
      })
      .from(providerEvents)
      .where(bachs),
  ])
  return {
    recent: recent.map(toEvent),
    lastReceivedAt: iso(stats?.lastReceived),
    lastProcessedAt: iso(stats?.lastProcessed),
    failedOpen: stats?.failedOpen ?? 0,
    recentFailures: failures.map(toEvent),
    received7d: stats?.received7d ?? 0,
  }
}

/** Yard's orders behind what Bachs reports: payment reference / checkout id / charge id → the checkout's orders; refund reference / id → the refunded order. */
async function lookupOrders(keys: OrderLookupKeys): Promise<OrderLookup> {
  const d = await db()
  const out: OrderLookup = { byPaymentRef: {}, byCheckoutId: {}, byChargeId: {}, byRefundRef: {}, byRefundId: {}, chargeCurrency: {} }
  const conds = [
    keys.paymentRefs.length ? inArray(payments.reference, keys.paymentRefs) : undefined,
    keys.checkoutIds.length ? inArray(payments.accessCode, keys.checkoutIds) : undefined,
    keys.chargeIds.length ? inArray(payments.providerTxnId, keys.chargeIds) : undefined,
  ].filter((c) => c !== undefined)
  const payRows = conds.length
    ? await d
        .select({ id: payments.id, reference: payments.reference, accessCode: payments.accessCode, providerTxnId: payments.providerTxnId, currency: payments.currency, orderIds: checkouts.orderIds })
        .from(payments)
        .innerJoin(checkouts, eq(checkouts.id, payments.checkoutId))
        .where(and(eq(payments.provider, "bachs"), or(...conds)))
        .limit(500)
    : []
  const refundConds = [keys.refundRefs.length ? inArray(refunds.id, keys.refundRefs) : undefined, keys.refundIds.length ? inArray(refunds.providerRef, keys.refundIds) : undefined].filter((c) => c !== undefined)
  const refundRows = refundConds.length ? await d.select({ id: refunds.id, providerRef: refunds.providerRef, orderId: refunds.orderId }).from(refunds).where(and(eq(refunds.provider, "bachs"), or(...refundConds))).limit(500) : []
  const orderIds = [...new Set([...payRows.flatMap((p) => p.orderIds ?? []), ...refundRows.map((r) => r.orderId)])]
  const orders = orderIds.length ? await d.select({ id: orderRefs.id, reference: orderRefs.reference }).from(orderRefs).where(inArray(orderRefs.id, orderIds)) : []
  const ref = new Map(orders.map((o) => [o.id, o.reference]))
  const links = (ids: string[]): OrderLink[] => ids.filter((id) => ref.has(id)).map((id) => ({ id, reference: ref.get(id)! }))
  const add = (map: Record<string, OrderLink[]>, key: string | null, l: OrderLink[]) => {
    if (key && l.length) map[key] = [...(map[key] ?? []), ...l]
  }
  for (const p of payRows) {
    const l = links(p.orderIds ?? [])
    add(out.byPaymentRef, p.reference, l)
    add(out.byCheckoutId, p.accessCode, l)
    add(out.byChargeId, p.providerTxnId, l)
    if (p.providerTxnId) out.chargeCurrency[p.providerTxnId] = p.currency
  }
  for (const r of refundRows) {
    const l = links([r.orderId])
    add(out.byRefundRef, r.id, l)
    add(out.byRefundId, r.providerRef, l)
  }
  return out
}

/** The newest Bachs payment Yard opened in the last 30 days and the error Bachs gave if it refused to open it. */
async function lastCheckoutAttempt(): Promise<{ at: string; error: string | null } | null> {
  const d = await db()
  const [p] = await d
    .select({ at: payments.createdAt, error: payments.initError })
    .from(payments)
    .where(and(eq(payments.provider, "bachs"), gte(payments.createdAt, new Date(Date.now() - 30 * 86_400_000))))
    .orderBy(desc(payments.createdAt))
    .limit(1)
  return p ? { at: p.at.toISOString(), error: p.error } : null
}
