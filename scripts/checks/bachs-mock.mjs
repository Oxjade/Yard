#!/usr/bin/env node
// A LOCAL MOCK of the Bachs API (https://docs.bachs.io), just the endpoints Yard uses, with the
// request and response shapes copied from the Bachs docs. Never moves money; never talks to Bachs.
//
//   node scripts/checks/bachs-mock.mjs [port]      (standalone; default port 3248)
//   import { startBachsMock } from "./bachs-mock.mjs"   (the e2e kit runs it in-process)
//
// Endpoints (Authorization: Bearer sk_live_… or sk_sandbox_…; anything else is 401):
//   POST /v1/checkout-sessions           { pricing: { currency, amount: "75000.00" }, customer, reference,
//                                          metadata, success_url?, cancel_url?, payment_method_types?,
//                                          expires_in_minutes? } + Idempotency-Key → 201 session
//   GET  /v1/checkout-sessions/{id}      → session (charge: null until paid)
//   POST /v1/refunds                     { charge_id, reference, amount?, reason, idempotency_key } → 201 refund
//                                          (ONE refund per charge: a second → 409 CONFLICT, as Bachs does)
//   GET  /v1/refunds/by-charge/{id}      → refund or 404
//   GET  /c/{token}                      → the "hosted checkout" page (HTML)
// Read endpoints (Admin › Finance › Bachs; shapes from the API reference, derived from the mock's state):
//   GET  /v1/accounts/me                 → the account (is_active, balance_currencies, enabled_payment_methods)
//   GET  /v1/balances                    → { account_id, balances: [{ currency, available_balance, pending_balance }],
//                                          total_balance_usd, pending_settlements_by_day } (NGN available at once,
//                                          USD pending, as Bachs settles them; minus fees, refunds, disputes, payouts)
//   GET  /v1/payments?limit              → { items, pagination } newest first
//   GET  /v1/refunds?limit               → { total, items }
//   GET  /v1/disputes?limit              → { total, items }
//   GET  /v1/payouts?limit               → { total, items }
//   GET  /v1/webhooks/endpoints          → { items, pagination } (the endpoint given as `webhookUrl`, if any)
//   GET  /v1/webhooks/endpoints/{id}/metrics → { total, period: "day", data: [{ date, success, failed }] }
// Options: { port, host, webhookUrl, feeBps (Bachs fee per charge, default 0), seed (a sample dispute,
// withdrawal and failed refund on top of what Yard does), refuse: { "/v1/disputes": [403, "FORBIDDEN"] },
// notActivated (POST /v1/checkout-sessions → 400 ACCOUNT_NOT_ACTIVATED) }.
// Test controls (in-process only): pay(), expire(), settleRefund() mutate state and return the webhook
// envelopes Bachs would send; the caller signs and delivers them. dispute(chargeId) opens a dispute.
// Standalone: node scripts/checks/bachs-mock.mjs [port] [--seed] [--webhook-url URL] [--fee-bps N]
import http from "node:http"
import { randomBytes } from "node:crypto"
import { pathToFileURL } from "node:url"

const id = (prefix) => `${prefix}_${randomBytes(8).toString("hex")}`
const CORRIDORS = new Set(["USD_CARD", "NGN_CARD", "NGN_BANK_TRANSFER", "MOMO_GHS", "MOMO_KES", "MOMO_TZS", "MOMO_UGX", "MOMO_XAF", "MOMO_XOF", "MOMO_RWF", "MOMO_MWK", "MOMO_ZMW", "CRYPTO"])
const CURRENCIES = new Set(["USD", "NGN", "GHS", "KES", "MWK", "RWF", "TZS", "UGX", "XAF", "XOF", "ZMW"])
const isAmount = (s) => typeof s === "string" && /^\d+\.\d{2}$/.test(s)
const privateHost = (u) => {
  try {
    const h = new URL(u).hostname
    return h === "localhost" || /^(127|10)\./.test(h) || /^192\.168\./.test(h)
  } catch {
    return true
  }
}

