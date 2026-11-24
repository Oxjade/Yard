import assert from "node:assert/strict"
import test from "node:test"
import {
  BachsAccessDenied,
  buildBachsAdminView,
  classifyBachsError,
  methodLabel,
  parseBachsAccount,
  parseBachsBalances,
  parseBachsDispute,
  parseBachsList,
  parseBachsPayment,
  parseBachsPayout,
  parseBachsRefund,
  parseEndpointMetrics,
  pickYardEndpoint,
  reconcileBachs,
  TtlCache,
  type BachsAdminDeps,
  type LedgerCurrencyRow,
  type OrderLookup,
} from "./bachs-admin-core"

/* Fixtures: the response examples from the Bachs API reference (docs.bachs.io › API reference,
 * openapi.json as published 2026-11), copied verbatim. */
const BALANCES = {
  account_id: "acct_7KpQ2mNv4XbR9dLc",
  balances: [
    { currency: "NGN", available_balance: "58700.00", pending_balance: "0.00" },
    { currency: "USD", available_balance: "95178.20", pending_balance: "0.00" },
  ],
  total_balance_usd: "95221.29",
  pending_settlements_by_day: [],
}
const PAYMENTS = {
  items: [
    {
      id: "chrg_1a2b3c4d5e",
      reference: "order_9876",
      status: "succeeded",
      is_refundable: true,
      amount: "10.00",
      customer_name: "Jane Doe",
      customer_email: "customer@example.com",
      amount_paid: "10.00",
      amount_remaining: "0.00",
      settlement_amount: "10.00",
      fee: "0.90",
      vat: null,
      currency: "USD",
      settlement_currency: "USD",
      meta: null,
      transaction_date: "2026-04-27T12:00:00Z",
      completed_at: "2026-04-27T12:00:05Z",
    },
  ],
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50, offset: 0, returned: 1, total: 1 },
}
const REFUNDS = {
  total: 2,
  items: [
    { refund_id: "b7f2c41a-9d38-4e6b-8c15-2a7d0e934f61", charge_id: "ch_9f4c1d2e7b6a4f8e9c0d1a2b3c4d5e6f", reference: "RF-20260713-0042", status: "success", requested_amount: "29.00", refunded_amount: "29.00", refund_fee_amount: "0.00", fee_bearer: "org", reason: "Customer requested cancellation", created_at: "2026-07-13T14:20:00.000Z", updated_at: "2026-07-13T14:26:41.220Z", completed_at: "2026-07-13T14:26:41.220Z" },
    { refund_id: "5e91d7c3-84b0-4a26-9df1-6c027b3849ea", charge_id: "ch_71c3f8e0a94b25d6c8f10e4a3b975d2c", reference: "RF-20260711-0007", status: "failed", requested_amount: "75000.00", refunded_amount: null, refund_fee_amount: "0.00", fee_bearer: "org", reason: "Duplicate order", created_at: "2026-07-11T16:02:11.870Z", updated_at: "2026-07-11T16:04:58.310Z", completed_at: "2026-07-11T16:04:58.310Z" },
  ],
}
const DISPUTES = {
  total: 1,
  items: [{ dispute_id: "dsp_3e7b1c9a2f48", charge_id: "ch_8f3a1c9b4e72", amount: "75.00", currency: "USD", status: "needs_response", is_response_editable: true, reason: "fraudulent", response_deadline_at: "2026-03-23T23:59:59.000Z", created_at: "2026-03-09T08:00:00.000Z", updated_at: "2026-03-09T08:00:00.000Z" }],
}
const PAYOUTS = {
  total: 1,
  items: [{ id: "pay_4Xr9dLc0mNv7Kq2B", status: "processing", amount: "5000.00", currency: "NGN", source_currency: "NGN", fee: "100.00", total_debited: "5100.00", destination: "pd_7Kq2mNv4XbR9dLc0", reference: "WD-20260222-001", narration: "Bachs Payout", session_id: null, failure_reason: null, created_at: "2026-02-22T12:00:00.000Z", completed_at: null }],
}
const ACCOUNT = {
  id: "acct_7KpQ2mNv4XbR9dLc",
  name: "Ada Stores",
  owner_user_id: "usr_7b3e19d24c0a",
  parent_organization_id: null,
  country: "NG",
  fee_handling: "account_pays_fee",
  enabled_payment_methods: { USD_CARD: { enabled: true }, NGN_CARD: { enabled: true }, NGN_BANK_TRANSFER: { enabled: true }, MOMO_GHS: { enabled: true }, CRYPTO: { enabled: true, currencies: { USDT_TRC20: true, USDC_BEP20: true } } },
  adaptive_pricing: true,
  balance_currencies: ["NGN", "USD"],
  phone_number: null,
  company_name: null,
  enabled_capabilities: ["payouts", "conversions", "connect"],
  capabilities: null,
  requirements: null,
  is_active: true,
  created_at: "2026-08-01T09:12:44.000Z",
  updated_at: "2026-08-07T11:04:22.518Z",
  responsibilities: null,
  configuration: null,
}
const ENDPOINTS = {
  items: [
    { endpoint_id: "whe_a1e823c073ab743ce5969ceef2db4d42", name: "Production events", url: "https://api.example.com/webhooks/bachs", enabled: true, disabled_at: null, disabled_reason: null, event_types: ["checkout.completed", "collection.succeeded", "payout.paid", "refund.paid"], event_source: "account", created_at: "2026-03-09T10:00:00.000Z", updated_at: "2026-03-09T10:00:00.000Z" },
    { endpoint_id: "whe_e1eae19222ebc5e7e2b4270eaf6f4dec", name: "Account monitor", url: "https://api.example.com/webhooks/bachs/connected", enabled: false, disabled_at: "2026-03-12T14:05:00.000Z", disabled_reason: "consecutive_failures", event_types: ["account.updated", "capability.updated", "transfer.created"], event_source: "connect", created_at: "2026-02-14T08:30:00.000Z", updated_at: "2026-03-12T14:05:00.000Z" },
  ],
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50, offset: 0, returned: 2, total: 2 },
}
const METRICS = {
  total: "160",
  period: "day",
  data: [
    { date: "2026-03-03", success: 22, failed: 0 },
    { date: "2026-03-04", success: 19, failed: 1 },
    { date: "2026-03-05", success: 25, failed: 0 },
    { date: "2026-03-06", success: 18, failed: 0 },
    { date: "2026-03-07", success: 27, failed: 2 },
    { date: "2026-03-08", success: 21, failed: 0 },
    { date: "2026-03-09", success: 24, failed: 1 },
  ],
}
/** The documented error body (components.schemas.Error). */
const httpError = (status: number, error_code: string, detail: string) => Object.assign(new Error(`Bachs GET: ${error_code}: ${detail}`), { httpStatus: status, code: error_code })

