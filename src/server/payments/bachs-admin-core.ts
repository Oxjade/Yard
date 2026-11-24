/**
 * Admin › Finance › Bachs: the READ-ONLY view of Yard's Bachs account (pure part: parsing, the
 * reconciliation, the cache and the assembly). No database, no network and no "server-only", so
 * `tsx --test` unit-tests it (bachs-admin-core.test.ts) with fixtures shaped like the documented
 * responses. The server side (the configured client, the ledger, the event log) is bachs-admin.ts.
 *
 * Bachs endpoints read (https://docs.bachs.io/api-reference, all GET, nothing here moves money):
 *   /v1/accounts/me             the account the key belongs to (key valid, is_active, currencies)
 *   /v1/balances                available_balance / pending_balance per currency     balance:read
 *   /v1/payments                payments and collections (checkouts create them)     payments:read
 *   /v1/refunds                 refunds                                               refunds:read
 *   /v1/disputes                disputes                                              disputes:read
 *   /v1/payouts                 payouts (withdrawals) out of the balance              payouts:read
 *   /v1/webhooks/endpoints (+ /{id}/metrics)  the endpoint Bachs delivers to          webhooks:read (optional)
 * Lists come back as `{ items, pagination }` (payments, webhook endpoints) or `{ total, items }`
 * (refunds, disputes, payouts). Amounts are decimal strings in major units ("58700.00").
 */
import { bachsAmountToMinor, isBachsCurrency } from "./bachs-core"
import { canAdminFinance, type AdminRole } from "../../lib/permissions"

/* ---------- Errors ---------- */

export type BachsErrorKind = "unauthorized" | "forbidden" | "not_activated" | "unavailable" | "refused" | "invalid_response"
export type BachsSectionError = { kind: BachsErrorKind; message: string; code: string | null }

/** Thrown for a role without finance access; the route answers 403 before anything is read. */
export class BachsAccessDenied extends Error {
  constructor() {
    super("Bachs needs the Owner or Finance role.")
    this.name = "BachsAccessDenied"
  }
}

/** A reply that doesn't have the documented shape. */
export class BachsShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BachsShapeError"
  }
}

const NOT_ACTIVATED_CODES = new Set(["ACCOUNT_NOT_ACTIVATED", "PAYMENTS_NOT_ENABLED"])

/**
 * Any thrown value from a Bachs read → what Admin shows. Reads the duck-typed fields the payments
 * client sets (ProviderError: httpStatus, code); a timeout or a network failure has neither.
 * `scope` names the permission the endpoint needs, for the "key lacks …" message.
 */
export function classifyBachsError(e: unknown, scope?: string): BachsSectionError {
  if (e instanceof BachsShapeError) return { kind: "invalid_response", message: `Bachs answered in a shape Yard doesn't recognise (${e.message}).`, code: null }
  const o = (e && typeof e === "object" ? e : {}) as { httpStatus?: unknown; code?: unknown; message?: unknown }
  const status = typeof o.httpStatus === "number" ? o.httpStatus : null
  const code = typeof o.code === "string" && o.code ? o.code.toUpperCase() : null
  if (code && NOT_ACTIVATED_CODES.has(code))
    return { kind: "not_activated", message: "Bachs says the account isn't activated for live payments yet. Finish verification in the Bachs dashboard.", code }
  if (status === 401 || code === "UNAUTHORIZED") return { kind: "unauthorized", message: "Bachs refused the API key (invalid, revoked or for the other environment).", code: code ?? "UNAUTHORIZED" }
  if (status === 403 || code === "FORBIDDEN") return { kind: "forbidden", message: scope ? `The API key lacks the ${scope} permission. Add it to the key in the Bachs Developer Portal.` : "The API key isn't allowed to read this.", code: code ?? "FORBIDDEN" }
  if (status === null || status === 408 || status === 429 || status >= 500) return { kind: "unavailable", message: "Bachs unavailable. Showing nothing rather than old figures; it retries within a minute.", code }
  return { kind: "refused", message: `Bachs refused the request (HTTP ${status}${code ? `, ${code}` : ""}).`, code }
}

/* ---------- Cache ---------- */

type Entry = { at: number; expires: number; ok: true; value: unknown } | { at: number; expires: number; ok: false; error: unknown }

/**
 * A small TTL cache with single flight: concurrent callers of one key share one request, an answer
 * is reused for `ttlMs` and a failure for `errorTtlMs` (shorter), so admin page loads never hammer
 * Bachs, and a Bachs outage costs one request per key per `errorTtlMs`.
 */
export class TtlCache {
  private entries = new Map<string, Entry>()
  private inflight = new Map<string, Promise<Entry>>()
  constructor(private now: () => number = Date.now) {}

  async get<T>(key: string, load: () => Promise<T>, opts: { ttlMs: number; errorTtlMs: number }): Promise<{ ok: true; value: T; at: number } | { ok: false; error: unknown; at: number }> {
    const hit = this.entries.get(key)
    const entry = hit && hit.expires > this.now() ? hit : await this.fill(key, load, opts)
    return entry.ok ? { ok: true, value: entry.value as T, at: entry.at } : { ok: false, error: entry.error, at: entry.at }
  }

