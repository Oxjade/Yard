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
// Test controls (in-process only): pay(), expire(), settleRefund() mutate state and return the webhook
// envelopes Bachs would send; the caller signs and delivers them.
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

export function startBachsMock({ port = 3248, host = "127.0.0.1" } = {}) {
  const state = { sessions: new Map(), charges: new Map(), refunds: new Map(), references: new Set(), idempotency: new Map(), requests: [] }
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

    return err(res, 404, "NOT_FOUND", `No route ${req.method} ${path} in the mock`)
  })

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

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      url = `http://${host}:${server.address().port}`
      resolve({ url, state, server, pay, expire, settleRefund, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = await startBachsMock({ port: Number(process.argv[2] ?? 3248) })
  console.log(`Bachs mock listening on ${mock.url}`)
}