/* ---------- Parsing ---------- */

test("balances: available and pending per currency in minor units, USD total kept as sent", () => {
  const b = parseBachsBalances(BALANCES)
  assert.equal(b.accountId, "acct_7KpQ2mNv4XbR9dLc")
  assert.deepEqual(
    b.balances.map((x) => [x.currency, x.available.minor, x.pending.minor, x.totalMinor]),
    [
      ["NGN", 5_870_000, 0, 5_870_000],
      ["USD", 9_517_820, 0, 9_517_820],
    ],
  )
  assert.equal(b.totalUsd, "95221.29")
  assert.deepEqual(b.pendingSettlements, { count: 0, days: [] })
  // A crypto bucket (precision unknown to Yard) is shown as sent, not converted.
  const crypto = parseBachsBalances({ ...BALANCES, balances: [{ currency: "USDT_TRC20", available_balance: "12.345678", pending_balance: "0" }] })
  assert.deepEqual([crypto.balances[0].available.amount, crypto.balances[0].available.minor, crypto.balances[0].totalMinor], ["12.345678", null, null])
  // A dispute hold can take a bucket below zero: the sign is kept.
  const negative = parseBachsBalances({ ...BALANCES, balances: [{ currency: "USD", available_balance: "0.00", pending_balance: "-1.80" }] })
  assert.deepEqual([negative.balances[0].pending.minor, negative.balances[0].totalMinor], [-180, -180])
  assert.throws(() => parseBachsBalances({ account_id: "x" }), /balances missing/)
})