  private fill(key: string, load: () => Promise<unknown>, opts: { ttlMs: number; errorTtlMs: number }): Promise<Entry> {
    const running = this.inflight.get(key)
    if (running) return running
    const p = (async (): Promise<Entry> => {
      let entry: Entry
      try {
        const value = await load()
        const at = this.now()
        entry = { at, expires: at + opts.ttlMs, ok: true, value }
      } catch (error) {
        const at = this.now()
        entry = { at, expires: at + opts.errorTtlMs, ok: false, error }
      }
      this.entries.set(key, entry)
      // Keep the map small: drop entries long expired.
      if (this.entries.size > 64) for (const [k, v] of this.entries) if (v.expires < this.now()) this.entries.delete(k)
      return entry
    })().finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  clear() {
    this.entries.clear()
  }
}

export const BACHS_CACHE_TTL_MS = 60_000
export const BACHS_ERROR_TTL_MS = 20_000

/* ---------- Parsing ---------- */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v)
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null)
const b = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null)

/** A Bachs decimal amount in minor units, or null when the currency's precision isn't known to Yard or the value isn't an amount. */
export function amountMinor(amount: unknown, currency: string | null): number | null {
  if (amount === null || amount === undefined || !currency || !isBachsCurrency(currency.toUpperCase())) return null
  try {
    // Balances can be negative (a dispute hold or fee larger than what is settling): keep the sign.
    const text = typeof amount === "string" ? amount.trim() : amount
    if (typeof text === "string" && text.startsWith("-")) return -bachsAmountToMinor(text.slice(1), currency.toUpperCase())
    return bachsAmountToMinor(text, currency.toUpperCase())
  } catch {
    return null
  }
}

/** Money as Bachs sent it plus Yard's minor units when it can read them (the UI formats minor units, else shows the raw string). */
export type BachsMoney = { amount: string | null; currency: string | null; minor: number | null }
const money = (amount: unknown, currency: unknown): BachsMoney => {
  const c = s(currency)?.toUpperCase() ?? null
  return { amount: s(amount), currency: c, minor: amountMinor(amount, c) }
}

/** `{ items, pagination: { total, has_more } }` or `{ total, items }` → items + total. Anything else is a shape error. */
export function parseBachsList(json: unknown): { items: Obj[]; total: number | null; hasMore: boolean | null } {
  if (!isObj(json) || !Array.isArray(json.items)) throw new BachsShapeError("expected a list with items")
  const pag = isObj(json.pagination) ? json.pagination : null
  const total = typeof json.total === "number" ? json.total : typeof pag?.total === "number" ? pag.total : null
  const hasMore = typeof pag?.has_more === "boolean" ? pag.has_more : total !== null ? total > json.items.length : null
  return { items: json.items.filter(isObj), total, hasMore }
}

export type BachsBalance = { currency: string; available: BachsMoney; pending: BachsMoney; totalMinor: number | null }
export type BachsBalances = { accountId: string | null; balances: BachsBalance[]; totalUsd: string | null; pendingSettlements: { count: number; days: { date: string | null; summary: string }[] } }

/** GET /v1/balances (AccountBalanceResponse). */
export function parseBachsBalances(json: unknown): BachsBalances {
  if (!isObj(json) || !Array.isArray(json.balances)) throw new BachsShapeError("balances missing")
  const balances = json.balances.filter(isObj).flatMap((row): BachsBalance[] => {
    const currency = s(row.currency)?.toUpperCase()
    if (!currency) return []
    const available = money(row.available_balance, currency)
    const pending = money(row.pending_balance, currency)
    const totalMinor = available.minor !== null && pending.minor !== null ? available.minor + pending.minor : null
    return [{ currency, available, pending, totalMinor }]
  })
  // pending_settlements_by_day is documented only as "objects describing settlements expected on a
  // given date": show the date and the amounts we can find, never guess more.
  const days = (Array.isArray(json.pending_settlements_by_day) ? json.pending_settlements_by_day : []).filter(isObj).map((d) => {
    const date = s(d.date) ?? s(d.day) ?? s(d.available_on) ?? s(d.settlement_date)
    const parts = Object.entries(d)
      .filter(([k, v]) => !["date", "day", "available_on", "settlement_date"].includes(k) && (typeof v === "string" || typeof v === "number"))
      .map(([k, v]) => `${k.replaceAll("_", " ")} ${v}`)
    return { date, summary: parts.join(", ").slice(0, 200) }
  })
  return { accountId: s(json.account_id), balances, totalUsd: s(json.total_balance_usd), pendingSettlements: { count: days.length, days: days.slice(0, 14) } }
}

export type BachsAccount = { id: string | null; name: string | null; country: string | null; isActive: boolean | null; balanceCurrencies: string[]; enabledMethods: string[]; feeHandling: string | null }