export function startBachsMock({ port = 3248, host = "127.0.0.1", webhookUrl = null, feeBps = 0, seed = false, refuse = {}, notActivated = false } = {}) {
  const state = { sessions: new Map(), charges: new Map(), refunds: new Map(), disputes: new Map(), payouts: new Map(), references: new Set(), idempotency: new Map(), requests: [], deliveries: [] }
  let url = `http://${host}:${port}`

  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "X-RateLimit-Limit": "500", "X-RateLimit-Remaining": "499" })
    res.end(JSON.stringify(body))
  }
  const err = (res, status, error_code, detail) => send(res, status, { error_code, detail, message: detail })

  const sessionView = (s) => ({
    checkout_id: s.checkout_id,
    checkout_url: s.checkout_url,
    mode: "payment",
    status: s.status,
    payment_status: s.status === "completed" ? "paid" : null,
    amount: s.amount,
    currency: s.currency,
    billing_currency: s.currency,
    reference: s.reference,
    metadata: s.metadata,
    customer: null,
    customer_details: s.customer ? { email: s.customer.email ?? null, name: s.customer.name ?? null } : null,
    payment_method_types: s.payment_method_types,
    charge: s.charge_id ? state.charges.get(s.charge_id) : null,
    success_url: s.success_url,
    cancel_url: s.cancel_url,
    completed_at: s.completed_at,
    expires_at: s.expires_at,
    created_at: s.created_at,
  })

  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString("utf8")
    const path = new URL(req.url, url).pathname
    state.requests.push({ method: req.method, path, headers: req.headers, body: raw })

    if (req.method === "GET" && path.startsWith("/c/")) {
      res.writeHead(200, { "Content-Type": "text/html" })
      return res.end("<!doctype html><title>Bachs mock checkout</title><h1>Bachs mock checkout</h1>")
    }
    const auth = req.headers.authorization ?? ""
    if (!/^Bearer sk_(live|sandbox)_\S+$/.test(auth)) return err(res, 401, "UNAUTHORIZED", "The API key is missing or invalid.")
    const refused = refuse[path] ?? refuse[path.replace(/\/[^/]+\/metrics$/, "/{id}/metrics")]
    if (refused) return err(res, refused[0], refused[1], refused[2] ?? (refused[1] === "FORBIDDEN" ? "API key does not have permission for this operation" : "Refused by the mock"))
    if (notActivated && req.method === "POST" && path === "/v1/checkout-sessions") return err(res, 400, "ACCOUNT_NOT_ACTIVATED", "The account has payment methods configured but is not yet approved to accept live payments.")
    let body = null
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        return err(res, 400, "BAD_REQUEST", "Body isn't JSON.")
      }
    }
    const idem = req.headers["idempotency-key"]
    if (req.method === "POST" && idem && state.idempotency.has(`${path}|${idem}`)) {
      const cached = state.idempotency.get(`${path}|${idem}`)
      return send(res, cached.status, cached.body)
    }
    const remember = (status, out) => {
      if (req.method === "POST" && idem) state.idempotency.set(`${path}|${idem}`, { status, body: out })
      return send(res, status, out)
    }

    // POST /v1/checkout-sessions
    if (req.method === "POST" && path === "/v1/checkout-sessions") {
      if (!body || (!!body.pricing === !!body.product_cart)) return err(res, 400, "VALIDATION_ERROR", "Provide exactly one of product_cart or pricing.")
      const p = body.pricing
      if (!p || !CURRENCIES.has(p.currency) || !isAmount(p.amount)) return err(res, 400, "VALIDATION_ERROR", "pricing needs a supported currency and a decimal-string amount at the currency's precision.")
      if (body.reference !== undefined && (typeof body.reference !== "string" || body.reference.length > 128)) return err(res, 400, "VALIDATION_ERROR", "reference must be a string of at most 128 characters.")
      if (body.reference && state.references.has(body.reference)) return err(res, 409, "CONFLICT", "A checkout with this reference already exists.")
      for (const k of ["success_url", "cancel_url"]) if (body[k] && privateHost(body[k])) return err(res, 400, "VALIDATION_ERROR", `${k} must be a public http or https address.`)
      if (body.payment_method_types && (!Array.isArray(body.payment_method_types) || !body.payment_method_types.every((c) => CORRIDORS.has(c)))) return err(res, 422, "VALIDATION_ERROR", "Unknown payment method corridor.")
      if (body.metadata && Object.keys(body.metadata).length > 20) return err(res, 400, "VALIDATION_ERROR", "At most 20 metadata keys.")
      const s = {
        checkout_id: id("chk"),
        status: "open",
        amount: p.amount,
        currency: p.currency,
        reference: body.reference ?? null,
        metadata: body.metadata ?? {},
        customer: body.customer ?? null,
        payment_method_types: body.payment_method_types ?? null,
        success_url: body.success_url ?? null,
        cancel_url: body.cancel_url ?? null,
        charge_id: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (body.expires_in_minutes ?? 60) * 60_000).toISOString(),
        idempotency_key: idem ?? null,
      }
      s.checkout_url = `${url}/c/${randomBytes(6).toString("base64url")}`
      state.sessions.set(s.checkout_id, s)
      if (s.reference) state.references.add(s.reference)
      return remember(201, { checkout_id: s.checkout_id, checkout_url: s.checkout_url, mode: "payment", status: "open", amount: s.amount, currency: s.currency, expires_at: s.expires_at, created_at: s.created_at })
    }

    // GET /v1/checkout-sessions/{id}
    let m = /^\/v1\/checkout-sessions\/([\w-]+)$/.exec(path)
    if (req.method === "GET" && m) {
      const s = state.sessions.get(m[1])
      return s ? send(res, 200, sessionView(s)) : err(res, 404, "NOT_FOUND", "No such checkout session.")
    }

    // POST /v1/refunds
    if (req.method === "POST" && path === "/v1/refunds") {
      const ch = body?.charge_id ? state.charges.get(body.charge_id) : null
      if (!ch) return err(res, 404, "NOT_FOUND", "No such charge.")
      if (!body.reference || typeof body.reference !== "string") return err(res, 400, "VALIDATION_ERROR", "reference is required.")
      if (body.idempotency_key) {
        const prior = [...state.refunds.values()].find((r) => r.charge_id === ch.id && r.idempotency_key === body.idempotency_key)
        if (prior) return send(res, 201, prior)
      }
      if ([...state.refunds.values()].some((r) => r.charge_id === ch.id && r.status !== "failed")) return err(res, 409, "CONFLICT", "A refund already exists for this charge")
      if ([...state.refunds.values()].some((r) => r.reference === body.reference)) return err(res, 409, "CONFLICT", "Refund reference already exists")
      if (!["succeeded", "accepted", "underpaid"].includes(ch.status)) return err(res, 400, "BAD_REQUEST", `Charge is not refundable in status ${ch.status}`)
      if (body.amount !== undefined && !isAmount(body.amount)) return err(res, 400, "VALIDATION_ERROR", "amount must be a decimal string.")
      const requested = body.amount ?? ch.settlement_amount
      if (Number(requested) > Number(ch.settlement_amount)) return err(res, 400, "BAD_REQUEST", `Refund amount ${requested} exceeds refundable balance`)
      const now = new Date().toISOString()
      const r = { refund_id: id("rfnd"), charge_id: ch.id, reference: body.reference, status: "processing", requested_amount: requested, refunded_amount: null, refund_fee_amount: "0.00", fee_bearer: "org", reason: body.reason ?? null, idempotency_key: body.idempotency_key ?? null, created_at: now, updated_at: now, completed_at: null }
      state.refunds.set(r.refund_id, r)
      return remember(201, r)
    }

    // GET /v1/refunds/by-charge/{payment_id}
    m = /^\/v1\/refunds\/by-charge\/([\w-]+)$/.exec(path)
    if (req.method === "GET" && m) {
      const r = [...state.refunds.values()].filter((x) => x.charge_id === m[1]).pop()
      return r ? send(res, 200, r) : err(res, 404, "NOT_FOUND", "No refund for this charge.")
    }

    if (req.method === "GET") {
      const q = new URL(req.url, url).searchParams
      const limit = Math.min(100, Math.max(1, Number(q.get("limit") ?? 50) || 50))
      const offset = Math.max(0, Number(q.get("offset") ?? 0) || 0)
      const newest = (rows, key = "created_at") => [...rows].sort((a, z) => String(z[key]).localeCompare(String(a[key])))
      const page = (rows) => rows.slice(offset, offset + limit)

      if (path === "/v1/accounts/me") return send(res, 200, accountView())
      if (path === "/v1/balances") return send(res, 200, balancesView())
      if (path === "/v1/payments") {
        const all = newest([...state.charges.values()].map(paymentView), "transaction_date")
        const items = page(all)
        return send(res, 200, { items, pagination: { next_cursor: offset + items.length < all.length ? `cur_${offset + items.length}` : null, prev_cursor: null, has_more: offset + items.length < all.length, limit, offset, returned: items.length, total: all.length } })
      }
      if (path === "/v1/refunds") {
        const all = newest([...state.refunds.values()]).map(({ idempotency_key, ...r }) => (void idempotency_key, r))
        return send(res, 200, { total: all.length, items: page(all) })
      }
      if (path === "/v1/disputes") {
        const all = newest([...state.disputes.values()])
        return send(res, 200, { total: all.length, items: page(all) })
      }
      if (path === "/v1/payouts") {
        const all = newest([...state.payouts.values()])
        return send(res, 200, { total: all.length, items: page(all) })
      }
      if (path === "/v1/webhooks/endpoints") {
        const items = webhookUrl ? [endpointView()] : []
        return send(res, 200, { items, pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit, offset: 0, returned: items.length, total: items.length } })
      }
      m = /^\/v1\/webhooks\/endpoints\/([\w-]+)\/metrics$/.exec(path)
      if (m) {
        if (!webhookUrl || m[1] !== ENDPOINT_ID) return err(res, 404, "NOT_FOUND", "No such endpoint.")
        const days = []
        for (let i = 6; i >= 0; i--) {
          const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
          const ds = state.deliveries.filter((d) => d.at.startsWith(date))
          days.push({ date, success: ds.filter((d) => d.ok).length, failed: ds.filter((d) => !d.ok).length })
        }
        return send(res, 200, { total: String(days.reduce((n, d) => n + d.success + d.failed, 0)), period: "day", data: days })
      }
    }

    return err(res, 404, "NOT_FOUND", `No route ${req.method} ${path} in the mock`)
  })

  /* ---------- Read views (Admin › Finance › Bachs) ---------- */

  const ENDPOINT_ID = "whe_mockyard0000000000000000000001"
  const cents = (s) => Math.round(Number(s ?? 0) * 100)
  const dec = (c) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`
  const feeOf = (ch) => dec(Math.floor((cents(ch.settlement_amount) * feeBps) / 10_000))
  const accountView = () => ({
    id: "acct_mockYard",
    name: "Yard (mock)",
    owner_user_id: "usr_mockYard",
    parent_organization_id: null,
    country: "NG",
    fee_handling: "account_pays_fee",
    enabled_payment_methods: { USD_CARD: { enabled: true }, NGN_CARD: { enabled: true }, NGN_BANK_TRANSFER: { enabled: true }, MOMO_GHS: { enabled: true }, MOMO_KES: { enabled: true } },
    adaptive_pricing: false,
    balance_currencies: ["NGN", "USD"],
    phone_number: null,
    company_name: null,
    enabled_capabilities: ["payouts"],
    capabilities: null,
    requirements: null,
    is_active: true,
    created_at: "2026-08-01T09:12:44.000Z",
    updated_at: "2026-08-07T11:04:22.518Z",
    responsibilities: null,
    configuration: null,
  })
  const paymentView = (ch) => {
    const s = [...state.sessions.values()].find((x) => x.charge_id === ch.id)
    const method = ch.payment_method_details?.type === "card" ? { type: "card", brand: "visa", last4: "4242" } : { type: String(ch.payment_method ?? "").toLowerCase(), brand: null, last4: null }
    return {
      id: ch.id,
      reference: s?.reference ?? null,
      status: ch.status,
      failure_message: null,
      is_refundable: ["succeeded", "accepted"].includes(ch.status),
      amount: ch.amount,
      customer_name: s?.customer?.name ?? "",
      customer_email: s?.customer?.email ?? "",
      amount_paid: ch.amount,
      amount_remaining: "0.00",
      settlement_amount: ch.settlement_amount,
      settlement_currency: ch.settlement_currency,
      fee: ["succeeded", "accepted", "overpaid", "refunded", "partially_refunded"].includes(ch.status) ? feeOf(ch) : null,
      vat: null,
      currency: ch.currency,
      meta: ch.metadata ?? null,
      transaction_date: ch.created_at,
      completed_at: ch.updated_at,
      platform_fee: null,
      destination_amount: null,
      payment_method: method,
      source: { type: "checkout", checkout_id: s?.checkout_id ?? null, reference: s?.reference ?? null },
      description: null,
      fee_paid_by: "merchant",
    }
  }
  /** Available/pending per held currency: charges (net of the fee) − paid or processing refunds − open disputes − payouts. NGN settles at once; USD stays pending. */
  const balancesView = () => {
    const sum = { NGN: { available: 0, pending: 0 }, USD: { available: 0, pending: 0 } }
    for (const ch of state.charges.values()) {
      if (!["succeeded", "accepted", "overpaid", "refunded", "partially_refunded"].includes(ch.status)) continue
      const c = sum[ch.settlement_currency]
      if (!c) continue
      c[ch.settlement_currency === "NGN" ? "available" : "pending"] += cents(ch.settlement_amount) - cents(feeOf(ch))
    }
    for (const r of state.refunds.values()) {
      if (r.status === "failed") continue
      const ch = state.charges.get(r.charge_id)
      if (ch && sum[ch.settlement_currency]) sum[ch.settlement_currency].available -= cents(r.requested_amount)
    }
    // A hold or a debit comes out of the available balance, then out of what is still settling.
    const debit = (c, amount) => {
      const fromAvailable = Math.min(amount, Math.max(0, c.available))
      c.available -= fromAvailable
      c.pending -= amount - fromAvailable
    }
    for (const d of state.disputes.values()) if (["needs_response", "under_review", "lost"].includes(d.status) && sum[d.currency]) debit(sum[d.currency], cents(d.amount))
    for (const p of state.payouts.values()) if (p.status !== "failed" && sum[p.source_currency]) debit(sum[p.source_currency], cents(p.total_debited))
    const usd = sum.USD.available + sum.USD.pending + Math.round((sum.NGN.available + sum.NGN.pending) / 1520)
    return {
      account_id: "acct_mockYard",
      balances: Object.entries(sum).map(([currency, v]) => ({ currency, available_balance: dec(v.available), pending_balance: dec(v.pending) })),
      total_balance_usd: dec(usd),
      pending_settlements_by_day: sum.USD.pending ? [{ date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), currency: "USD", amount: dec(sum.USD.pending) }] : [],
    }
  }
  const endpointView = () => ({
    endpoint_id: ENDPOINT_ID,
    name: "Yard",
    url: webhookUrl,
    enabled: true,
    disabled_at: null,
    disabled_reason: null,
    event_types: ["checkout.completed", "checkout.expired", "collection.succeeded", "collection.failed", "refund.created", "refund.paid", "refund.failed", "dispute.created", "dispute.updated"],
    event_source: "account",
    created_at: "2026-11-01T09:00:00.000Z",
    updated_at: "2026-11-01T09:00:00.000Z",
  })

  /** A chargeback against a charge: needs a response within 14 days (what dispute.created reports). */
  function dispute(chargeId, { reason = "product_not_received", status = "needs_response" } = {}) {
    const ch = state.charges.get(chargeId)
    if (!ch) throw new Error(`mock: no charge ${chargeId}`)
    const now = new Date().toISOString()
    const d = { dispute_id: id("dsp"), charge_id: ch.id, amount: ch.settlement_amount, currency: ch.settlement_currency, status, is_response_editable: status === "needs_response", reason, response_deadline_at: new Date(Date.now() + 14 * 86_400_000).toISOString(), created_at: now, updated_at: now }
    state.disputes.set(d.dispute_id, d)
    return envelope("dispute.created", d)
  }
  /** A webhook delivery the caller made (for the endpoint metrics). */
  const recordDelivery = (ok) => state.deliveries.push({ at: new Date().toISOString(), ok })

  const envelope = (type, data) => ({ id: `evt_${randomBytes(12).toString("hex")}`, type, created_at: new Date().toISOString(), organization_id: "acct_mockYard", data })

  /** The customer pays the session (status "succeeded" by default): returns [checkout.completed, collection.succeeded]. */
  function pay(checkoutId, { status = "succeeded", method = "NGN_BANK_TRANSFER", amount } = {}) {
    const s = state.sessions.get(checkoutId)
    if (!s) throw new Error(`mock: no session ${checkoutId}`)
    const now = new Date().toISOString()
    const ch = {
      id: id("ch"),
      organization_id: "acct_mockYard",
      customer_id: null,
      amount: amount ?? s.amount,
      currency: s.currency,
      settlement_currency: s.currency === "NGN" || s.currency === "USD" ? s.currency : "USD",
      settlement_amount: amount ?? s.amount,
      status,
      substatus: null,
      payment_method: method.endsWith("_CARD") ? "CARD" : method,
      payment_method_details: { type: method.includes("BANK") ? "bank_transfer" : method.includes("CARD") ? "card" : "mobile_money" },
      metadata: s.metadata,
      created_at: now,
      updated_at: now,
    }
    state.charges.set(ch.id, ch)
    s.charge_id = ch.id
    s.status = "completed"
    s.completed_at = now
    const base = { charge_id: ch.id, checkout_id: s.checkout_id, reference: s.reference, amount: ch.amount, currency: ch.currency, settlement_amount: ch.settlement_amount, settlement_currency: ch.settlement_currency, metadata: s.metadata }
    return [
      envelope("checkout.completed", { ...sessionView(s), status: "completed", payment_status: "paid", charge: ch }),
      envelope("collection.succeeded", { ...base, status: status.toUpperCase(), processing_fee: "0.00", processing_fee_currency: ch.settlement_currency, fee_bearer: "merchant", product_cart: null, customer: { id: null }, payment_method_details: ch.payment_method_details }),
    ]
  }

  /** The session lapses unpaid: returns checkout.expired. */
  function expire(checkoutId) {
    const s = state.sessions.get(checkoutId)
    if (!s) throw new Error(`mock: no session ${checkoutId}`)
    s.status = "expired"
    return envelope("checkout.expired", { ...sessionView(s), status: "expired", payment_status: null, charge: null, completed_at: null })
  }

  /** Bachs finishes a refund ("paid" or "failed"): returns refund.paid / refund.failed. */
  function settleRefund(refundId, outcome = "paid") {
    const r = state.refunds.get(refundId)
    if (!r) throw new Error(`mock: no refund ${refundId}`)
    r.status = outcome === "paid" ? "success" : "failed"
    r.refunded_amount = outcome === "paid" ? r.requested_amount : "0.00"
    r.updated_at = r.completed_at = new Date().toISOString()
    const ch = state.charges.get(r.charge_id)
    if (ch && outcome === "paid") ch.status = r.requested_amount === ch.settlement_amount ? "refunded" : "partially_refunded"
    const data = { ...r }
    delete data.idempotency_key
    return envelope(outcome === "paid" ? "refund.paid" : "refund.failed", data)
  }

  /** Sample activity Bachs would show beside Yard's own: a paid card order now disputed, a failed refund and a withdrawal. */
  function seedSample() {
    const at = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString()
    const mk = (amount, currency, method, daysAgo, status = "succeeded") => {
      const s = { checkout_id: id("chk"), status: "completed", amount, currency, reference: `ext_${randomBytes(4).toString("hex")}`, metadata: {}, customer: null, payment_method_types: null, success_url: null, cancel_url: null, charge_id: null, completed_at: at(daysAgo), created_at: at(daysAgo), expires_at: at(daysAgo - 1) }
      s.checkout_url = `${url}/c/${randomBytes(6).toString("base64url")}`
      const ch = { id: id("ch"), organization_id: "acct_mockYard", customer_id: null, amount, currency, settlement_currency: currency, settlement_amount: amount, status, substatus: null, payment_method: method.endsWith("_CARD") ? "CARD" : method, payment_method_details: { type: method.includes("BANK") ? "bank_transfer" : "card" }, metadata: {}, created_at: at(daysAgo), updated_at: at(daysAgo) }
      state.charges.set(ch.id, ch)
      s.charge_id = ch.id
      state.sessions.set(s.checkout_id, s)
      return ch
    }
    const card = mk("120.00", "USD", "USD_CARD", 3)
    dispute(card.id, { reason: "fraudulent" })
    const ngn = mk("45000.00", "NGN", "NGN_BANK_TRANSFER", 6)
    mk("18500.00", "NGN", "NGN_CARD", 1, "failed")
    const r = { refund_id: id("rfnd"), charge_id: ngn.id, reference: `RF-${randomBytes(3).toString("hex")}`, status: "failed", requested_amount: "45000.00", refunded_amount: null, refund_fee_amount: "0.00", fee_bearer: "org", reason: "Bank transfer payments can't be refunded through Bachs", created_at: at(5), updated_at: at(5), completed_at: at(5) }
    state.refunds.set(r.refund_id, r)
    const p = { id: id("pay"), status: "completed", amount: "40000.00", currency: "NGN", source_currency: "NGN", fee: "50.00", total_debited: "40050.00", destination: "pd_mockBank", reference: "WD-20261120-001", narration: "Brand payouts", session_id: "090405261120000000000000000001", failure_reason: null, created_at: at(4), completed_at: at(4) }
    state.payouts.set(p.id, p)
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      url = `http://${host}:${server.address().port}`
      if (seed) seedSample()
      resolve({ url, state, server, pay, expire, settleRefund, dispute, recordDelivery, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const opt = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 3248)
  const mock = await startBachsMock({ port, seed: args.includes("--seed"), webhookUrl: opt("--webhook-url") ?? null, feeBps: Number(opt("--fee-bps") ?? 0) })
  console.log(`Bachs mock listening on ${mock.url}${args.includes("--seed") ? " (seeded)" : ""}`)
}