test("account: id, active flag, held currencies and the enabled corridors", () => {
  const a = parseBachsAccount(ACCOUNT)
  assert.deepEqual(a, { id: "acct_7KpQ2mNv4XbR9dLc", name: "Ada Stores", country: "NG", isActive: true, balanceCurrencies: ["NGN", "USD"], enabledMethods: ["USD_CARD", "NGN_CARD", "NGN_BANK_TRANSFER", "MOMO_GHS", "CRYPTO"], feeHandling: "account_pays_fee" })
  assert.throws(() => parseBachsAccount({ name: "no id" }), /account id/)
})

test("lists: both documented envelopes ({ items, pagination } and { total, items })", () => {
  assert.deepEqual([parseBachsList(PAYMENTS).total, parseBachsList(PAYMENTS).hasMore, parseBachsList(PAYMENTS).items.length], [1, false, 1])
  assert.deepEqual([parseBachsList(REFUNDS).total, parseBachsList(REFUNDS).hasMore], [2, false])
  assert.throws(() => parseBachsList({ data: [] }), /items/)
})

test("payment: status, amounts, fee, settlement and the reference Yard matches orders by", () => {
  const p = parseBachsPayment(PAYMENTS.items[0])
  assert.equal(p.id, "chrg_1a2b3c4d5e")
  assert.equal(p.reference, "order_9876")
  assert.equal(p.status, "succeeded")
  assert.deepEqual(p.amount, { amount: "10.00", currency: "USD", minor: 1000 })
  assert.deepEqual(p.fee, { amount: "0.90", currency: "USD", minor: 90 })
  assert.deepEqual(p.settlement, { amount: "10.00", currency: "USD", minor: 1000 })
  assert.equal(p.createdAt, "2026-04-27T12:00:00Z")
  assert.equal(p.completedAt, "2026-04-27T12:00:05Z")
  // payment_method / source as the List payments schema documents them.
  const q = parseBachsPayment({ ...PAYMENTS.items[0], reference: null, payment_method: { type: "ngn_bank_transfer", brand: null, last4: null }, source: { type: "checkout", checkout_id: "chk_1", reference: "yp_ref" } })
  assert.deepEqual([q.method, q.checkoutId, q.reference], ["NGN bank transfer", "chk_1", "yp_ref"])
  assert.equal(methodLabel({ type: "card", brand: "visa", last4: "4242" }), "Card · visa · •4242")
  assert.equal(methodLabel(null), null)
})

test("refund: no currency of its own, so it takes the charge's settlement currency", () => {
  const r = parseBachsRefund(REFUNDS.items[1], "NGN")
  assert.deepEqual([r.refundId, r.chargeId, r.reference, r.status], ["5e91d7c3-84b0-4a26-9df1-6c027b3849ea", "ch_71c3f8e0a94b25d6c8f10e4a3b975d2c", "RF-20260711-0007", "failed"])
  assert.deepEqual(r.requested, { amount: "75000.00", currency: "NGN", minor: 7_500_000 })
  assert.deepEqual(r.refunded, { amount: null, currency: "NGN", minor: null })
  assert.deepEqual(parseBachsRefund(REFUNDS.items[0]).requested, { amount: "29.00", currency: null, minor: null })
})

test("dispute: needs a response while editable and before Bachs closes it", () => {
  const d = parseBachsDispute(DISPUTES.items[0])
  assert.deepEqual([d.disputeId, d.chargeId, d.status, d.reason, d.responseDeadlineAt, d.needsResponse], ["dsp_3e7b1c9a2f48", "ch_8f3a1c9b4e72", "needs_response", "fraudulent", "2026-03-23T23:59:59.000Z", true])
  assert.deepEqual(d.amount, { amount: "75.00", currency: "USD", minor: 7500 })
  assert.equal(parseBachsDispute({ ...DISPUTES.items[0], status: "under_review", is_response_editable: false }).needsResponse, false)
})