/** GET /v1/accounts/me. */
export function parseBachsAccount(json: unknown): BachsAccount {
  if (!isObj(json) || !s(json.id)) throw new BachsShapeError("account id missing")
  const methods = isObj(json.enabled_payment_methods) ? json.enabled_payment_methods : {}
  return {
    id: s(json.id),
    name: s(json.name) ?? s(json.company_name),
    country: s(json.country),
    isActive: b(json.is_active),
    balanceCurrencies: (Array.isArray(json.balance_currencies) ? json.balance_currencies : []).map(s).filter((x): x is string => !!x),
    enabledMethods: Object.entries(methods)
      .filter(([, v]) => isObj(v) && v.enabled === true)
      .map(([k]) => k),
    feeHandling: s(json.fee_handling),
  }
}

export type OrderLink = { id: string; reference: string }

export type BachsPaymentRow = {
  id: string | null
  reference: string | null
  checkoutId: string | null
  status: string
  amount: BachsMoney
  /** What Bachs settled (settlement_amount / settlement_currency). */
  settlement: BachsMoney
  fee: BachsMoney
  method: string | null
  failureMessage: string | null
  createdAt: string | null
  completedAt: string | null
  orders: OrderLink[]
}

/** "card" → "Card", "ngn_bank_transfer" → "NGN bank transfer", with the card brand and last 4 when Bachs sends them. */
export function methodLabel(pm: unknown): string | null {
  if (!isObj(pm)) return typeof pm === "string" && pm ? pm.replaceAll("_", " ").toLowerCase() : null
  const type = s(pm.type)?.toLowerCase() ?? ""
  const words = type
    .split("_")
    .filter(Boolean)
    .map((w, i) => (/^(ngn|usd|ghs|kes|ugx|tzs|xaf|xof|rwf|zmw|mwk)$/.test(w) ? w.toUpperCase() : w === "momo" ? "mobile money" : i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
  const label = words.join(" ") || null
  const brand = s(pm.brand)
  const last4 = s(pm.last4)
  return [label, brand, last4 ? `•${last4}` : null].filter(Boolean).join(" · ") || null
}

/** One item of GET /v1/payments. */
export function parseBachsPayment(row: Obj): BachsPaymentRow {
  const currency = s(row.currency)
  const source = isObj(row.source) ? row.source : {}
  return {
    id: s(row.id),
    reference: s(row.reference) ?? s(source.reference),
    checkoutId: s(source.checkout_id),
    status: (s(row.status) ?? "unknown").toLowerCase(),
    amount: money(row.amount, currency),
    settlement: money(row.settlement_amount, row.settlement_currency ?? currency),
    fee: money(row.fee, currency),
    method: methodLabel(row.payment_method),
    failureMessage: s(row.failure_message),
    createdAt: s(row.transaction_date),
    completedAt: s(row.completed_at),
    orders: [],
  }
}

export type BachsRefundRow = {
  refundId: string | null
  chargeId: string | null
  reference: string | null
  status: string
  requested: BachsMoney
  refunded: BachsMoney
  fee: BachsMoney
  reason: string | null
  createdAt: string | null
  completedAt: string | null
  orders: OrderLink[]
}

/** One item of GET /v1/refunds. Refunds carry no currency: they are in the charge's settlement currency, resolved by the caller. */
export function parseBachsRefund(row: Obj, currency: string | null = null): BachsRefundRow {
  return {
    refundId: s(row.refund_id),
    chargeId: s(row.charge_id),
    reference: s(row.reference),
    status: (s(row.status) ?? "unknown").toLowerCase(),
    requested: money(row.requested_amount, currency),
    refunded: money(row.refunded_amount, currency),
    fee: money(row.refund_fee_amount, currency),
    reason: s(row.reason),
    createdAt: s(row.created_at),
    completedAt: s(row.completed_at),
    orders: [],
  }
}

export type BachsDisputeRow = {
  disputeId: string | null
  chargeId: string | null
  status: string
  amount: BachsMoney
  reason: string | null
  responseDeadlineAt: string | null
  responseEditable: boolean | null
  createdAt: string | null
  updatedAt: string | null
  /** Needs an answer in the Bachs dashboard before the deadline. */
  needsResponse: boolean
  orders: OrderLink[]
}

/** One item of GET /v1/disputes. */
export function parseBachsDispute(row: Obj): BachsDisputeRow {
  const status = (s(row.status) ?? "unknown").toLowerCase()
  const editable = b(row.is_response_editable)
  return {
    disputeId: s(row.dispute_id),
    chargeId: s(row.charge_id),
    status,
    amount: money(row.amount, row.currency),
    reason: s(row.reason),
    responseDeadlineAt: s(row.response_deadline_at),
    responseEditable: editable,
    createdAt: s(row.created_at),
    updatedAt: s(row.updated_at),
    needsResponse: status === "needs_response" && editable !== false,
    orders: [],
  }
}

export type BachsDisputes = { items: BachsDisputeRow[]; total: number | null; needsResponse: number }

export type BachsPayoutRow = { id: string | null; status: string; amount: BachsMoney; fee: BachsMoney; totalDebited: BachsMoney; reference: string | null; failureReason: string | null; createdAt: string | null; completedAt: string | null }

/** One item of GET /v1/payouts (a withdrawal from the balance). `fee` and `total_debited` are in `source_currency`. */
export function parseBachsPayout(row: Obj): BachsPayoutRow {
  const source = row.source_currency ?? row.currency
  return {
    id: s(row.id),
    status: (s(row.status) ?? "unknown").toLowerCase(),
    amount: money(row.amount, row.currency),
    fee: money(row.fee, source),
    totalDebited: money(row.total_debited, source),
    reference: s(row.reference),
    failureReason: s(row.failure_reason),
    createdAt: s(row.created_at),
    completedAt: s(row.completed_at),
  }
}

/** The events Yard needs on its endpoint (docs/BACHS.md › Webhook). */
export const BACHS_REQUIRED_EVENTS = ["checkout.completed", "collection.succeeded", "checkout.expired", "refund.created", "refund.paid", "refund.failed"] as const

export type BachsEndpoint = { id: string | null; url: string; enabled: boolean | null; disabledAt: string | null; disabledReason: string | null; missingEvents: string[]; deliveries7d: { success: number; failed: number } | null }

/** The endpoint registered for Yard's webhook URL in GET /v1/webhooks/endpoints (null when none is). */
export function pickYardEndpoint(json: unknown, publicOrigin: string): Omit<BachsEndpoint, "deliveries7d"> | null {
  const { items } = parseBachsList(json)
  const path = "/api/webhooks/bachs"
  let host = ""
  try {
    host = new URL(publicOrigin).host
  } catch {}
  const candidates = items.filter((e) => (s(e.url) ?? "").replace(/\/+$/, "").endsWith(path))
  const e = candidates.find((x) => {
    try {
      return new URL(s(x.url) ?? "").host === host
    } catch {
      return false
    }
  }) ?? candidates[0]
  if (!e) return null
  const types = (Array.isArray(e.event_types) ? e.event_types : []).map((t) => s(t)?.toLowerCase()).filter((t): t is string => !!t)
  return {
    id: s(e.endpoint_id),
    url: s(e.url) ?? "",
    enabled: b(e.enabled),
    disabledAt: s(e.disabled_at),
    disabledReason: s(e.disabled_reason),
    missingEvents: types.includes("*") ? [] : BACHS_REQUIRED_EVENTS.filter((t) => !types.includes(t)),
  }
}

/** GET /v1/webhooks/endpoints/{id}/metrics → success / failed delivery attempts over the range. */
export function parseEndpointMetrics(json: unknown): { success: number; failed: number } {
  if (!isObj(json) || !Array.isArray(json.data)) throw new BachsShapeError("metrics data missing")
  let success = 0
  let failed = 0
  for (const d of json.data.filter(isObj)) {
    success += typeof d.success === "number" ? d.success : 0
    failed += typeof d.failed === "number" ? d.failed : 0
  }
  return { success, failed }
}

/* ---------- Reconciliation ---------- */

/** One ledger currency from financeOverview(): what Yard's ledger says it holds at the provider and owes. */
export type LedgerCurrencyRow = {
  currency: string
  providerClearingMinor: number
  commissionMinor: number
  adjustmentsMinor: number
  /** Live courier rates shoppers paid (Yard's, docs/SHIPPING.md): also sits at the payment provider. */
  shippingCollectedMinor?: number
  brandPendingMinor: number
  brandAvailableMinor: number
  brandReserveMinor: number
  brandInPayoutMinor: number
}

export type ReconStatus = "match" | "mismatch" | "shortfall" | "not_held" | "unavailable"
export type ReconLine = {
  currency: string
  bachs: { availableMinor: number; pendingMinor: number; totalMinor: number } | null
  /** Yard's ledger: money at the provider (provider_clearing) = owed to brands + commission + adjustments. */
  ledger: { atProviderMinor: number; owedToBrandsMinor: number; commissionMinor: number; adjustmentsMinor: number; shippingCollectedMinor?: number }
  /** Bachs total − ledger at provider (null when not comparable). */
  differenceMinor: number | null
  status: ReconStatus
  message: string
  note: string | null
}

const HELD = ["NGN", "USD"]

/**
 * Bachs balance vs Yard's ledger, per currency. Bachs total = available + pending (collected money
 * still settling is still Yard's). The ledger's provider_clearing is what Yard believes sits at
 * Bachs, and it equals what Yard owes brands (pending + available + reserve + in payout) plus
 * Yard's commission plus adjustments.
 *  - shortfall: Bachs holds less than Yard owes brands (urgent).
 *  - mismatch: the totals differ (Bachs fees, dispute holds, a withdrawal not recorded in Yard,
 *    a payment Yard didn't record…). Any difference is flagged; there is no tolerance.
 *  - not_held: a ledger currency Bachs doesn't hold (GHS, KES settle into USD), so not comparable.
 *  - unavailable: Bachs couldn't be read.
 * Amounts Yard can't read in minor units make the line unavailable rather than guessed.
 */
export function reconcileBachs(balances: BachsBalances | null, ledger: LedgerCurrencyRow[]): ReconLine[] {
  const held = new Map((balances?.balances ?? []).map((x) => [x.currency, x]))
  const byLedger = new Map(ledger.map((r) => [r.currency.toUpperCase(), r]))
  const currencies = [...new Set([...HELD, ...held.keys(), ...byLedger.keys()])].filter((c) => isBachsCurrency(c))
  // Ledger currencies Bachs doesn't hold but which settle into USD there.
  const converted = [...byLedger.values()].filter((r) => !held.has(r.currency.toUpperCase()) && !HELD.includes(r.currency.toUpperCase()) && r.providerClearingMinor !== 0).map((r) => r.currency.toUpperCase())
  const lines: ReconLine[] = []
  const rank = (c: string) => (HELD.includes(c) ? HELD.indexOf(c) : HELD.length)
  for (const c of currencies.sort((a, z) => rank(a) - rank(z) || a.localeCompare(z))) {
    const r = byLedger.get(c)
    const l = {
      atProviderMinor: r?.providerClearingMinor ?? 0,
      owedToBrandsMinor: r ? r.brandPendingMinor + r.brandAvailableMinor + r.brandReserveMinor + r.brandInPayoutMinor : 0,
      commissionMinor: r?.commissionMinor ?? 0,
      adjustmentsMinor: r?.adjustmentsMinor ?? 0,
      ...(r?.shippingCollectedMinor ? { shippingCollectedMinor: r.shippingCollectedMinor } : {}),
    }
    const bal = held.get(c)
    const ledgerEmpty = !r || (l.atProviderMinor === 0 && l.owedToBrandsMinor === 0 && l.commissionMinor === 0 && l.adjustmentsMinor === 0 && !l.shippingCollectedMinor)
    if (!balances) {
      if (ledgerEmpty && !HELD.includes(c)) continue
      lines.push({ currency: c, bachs: null, ledger: l, differenceMinor: null, status: "unavailable", message: "Bachs balance unavailable, so nothing is compared.", note: null })
      continue
    }
    if (!bal) {
      if (ledgerEmpty) continue
      lines.push({ currency: c, bachs: null, ledger: l, differenceMinor: null, status: "not_held", message: `Bachs doesn't hold ${c}: collections in ${c} are converted into a currency Bachs holds (USD) as they settle, so this line can't be compared.`, note: null })
      continue
    }
    if (bal.available.minor === null || bal.pending.minor === null || bal.totalMinor === null) {
      lines.push({ currency: c, bachs: null, ledger: l, differenceMinor: null, status: "unavailable", message: "Bachs sent a balance Yard can't read exactly, so nothing is compared.", note: null })
      continue
    }
    const total = bal.totalMinor
    const diff = total - l.atProviderMinor
    const status: ReconStatus = total < l.owedToBrandsMinor ? "shortfall" : diff !== 0 ? "mismatch" : "match"
    const message =
      status === "match"
        ? "Bachs holds exactly what the ledger expects."
        : status === "shortfall"
          ? "Bachs holds less than Yard owes brands. Check withdrawals, refunds and disputes in Bachs before paying anyone."
          : diff < 0
            ? "Bachs holds less than the ledger expects: Bachs fees, dispute holds or a withdrawal not yet recorded in Yard."
            : "Bachs holds more than the ledger expects: a payment Yard hasn't recorded, a conversion from another currency, or commission not yet withdrawn from the ledger."
    const note = c === "USD" && converted.length ? `Bachs converts ${converted.join(" and ")} collections into USD, so this line won't match while the ledger holds ${converted.join("/")}.` : null
    lines.push({ currency: c, bachs: { availableMinor: bal.available.minor, pendingMinor: bal.pending.minor, totalMinor: total }, ledger: l, differenceMinor: diff, status, message, note })
  }
  return lines
}

/* ---------- Webhook health (from Yard's own event log) ---------- */

export type StoredEvent = { id: string; eventType: string; status: string; source: string; subjectRef: string | null; error: string | null; receivedAt: string; processedAt: string | null }
export type WebhookLog = {
  recent: StoredEvent[]
  lastReceivedAt: string | null
  lastProcessedAt: string | null
  /** Events still in 'failed' (processing failed and no retry or replay fixed it yet). */
  failedOpen: number
  recentFailures: StoredEvent[]
  received7d: number
}
export type WebhookHealth = WebhookLog & {
  secretSet: boolean
  state: "ok" | "attention" | "none"
  problems: string[]
  endpoint: Section<Omit<BachsEndpoint, "deliveries7d"> & { deliveries7d: { success: number; failed: number } | null } | null>
}

/* ---------- Assembly ---------- */

export type Section<T> = { ok: true; data: T; fetchedAt: string } | { ok: false; error: BachsSectionError; fetchedAt: string }

export type BachsConnection = {
  environment: "live" | "sandbox"
  apiHost: string
  key: "valid" | "invalid" | "unknown"
  keyNote: string
  account: "active" | "not_activated" | "deactivated" | "unknown"
  accountNote: string
  webhookSecretSet: boolean
  missingScopes: string[]
}

export type BachsAdminView =
  | { connected: false; reason: "off" | "stub" | "paystack"; message: string; generatedAt: string }
  | {
      connected: true
      generatedAt: string
      connection: BachsConnection
      account: Section<BachsAccount>
      balances: Section<BachsBalances>
      reconciliation: ReconLine[]
      payments: Section<{ items: BachsPaymentRow[]; total: number | null }>
      refunds: Section<{ items: BachsRefundRow[]; total: number | null }>
      disputes: Section<BachsDisputes>
      payouts: Section<{ items: BachsPayoutRow[]; total: number | null }>
      webhooks: WebhookHealth
      dashboardUrl: string
    }

/** Where Yard's own records are looked up by what Bachs reports (bachs-admin.ts reads the database). */
export type OrderLookupKeys = { paymentRefs: string[]; checkoutIds: string[]; chargeIds: string[]; refundRefs: string[]; refundIds: string[] }
export type OrderLookup = {
  byPaymentRef: Record<string, OrderLink[]>
  byCheckoutId: Record<string, OrderLink[]>
  byChargeId: Record<string, OrderLink[]>
  byRefundRef: Record<string, OrderLink[]>
  byRefundId: Record<string, OrderLink[]>
  /** Yard's payment currency by Bachs charge id (to label refunds when Bachs' payment list doesn't have the charge). */
  chargeCurrency: Record<string, string>
}

export type BachsAdminDeps = {
  /** paymentsConfig() summarised: which provider, and the Bachs settings without the key. */
  payments: { provider: "paystack" | "bachs" | "stub" | "off"; bachs: { live: boolean; apiBase: string; webhookSecretSet: boolean; keyFingerprint: string } | null }
  publicOrigin: string
  /** A Bachs GET with the configured key (throws ProviderError-like values). */
  bachsGet: (path: string) => Promise<unknown>
  cache: TtlCache
  ledger: () => Promise<LedgerCurrencyRow[]>
  webhookLog: () => Promise<WebhookLog>
  lookupOrders: (keys: OrderLookupKeys) => Promise<OrderLookup>
  /** The newest Bachs payment Yard tried to open, with the error Bachs gave when it refused (null when it opened). */
  lastCheckoutAttempt: () => Promise<{ at: string; error: string | null } | null>
  now?: () => Date
}

/** Bachs' dashboard. The API returns no per-dispute or per-payment dashboard URL, so Admin links here with the id to search for. */
export const BACHS_DASHBOARD_URL = "https://app.bachs.io"

const PAGE = 25

/**
 * Builds the Admin › Finance › Bachs view. Refuses (BachsAccessDenied) any role without finance
 * access before reading anything. With payments off, on the stub or on Paystack it reads nothing
 * from Bachs and says Bachs isn't connected. Otherwise every Bachs read goes through the cache
 * (60 s; failures 20 s) and fails on its own: one unavailable list never hides the others or
 * Yard's own figures.
 */
export async function buildBachsAdminView(role: AdminRole, deps: BachsAdminDeps): Promise<BachsAdminView> {
  if (!canAdminFinance(role)) throw new BachsAccessDenied()
  const now = deps.now ?? (() => new Date())
  const generatedAt = now().toISOString()
  const { payments } = deps
  if (payments.provider !== "bachs" || !payments.bachs) {
    const reason = payments.provider === "bachs" ? "stub" : payments.provider
    const message =
      reason === "off"
        ? "Bachs isn't connected: payments are off (YARD_PAYMENTS=off), so nothing is read from Bachs. Set YARD_PAYMENTS=bachs with the Bachs keys to connect it (docs/BACHS.md)."
        : reason === "paystack"
          ? "Bachs isn't connected: this deployment takes payments through Paystack."
          : "Bachs isn't connected: payments run on the stub (nothing is charged), so nothing is read from Bachs."
    return { connected: false, reason, message, generatedAt }
  }
  const cfg = payments.bachs
  const keyPrefix = `${cfg.apiBase}|${cfg.keyFingerprint}|`

  async function read<T>(key: string, path: string, scope: string | undefined, parse: (json: unknown) => T): Promise<Section<T>> {
    const r = await deps.cache.get(keyPrefix + key, async () => parse(await deps.bachsGet(path)), { ttlMs: BACHS_CACHE_TTL_MS, errorTtlMs: BACHS_ERROR_TTL_MS })
    const fetchedAt = new Date(r.at).toISOString()
    return r.ok ? { ok: true, data: r.value, fetchedAt } : { ok: false, error: classifyBachsError(r.error, scope), fetchedAt }
  }
  const list = <T>(parse: (row: Obj) => T) => (json: unknown) => {
    const l = parseBachsList(json)
    return { items: l.items.map(parse), total: l.total }
  }

  const [account, balances, paymentList, refundList, disputeList, payoutList, endpointRaw, ledger, log, lastAttempt] = await Promise.all([
    read("account", "/v1/accounts/me", undefined, parseBachsAccount),
    read("balances", "/v1/balances", "balance:read", parseBachsBalances),
    read("payments", `/v1/payments?limit=${PAGE}`, "payments:read", list(parseBachsPayment)),
    read("refunds", `/v1/refunds?limit=${PAGE}`, "refunds:read", (json) => parseBachsList(json)),
    read("disputes", `/v1/disputes?limit=${PAGE}`, "disputes:read", list(parseBachsDispute)),
    read("payouts", "/v1/payouts?limit=10", "payouts:read", list(parseBachsPayout)),
    read("webhook-endpoints", "/v1/webhooks/endpoints?limit=50", "webhooks:read", (json) => pickYardEndpoint(json, deps.publicOrigin)),
    deps.ledger(),
    deps.webhookLog(),
    deps.lastCheckoutAttempt(),
  ])

  // Delivery counts for Yard's endpoint over the last 7 days (only when the endpoint is readable).
  let endpoint: WebhookHealth["endpoint"]
  if (endpointRaw.ok && endpointRaw.data?.id) {
    const id = endpointRaw.data.id
    const from = new Date(now().getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
    const metrics = await read(`webhook-metrics:${id}`, `/v1/webhooks/endpoints/${encodeURIComponent(id)}/metrics?period=day&date_from=${from}T00:00:00Z`, "webhooks:read", parseEndpointMetrics)
    endpoint = { ok: true, fetchedAt: endpointRaw.fetchedAt, data: { ...endpointRaw.data, deliveries7d: metrics.ok ? metrics.data : null } }
  } else endpoint = endpointRaw.ok ? { ok: true, fetchedAt: endpointRaw.fetchedAt, data: null } : endpointRaw

  // Yard's orders for whatever Bachs reports.
  const refundRows = refundList.ok ? refundList.data.items : []
  const keys: OrderLookupKeys = {
    paymentRefs: paymentList.ok ? paymentList.data.items.flatMap((p) => (p.reference ? [p.reference] : [])) : [],
    checkoutIds: paymentList.ok ? paymentList.data.items.flatMap((p) => (p.checkoutId ? [p.checkoutId] : [])) : [],
    chargeIds: [
      ...(paymentList.ok ? paymentList.data.items.flatMap((p) => (p.id ? [p.id] : [])) : []),
      ...refundRows.flatMap((r) => (s(r.charge_id) ? [s(r.charge_id)!] : [])),
      ...(disputeList.ok ? disputeList.data.items.flatMap((d) => (d.chargeId ? [d.chargeId] : [])) : []),
    ],
    refundRefs: refundRows.flatMap((r) => (s(r.reference) ? [s(r.reference)!] : [])),
    refundIds: refundRows.flatMap((r) => (s(r.refund_id) ? [s(r.refund_id)!] : [])),
  }
  for (const k of Object.keys(keys) as (keyof OrderLookupKeys)[]) keys[k] = [...new Set(keys[k])].slice(0, 200)
  const anyKeys = Object.values(keys).some((v) => v.length)
  const found: OrderLookup = anyKeys ? await deps.lookupOrders(keys) : { byPaymentRef: {}, byCheckoutId: {}, byChargeId: {}, byRefundRef: {}, byRefundId: {}, chargeCurrency: {} }
  const uniq = (links: OrderLink[]) => links.filter((l, i, a) => a.findIndex((x) => x.id === l.id) === i)

  const paymentsSection: Section<{ items: BachsPaymentRow[]; total: number | null }> = paymentList.ok
    ? { ...paymentList, data: { ...paymentList.data, items: paymentList.data.items.map((p) => ({ ...p, orders: uniq([...(p.reference ? (found.byPaymentRef[p.reference] ?? []) : []), ...(p.checkoutId ? (found.byCheckoutId[p.checkoutId] ?? []) : []), ...(p.id ? (found.byChargeId[p.id] ?? []) : [])]) })) } }
    : paymentList
  // A refund is in its charge's settlement currency: from Bachs' own payment list when the charge is
  // on this page, else Yard's payment (only when it's a currency Bachs holds, so it settled as-is).
  const settledIn = new Map((paymentList.ok ? paymentList.data.items : []).flatMap((p) => (p.id ? [[p.id, p.settlement.currency ?? p.amount.currency] as const] : [])))
  const refundsSection: Section<{ items: BachsRefundRow[]; total: number | null }> = refundList.ok
    ? {
        ...refundList,
        data: {
          total: refundList.data.total,
          items: refundRows.map((row) => {
            const charge = s(row.charge_id)
            const yardCcy = charge ? found.chargeCurrency[charge] : undefined
            const currency = (charge && settledIn.get(charge)) || (yardCcy && HELD.includes(yardCcy) ? yardCcy : null)
            const r = parseBachsRefund(row, currency ?? null)
            return { ...r, orders: uniq([...(r.reference ? (found.byRefundRef[r.reference] ?? []) : []), ...(r.refundId ? (found.byRefundId[r.refundId] ?? []) : []), ...(r.chargeId ? (found.byChargeId[r.chargeId] ?? []) : [])]) }
          }),
        },
      }
    : refundList
  const disputesSection: Section<BachsDisputes> = disputeList.ok
    ? {
        ...disputeList,
        data: {
          total: disputeList.data.total,
          items: disputeList.data.items.map((d) => ({ ...d, orders: d.chargeId ? uniq(found.byChargeId[d.chargeId] ?? []) : [] })),
          needsResponse: disputeList.data.items.filter((d) => d.needsResponse).length,
        },
      }
    : disputeList

  /* Connection status. */
  const sections: Section<unknown>[] = [account, balances, paymentList, refundList, disputeList, payoutList, endpointRaw]
  const errors = sections.flatMap((x) => (x.ok ? [] : [x.error]))
  const anyOk = sections.some((x) => x.ok)
  const scopeOf: [Section<unknown>, string][] = [
    [balances, "balance:read"],
    [paymentList, "payments:read"],
    [refundList, "refunds:read"],
    [disputeList, "disputes:read"],
    [payoutList, "payouts:read"],
    [endpointRaw, "webhooks:read"],
  ]
  const missingScopes = scopeOf.filter(([x]) => !x.ok && x.error.kind === "forbidden").map(([, scope]) => scope)
  const unauthorized = errors.some((e) => e.kind === "unauthorized")
  const keyStatus: BachsConnection["key"] = unauthorized ? "invalid" : anyOk || errors.some((e) => e.kind === "forbidden" || e.kind === "not_activated") ? "valid" : "unknown"
  const keyNote =
    keyStatus === "invalid"
      ? "Bachs refused the key. Check BACHS_SECRET_KEY (a live key needs the live API, a sandbox key the sandbox)."
      : keyStatus === "valid"
        ? missingScopes.length
          ? `Bachs accepts the key, but it lacks ${missingScopes.join(", ")}.`
          : "Bachs accepts the key."
        : "Bachs couldn't be reached, so the key wasn't checked."
  const refusedCheckout = lastAttempt?.error && /ACCOUNT_NOT_ACTIVATED|PAYMENTS_NOT_ENABLED/.test(lastAttempt.error) ? lastAttempt : null
  let accountState: BachsConnection["account"]
  let accountNote: string
  if (errors.some((e) => e.kind === "not_activated")) {
    accountState = "not_activated"
    accountNote = "Bachs answers ACCOUNT_NOT_ACTIVATED: finish account verification in the Bachs dashboard before taking live payments."
  } else if (refusedCheckout) {
    accountState = "not_activated"
    accountNote = `Bachs refused the latest checkout (${refusedCheckout.error!.match(/ACCOUNT_NOT_ACTIVATED|PAYMENTS_NOT_ENABLED/)![0]}, ${refusedCheckout.at.slice(0, 16).replace("T", " ")} UTC): finish account verification in the Bachs dashboard.`
  } else if (account.ok && account.data.isActive === false) {
    accountState = "deactivated"
    accountNote = "Bachs reports the account as deactivated: it can't take payments or move funds."
  } else if (account.ok) {
    accountState = "active"
    accountNote = cfg.live
      ? "The account is active. Bachs has no read-only activation flag; a live account that isn't verified yet answers ACCOUNT_NOT_ACTIVATED when a checkout is created, which would show here."
      : "The sandbox account is active (sandbox needs no verification)."
  } else {
    accountState = "unknown"
    accountNote = "The account couldn't be read from Bachs."
  }
  let apiHost = cfg.apiBase
  try {
    apiHost = new URL(cfg.apiBase).host
  } catch {}

  /* Webhook health. */
  const problems: string[] = []
  if (!cfg.webhookSecretSet) problems.push("BACHS_WEBHOOK_SECRET isn't set: every Bachs webhook is refused, and payments are confirmed only when shoppers come back to Yard.")
  if (log.failedOpen) problems.push(`${log.failedOpen} stored event${log.failedOpen === 1 ? "" : "s"} failed to process. Replay ${log.failedOpen === 1 ? "it" : "them"} from Orders › Payment events once the cause is fixed.`)
  if (endpoint.ok && endpoint.data) {
    if (endpoint.data.enabled === false) problems.push(endpoint.data.disabledReason === "consecutive_failures" ? "Bachs turned the webhook endpoint off after 72 hours of failed deliveries. Fix the cause, then enable it in the Bachs Developer Portal." : "The webhook endpoint is disabled in Bachs.")
    if (endpoint.data.missingEvents.length) problems.push(`The endpoint isn't subscribed to ${endpoint.data.missingEvents.join(", ")}.`)
    if (endpoint.data.deliveries7d?.failed) problems.push(`Bachs counts ${endpoint.data.deliveries7d.failed} failed deliver${endpoint.data.deliveries7d.failed === 1 ? "y" : "ies"} to Yard in the last 7 days (Yard refuses a delivery with a bad signature without storing it).`)
  } else if (endpoint.ok && !endpoint.data) problems.push("No Bachs webhook endpoint points at /api/webhooks/bachs.")
  const webhooks: WebhookHealth = { ...log, secretSet: cfg.webhookSecretSet, problems, endpoint, state: problems.length ? "attention" : log.recent.length ? "ok" : "none" }

  return {
    connected: true,
    generatedAt,
    connection: { environment: cfg.live ? "live" : "sandbox", apiHost, key: keyStatus, keyNote, account: accountState, accountNote, webhookSecretSet: cfg.webhookSecretSet, missingScopes },
    account,
    balances,
    reconciliation: reconcileBachs(balances.ok ? balances.data : null, ledger),
    payments: paymentsSection,
    refunds: refundsSection,
    disputes: disputesSection,
    payouts: payoutList,
    webhooks,
    dashboardUrl: BACHS_DASHBOARD_URL,
  }
}