test("payout: amount in the destination currency, fee and total debited in the source currency", () => {
  const p = parseBachsPayout(PAYOUTS.items[0])
  assert.deepEqual([p.id, p.status, p.reference, p.amount.minor, p.fee.minor, p.totalDebited.minor, p.completedAt], ["pay_4Xr9dLc0mNv7Kq2B", "processing", "WD-20260222-001", 500_000, 10_000, 510_000, null])
})

test("webhook endpoint: Yard's endpoint is picked by path and host; missing subscriptions are listed", () => {
  const yard = { ...ENDPOINTS.items[0], endpoint_id: "whe_yard", url: "https://yard.example/api/webhooks/bachs" }
  const e = pickYardEndpoint({ ...ENDPOINTS, items: [...ENDPOINTS.items, yard] }, "https://yard.example")
  assert.equal(e?.id, "whe_yard")
  assert.deepEqual(e?.missingEvents, ["checkout.expired", "refund.created", "refund.failed"])
  assert.equal(pickYardEndpoint(ENDPOINTS, "https://yard.example"), null)
  assert.deepEqual(parseEndpointMetrics(METRICS), { success: 156, failed: 4 })
})

/* ---------- Errors ---------- */

test("errors: key refused, missing permission, not activated, unavailable", () => {
  assert.equal(classifyBachsError(httpError(401, "UNAUTHORIZED", "Invalid API key")).kind, "unauthorized")
  const f = classifyBachsError(httpError(403, "FORBIDDEN", "API key does not have permission for this operation"), "disputes:read")
  assert.equal(f.kind, "forbidden")
  assert.match(f.message, /disputes:read/)
  assert.equal(classifyBachsError(httpError(400, "ACCOUNT_NOT_ACTIVATED", "not approved")).kind, "not_activated")
  assert.equal(classifyBachsError(httpError(503, "SERVICE_UNAVAILABLE", "down")).kind, "unavailable")
  assert.equal(classifyBachsError(httpError(429, "TOO_MANY_REQUESTS", "slow down")).kind, "unavailable")
  assert.equal(classifyBachsError(new Error("Bachs unreachable: The operation was aborted due to timeout")).kind, "unavailable")
  assert.equal(classifyBachsError(httpError(404, "NOT_FOUND", "x")).kind, "refused")
})

/* ---------- Reconciliation ---------- */

const ledgerRow = (currency: string, o: Partial<LedgerCurrencyRow> = {}): LedgerCurrencyRow => ({ currency, providerClearingMinor: 0, commissionMinor: 0, adjustmentsMinor: 0, brandPendingMinor: 0, brandAvailableMinor: 0, brandReserveMinor: 0, brandInPayoutMinor: 0, ...o })
const balances = (rows: [string, string, string][]) => parseBachsBalances({ account_id: "acct_x", balances: rows.map(([currency, available_balance, pending_balance]) => ({ currency, available_balance, pending_balance })), total_balance_usd: "0.00", pending_settlements_by_day: [] })

test("reconciliation: Bachs total equal to the ledger is a match", () => {
  // ₦50,000 held for brands + ₦2,500 commission = ₦52,500 at the provider; Bachs has ₦40,000 available + ₦12,500 pending.
  const [ngn] = reconcileBachs(balances([["NGN", "40000.00", "12500.00"]]), [ledgerRow("NGN", { providerClearingMinor: 5_250_000, brandPendingMinor: 3_000_000, brandAvailableMinor: 1_500_000, brandReserveMinor: 500_000, commissionMinor: 250_000 })])
  assert.equal(ngn.status, "match")
  assert.deepEqual(ngn.bachs, { availableMinor: 4_000_000, pendingMinor: 1_250_000, totalMinor: 5_250_000 })
  assert.deepEqual(ngn.ledger, { atProviderMinor: 5_250_000, owedToBrandsMinor: 5_000_000, commissionMinor: 250_000, adjustmentsMinor: 0 })
  assert.equal(ngn.differenceMinor, 0)
})

test("reconciliation: any difference is a mismatch; less than Yard owes brands is a shortfall", () => {
  const ledger = [ledgerRow("NGN", { providerClearingMinor: 5_250_000, brandAvailableMinor: 5_000_000, commissionMinor: 250_000 })]
  const fees = reconcileBachs(balances([["NGN", "52400.00", "0.00"]]), ledger)[0]
  assert.deepEqual([fees.status, fees.differenceMinor], ["mismatch", -10_000])
  assert.match(fees.message, /fees/)
  const more = reconcileBachs(balances([["NGN", "52500.01", "0.00"]]), ledger)[0]
  assert.deepEqual([more.status, more.differenceMinor], ["mismatch", 1])
  const short = reconcileBachs(balances([["NGN", "49999.99", "0.00"]]), ledger)[0]
  assert.deepEqual([short.status, short.differenceMinor], ["shortfall", -250_001])
})

test("reconciliation: currencies Bachs doesn't hold aren't compared, and USD says why it can't match", () => {
  const lines = reconcileBachs(balances([["NGN", "0.00", "0.00"], ["USD", "120.00", "0.00"]]), [ledgerRow("GHS", { providerClearingMinor: 50_000, brandPendingMinor: 47_500, commissionMinor: 2_500 }), ledgerRow("USD", { providerClearingMinor: 10_000, brandPendingMinor: 10_000 })])
  const by = Object.fromEntries(lines.map((l) => [l.currency, l]))
  assert.equal(by.GHS.status, "not_held")
  assert.equal(by.GHS.differenceMinor, null)
  assert.equal(by.USD.status, "mismatch")
  assert.match(by.USD.note ?? "", /GHS/)
  assert.equal(by.NGN.status, "match")
  assert.deepEqual(lines.map((l) => l.currency), ["NGN", "USD", "GHS"])
})

test("reconciliation: without a Bachs balance nothing is compared", () => {
  const lines = reconcileBachs(null, [ledgerRow("NGN", { providerClearingMinor: 100 })])
  assert.deepEqual(lines.map((l) => [l.currency, l.status, l.differenceMinor]), [["NGN", "unavailable", null], ["USD", "unavailable", null]])
})

/* ---------- Cache ---------- */

test("cache: one request per key per minute, shared by concurrent callers; failures retried sooner", async () => {
  let t = 1_000_000
  const cache = new TtlCache(() => t)
  let calls = 0
  const load = async () => ++calls
  const opts = { ttlMs: 60_000, errorTtlMs: 20_000 }
  const [a, b2] = await Promise.all([cache.get("k", load, opts), cache.get("k", load, opts)])
  assert.deepEqual([a.ok && a.value, b2.ok && b2.value, calls], [1, 1, 1])
  t += 59_000
  assert.equal(((await cache.get("k", load, opts)) as { value: number }).value, 1)
  t += 2_000
  assert.equal(((await cache.get("k", load, opts)) as { value: number }).value, 2)
  let fails = 0
  const boom = async () => {
    fails++
    throw new Error("down")
  }
  assert.equal((await cache.get("e", boom, opts)).ok, false)
  await cache.get("e", boom, opts)
  assert.equal(fails, 1)
  t += 20_001
  await cache.get("e", boom, opts)
  assert.equal(fails, 2)
})

/* ---------- The whole view ---------- */

const noOrders: OrderLookup = { byPaymentRef: {}, byCheckoutId: {}, byChargeId: {}, byRefundRef: {}, byRefundId: {}, chargeCurrency: {} }
const emptyLog = { recent: [], lastReceivedAt: null, lastProcessedAt: null, failedOpen: 0, recentFailures: [], received7d: 0 }
function deps(over: Partial<BachsAdminDeps> = {}, answers: Record<string, unknown> = {}): BachsAdminDeps & { calls: string[] } {
  const calls: string[] = []
  const routes: Record<string, unknown> = {
    "/v1/accounts/me": ACCOUNT,
    "/v1/balances": BALANCES,
    "/v1/payments": PAYMENTS,
    "/v1/refunds": REFUNDS,
    "/v1/disputes": DISPUTES,
    "/v1/payouts": PAYOUTS,
    "/v1/webhooks/endpoints": { ...ENDPOINTS, items: [{ ...ENDPOINTS.items[0], endpoint_id: "whe_yard", url: "https://yard.example/api/webhooks/bachs", event_types: ["*"] }] },
    "/v1/webhooks/endpoints/whe_yard/metrics": METRICS,
    ...answers,
  }
  return {
    calls,
    payments: { provider: "bachs", bachs: { live: true, apiBase: "https://api.bachs.io", webhookSecretSet: true, keyFingerprint: "abc" } },
    publicOrigin: "https://yard.example",
    bachsGet: async (path) => {
      calls.push(path)
      const a = routes[path.split("?")[0]]
      if (a instanceof Error) throw a
      if (a === undefined) throw httpError(404, "NOT_FOUND", path)
      return a
    },
    cache: new TtlCache(),
    ledger: async () => [ledgerRow("NGN", { providerClearingMinor: 5_870_000, brandAvailableMinor: 5_500_000, commissionMinor: 370_000 })],
    webhookLog: async () => emptyLog,
    lookupOrders: async () => ({ ...noOrders, byPaymentRef: { order_9876: [{ id: "ord_1", reference: "Y-1001" }] }, byChargeId: { ch_8f3a1c9b4e72: [{ id: "ord_2", reference: "Y-1002" }] }, byRefundRef: { "RF-20260711-0007": [{ id: "ord_3", reference: "Y-1003" }] }, chargeCurrency: { ch_71c3f8e0a94b25d6c8f10e4a3b975d2c: "NGN" } }),
    lastCheckoutAttempt: async () => null,
    now: () => new Date("2026-11-24T10:00:00Z"),
    ...over,
  }
}

test("permission refused: a role without finance access reads nothing, from Bachs or the database", async () => {
  const touched: string[] = []
  const d = deps({ ledger: async () => (touched.push("ledger"), []), webhookLog: async () => (touched.push("log"), emptyLog), lookupOrders: async () => (touched.push("orders"), noOrders), lastCheckoutAttempt: async () => (touched.push("attempt"), null) })
  for (const role of ["support", "trust_safety", "ads_ops", "engineering"] as const) await assert.rejects(buildBachsAdminView(role, d), BachsAccessDenied)
  assert.deepEqual([d.calls, touched], [[], []])
  assert.equal((await buildBachsAdminView("finance", d)).connected, true)
})

test("payments off, stub or Paystack: 'Bachs isn't connected' and nothing is asked of Bachs", async () => {
  for (const provider of ["off", "stub", "paystack"] as const) {
    const d = deps({ payments: { provider, bachs: null } })
    const v = await buildBachsAdminView("owner", d)
    assert.equal(v.connected, false)
    if (!v.connected) {
      assert.equal(v.reason, provider)
      assert.match(v.message, /Bachs isn't connected/)
    }
    assert.deepEqual(d.calls, [])
  }
})

test("connected: every section parsed, orders linked, reconciliation computed, key never in the view", async () => {
  const d = deps()
  const v = await buildBachsAdminView("owner", d)
  assert.equal(v.connected, true)
  if (!v.connected) return
  assert.deepEqual(v.connection, { environment: "live", apiHost: "api.bachs.io", key: "valid", keyNote: "Bachs accepts the key.", account: "active", accountNote: v.connection.accountNote, webhookSecretSet: true, missingScopes: [] })
  assert.ok(v.payments.ok && v.payments.data.items[0].orders[0].reference === "Y-1001")
  assert.ok(v.refunds.ok)
  if (v.refunds.ok) {
    assert.deepEqual(v.refunds.data.items[1].orders, [{ id: "ord_3", reference: "Y-1003" }])
    assert.equal(v.refunds.data.items[1].requested.minor, 7_500_000)
    // The charge of the first refund is unknown to Yard and to the payment page: no currency guessed.
    assert.equal(v.refunds.data.items[0].requested.currency, null)
  }
  assert.ok(v.disputes.ok && v.disputes.data.needsResponse === 1 && v.disputes.data.items[0].orders[0].id === "ord_2")
  assert.equal(v.dashboardUrl, "https://app.bachs.io")
  assert.deepEqual(v.reconciliation.map((l) => [l.currency, l.status]), [["NGN", "match"], ["USD", "mismatch"]])
  assert.ok(v.webhooks.endpoint.ok && v.webhooks.endpoint.data?.deliveries7d?.failed === 4)
  assert.equal(v.webhooks.state, "attention")
  assert.equal(JSON.stringify(v).includes("abc"), false)
  // The second load within a minute is served from the cache.
  const n = d.calls.length
  await buildBachsAdminView("owner", d)
  assert.equal(d.calls.length, n)
})

test("Bachs down or slow: each section says unavailable, Yard's ledger still shows", async () => {
  const down = httpError(503, "SERVICE_UNAVAILABLE", "maintenance")
  const d = deps({}, { "/v1/accounts/me": down, "/v1/balances": down, "/v1/payments": down, "/v1/refunds": down, "/v1/disputes": down, "/v1/payouts": down, "/v1/webhooks/endpoints": down })
  const v = await buildBachsAdminView("owner", d)
  assert.ok(v.connected)
  if (!v.connected) return
  for (const sct of [v.balances, v.payments, v.refunds, v.disputes, v.payouts]) assert.ok(!sct.ok && sct.error.kind === "unavailable" && /Bachs unavailable/.test(sct.error.message))
  assert.deepEqual([v.connection.key, v.connection.account], ["unknown", "unknown"])
  assert.equal(v.reconciliation[0].status, "unavailable")
  assert.equal(v.reconciliation[0].ledger.atProviderMinor, 5_870_000)
})

test("connection: ACCOUNT_NOT_ACTIVATED, a refused key, missing scopes, no webhook secret", async () => {
  const na = httpError(400, "ACCOUNT_NOT_ACTIVATED", "The account has payment methods configured but is not yet approved")
  let v = await buildBachsAdminView("owner", deps({}, { "/v1/payments": na }))
  assert.ok(v.connected && v.connection.account === "not_activated" && v.connection.key === "valid")
  v = await buildBachsAdminView("owner", deps({ lastCheckoutAttempt: async () => ({ at: "2026-11-24T09:00:00.000Z", error: "Bachs POST /v1/checkout-sessions: ACCOUNT_NOT_ACTIVATED: not approved" }) }))
  assert.ok(v.connected && v.connection.account === "not_activated" && /latest checkout/.test(v.connection.accountNote))
  const bad = httpError(401, "UNAUTHORIZED", "Invalid API key")
  v = await buildBachsAdminView("owner", deps({}, Object.fromEntries(["/v1/accounts/me", "/v1/balances", "/v1/payments", "/v1/refunds", "/v1/disputes", "/v1/payouts", "/v1/webhooks/endpoints"].map((p) => [p, bad]))))
  assert.ok(v.connected && v.connection.key === "invalid")
  const forbidden = httpError(403, "FORBIDDEN", "API key does not have permission for this operation")
  v = await buildBachsAdminView("owner", deps({ payments: { provider: "bachs", bachs: { live: false, apiBase: "https://sandbox-api.bachs.io", webhookSecretSet: false, keyFingerprint: "def" } } }, { "/v1/disputes": forbidden, "/v1/webhooks/endpoints": forbidden }))
  assert.ok(v.connected)
  if (!v.connected) return
  assert.deepEqual([v.connection.environment, v.connection.key, v.connection.missingScopes, v.connection.webhookSecretSet], ["sandbox", "valid", ["disputes:read", "webhooks:read"], false])
  assert.ok(!v.disputes.ok && /disputes:read/.test(v.disputes.error.message))
  assert.ok(v.webhooks.problems.some((p) => /BACHS_WEBHOOK_SECRET/.test(p)))
})
