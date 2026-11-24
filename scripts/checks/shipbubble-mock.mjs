#!/usr/bin/env node
// A LOCAL MOCK of the Shipbubble API (https://docs.shipbubble.com), only the endpoints Yard uses,
// with request and response shapes taken from the docs (docs/SHIPPING.md lists each source). It
// never books a courier, never moves money and never talks to Shipbubble.
//
//   node scripts/checks/shipbubble-mock.mjs [port] [--webhook-url URL] [--wallet NAIRA]   (default port 3249)
//   import { startShipbubbleMock } from "./shipbubble-mock.mjs"                            (in-process)
//
// Base path /v1, like https://api.shipbubble.com/v1. Every call needs Authorization: Bearer
// sb_sandbox_… or sb_prod_… (anything else is 401). Envelope: { status: "success", message, data }.
//   POST /v1/shipping/address/validate   { name, email, phone, address } → data.address_code (an address
//                                        containing "nowhere" is refused: 400 { status: "failed" })
//   GET  /v1/shipping/labels/categories  → data: [{ category_id, category }]
//   POST /v1/shipping/fetch_rates        { sender_address_code, reciever_address_code, pickup_date, category_id,
//                                          package_items: [{ name, description, unit_weight, unit_amount, quantity }],
//                                          package_dimension: { length, width, height } }
//                                        → data: { request_token, couriers: [...], cheapest_courier, fastest_courier, checkout_data }
//   POST /v1/shipping/labels             { request_token, service_code, courier_id } → data: the shipment
//                                        (order_id, courier.tracking_code, status "pending", payment.shipping_fee, tracking_url)
//                                        Paid from the wallet: 400 "Insufficient wallet balance" when it can't cover it.
//   GET  /v1/shipping/labels/list/{id}   → data: { results: [shipment] }
//   GET  /v1/shipping/wallet/balance     → data: { balance, currency: "NGN" }
// Webhooks (to `webhookUrl`): flat shipment bodies with `event`, signed x-ship-signature =
// hex HMAC-SHA512(body) under the API key the request came with (as Shipbubble signs).
// Test controls: in-process `setStatus(orderId, status)` → the webhook body and its signature (and
// delivers it when webhookUrl is set); `state`. Over HTTP (standalone runs, no auth):
//   POST /__mock/status   { order_id, status }   (pending | confirmed | picked_up | in_transit | completed | cancelled)
//   POST /__mock/config   { priceBumpNaira?, ratesDown?, walletNaira?, expireTokens? }
//   GET  /__mock/state
import http from "node:http"
import { createHmac, randomBytes } from "node:crypto"
import { pathToFileURL } from "node:url"

const STATUSES = new Set(["pending", "confirmed", "picked_up", "in_transit", "completed", "cancelled"])
const TOKEN_TTL_MS = 7 * 86_400_000
const hex = (n) => randomBytes(n).toString("hex")

/** The couriers the mock prices, as the rates answer lists them. */
const COURIERS = [
  { courier_id: "gigl", courier_name: "GIG Logistics", service_code: "gigl", base: 2500, perKg: 400, pickup_eta: "Within 24 hrs", delivery_eta: "Within 2 - 4 working days" },
  { courier_id: "kwik", courier_name: "Kwik Delivery", service_code: "kwik", base: 1800, perKg: 650, pickup_eta: "Within 3 hrs", delivery_eta: "Within 24 hrs" },
  { courier_id: "dhl", courier_name: "DHL Express", service_code: "dhl", base: 9000, perKg: 1500, pickup_eta: "Within 24 hrs", delivery_eta: "Within 1 - 2 working days" },
]

export function startShipbubbleMock({ port = 3249, host = "127.0.0.1", webhookUrl = null, walletNaira = 150_000, priceBumpNaira = 0 } = {}) {
  const state = { addresses: new Map(), tokens: new Map(), shipments: new Map(), wallet: walletNaira, priceBumpNaira, ratesDown: false, requests: [], deliveries: [], keys: new Set() }
  const url = `http://${host}:${port}`

  const send = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" })
    res.end(JSON.stringify(body))
  }
  const ok = (res, message, data, status = 200) => send(res, status, { status: "success", message, data })
  const fail = (res, status, message) => send(res, status, { status: "failed", message })
  const round2 = (n) => Math.round(n * 100) / 100

  function shipmentView(s) {
    return {
      order_id: s.order_id,
      courier: { name: s.courier_name, email: "support@example.invalid", phone: "+2340000000000", tracking_code: s.tracking_code, tracking_message: `Track your parcel with ${s.courier_name}: ${s.tracking_code}`, rider_info: null },
      status: s.status,
      ship_from: s.ship_from,
      ship_to: s.ship_to,
      payment: { shipping_fee: s.shipping_fee, type: "wallet", status: "completed", currency: "NGN" },
      items: s.items,
      tracking_url: `${url}/track/${s.order_id}`,
      date: s.date,
      package_status: s.history.map((h) => ({ status: h.status, datetime: h.at })),
      events: s.history.map((h) => ({ location: "Lagos", message: h.status, captured: h.at })),
      waybill_document: s.courier_id === "dhl" ? `${url}/waybill/${s.order_id}.pdf` : null,
    }
  }

  function webhookFor(s, event, apiKey) {
    const body = JSON.stringify({ event, ...shipmentView(s) })
    const signature = createHmac("sha512", apiKey).update(body).digest("hex")
    return { body, signature }
  }

  async function deliver(s, event) {
    const key = s.apiKey
    const hook = webhookFor(s, event, key)
    if (webhookUrl) {
      try {
        const r = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "x-ship-signature": hook.signature }, body: hook.body })
        state.deliveries.push({ event, order_id: s.order_id, status: r.status })
      } catch (e) {
        state.deliveries.push({ event, order_id: s.order_id, error: String(e) })
      }
    }
    return hook
  }

  async function setStatus(orderId, status) {
    const s = state.shipments.get(orderId)
    if (!s) throw new Error(`no shipment ${orderId}`)
    if (!STATUSES.has(status)) throw new Error(`unknown status ${status}`)
    s.status = status
    s.history.push({ status, at: new Date().toISOString() })
    return deliver(s, status === "cancelled" ? "shipment.cancelled" : "shipment.status.changed")
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, url)
    let raw = ""
    for await (const c of req) raw += c
    let body = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      return fail(res, 400, "Invalid JSON")
    }
    state.requests.push({ method: req.method, path: u.pathname, body })

    // Test controls (no auth).
    if (u.pathname === "/__mock/state") return send(res, 200, { wallet: state.wallet, shipments: [...state.shipments.values()].map(shipmentView), deliveries: state.deliveries, requests: state.requests.length })
    if (u.pathname === "/__mock/config" && req.method === "POST") {
      if (typeof body?.priceBumpNaira === "number") state.priceBumpNaira = body.priceBumpNaira
      if (typeof body?.ratesDown === "boolean") state.ratesDown = body.ratesDown
      if (typeof body?.walletNaira === "number") state.wallet = body.walletNaira
      // Every request token issued so far stops working (as if it had expired).
      if (body?.expireTokens === true) state.tokens.clear()
      return send(res, 200, { ok: true })
    }
    if (u.pathname === "/__mock/status" && req.method === "POST") {
      try {
        const hook = await setStatus(String(body?.order_id ?? ""), String(body?.status ?? ""))
        return send(res, 200, { ok: true, signature: hook.signature, deliveries: state.deliveries.slice(-1) })
      } catch (e) {
        return send(res, 400, { ok: false, error: String(e.message ?? e) })
      }
    }

    const auth = req.headers.authorization ?? ""
    const key = /^Bearer (sb_(sandbox|prod)_[A-Za-z0-9_-]{8,})$/.exec(auth)?.[1]
    if (!key) return send(res, 401, { status: "failed", message: "Unauthorized" })
    state.keys.add(key)
    const p = u.pathname.replace(/^\/v1/, "")

    if (req.method === "POST" && p === "/shipping/address/validate") {
      for (const f of ["name", "email", "phone", "address"]) if (!body?.[f]) return fail(res, 400, `${f} is required`)
      if (/nowhere/i.test(body.address)) return fail(res, 400, "We could not validate this address")
      const code = 10_000_000 + Math.floor(Math.random() * 89_999_999)
      const parts = String(body.address).split(",").map((x) => x.trim()).filter(Boolean)
      const data = { name: body.name, email: body.email, phone: body.phone, formatted_address: parts.join(", "), country: "Nigeria", country_code: "NG", city: parts.at(-2) ?? "Lagos", city_code: "LOS", state: "Lagos", state_code: "LA", postal_code: "100001", latitude: 6.5244, longitude: 3.3792, address_code: code }
      state.addresses.set(code, data)
      return ok(res, "Address successfully validated", data)
    }
    if (req.method === "GET" && p === "/shipping/labels/categories") {
      return ok(res, "Retrieved successfully", [
        { category_id: 74794423, category: "Hot food" },
        { category_id: 2178251, category: "Groceries" },
        { category_id: 67658572, category: "Medical supplies" },
        { category_id: 20754594, category: "Electronics and gadgets" },
        { category_id: 98190590, category: "Fashion wears" },
        { category_id: 99652979, category: "Light weight items" },
      ])
    }
    if (req.method === "POST" && p === "/shipping/fetch_rates") {
      if (state.ratesDown) return fail(res, 503, "Service temporarily unavailable")
      const from = state.addresses.get(Number(body?.sender_address_code))
      const to = state.addresses.get(Number(body?.reciever_address_code))
      if (!from || !to) return fail(res, 400, "Invalid sender or receiver address code")
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body?.pickup_date ?? "")) return fail(res, 400, "pickup_date is required (yyyy-mm-dd)")
      if (!body?.category_id) return fail(res, 400, "category_id is required")
      const items = Array.isArray(body?.package_items) ? body.package_items : []
      if (!items.length) return fail(res, 400, "package_items is required")
      const kg = items.reduce((s, i) => s + Number(i.unit_weight) * Number(i.quantity), 0)
      const value = items.reduce((s, i) => s + Number(i.unit_amount) * Number(i.quantity), 0)
      const request_token = `${hex(16)}`
      const couriers = COURIERS.map((c) => {
        const rate = round2(c.base + c.perKg * Math.max(1, kg) + state.priceBumpNaira)
        const vat = round2(rate * 0.075)
        return {
          courier_id: c.courier_id,
          courier_name: c.courier_name,
          courier_image: `${url}/img/${c.courier_id}.png`,
          service_code: c.service_code,
          insurance: { code: null, fee: 0 },
          discount: { percentage: 0, symbol: "%", discounted: 0 },
          service_type: "pickup",
          waybill: c.courier_id === "dhl",
          on_demand: c.courier_id === "kwik",
          is_cod_available: false,
          tracking_level: 7,
          ratings: 4.5,
          votes: 120,
          connected_account: false,
          rate_card_amount: rate,
          rate_card_currency: "NGN",
          pickup_eta: c.pickup_eta,
          pickup_eta_time: new Date(Date.now() + 86_400_000).toISOString(),
          dropoff_station: null,
          pickup_station: null,
          delivery_eta: c.delivery_eta,
          delivery_eta_time: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          info: null,
          currency: "NGN",
          vat,
          total: round2(rate + vat),
          tracking: { bars: 4, label: "Good tracking" },
        }
      })
      const sorted = [...couriers].sort((a, b) => a.total - b.total)
      const ship_from = { name: from.name, phone: from.phone, email: from.email, address: from.formatted_address }
      const ship_to = { name: to.name, phone: to.phone, email: to.email, address: to.formatted_address }
      state.tokens.set(request_token, { couriers, createdAt: Date.now(), ship_from, ship_to, items, apiKey: key })
      return ok(res, "Retrieved successfully", {
        request_token,
        couriers,
        fastest_courier: couriers.find((c) => c.courier_id === "kwik"),
        cheapest_courier: sorted[0],
        checkout_data: { ship_from, ship_to, currency: "NGN", package_amount: round2(value), package_weight: round2(kg), pickup_date: body.pickup_date, is_invoice_required: false },
      })
    }
    if (req.method === "POST" && p === "/shipping/labels") {
      for (const f of ["request_token", "service_code", "courier_id"]) if (!body?.[f]) return fail(res, 400, `${f} is required`)
      const t = state.tokens.get(body.request_token)
      if (!t || Date.now() - t.createdAt > TOKEN_TTL_MS) return fail(res, 400, "Invalid or expired request token")
      const c = t.couriers.find((x) => x.courier_id === body.courier_id && x.service_code === body.service_code)
      if (!c) return fail(res, 400, "Courier not available for this request token")
      if (state.wallet < c.total) return fail(res, 400, "Insufficient wallet balance")
      state.wallet = round2(state.wallet - c.total)
      const order_id = `SB-${hex(5).toUpperCase()}`
      const now = new Date().toISOString()
      const s = { order_id, courier_id: c.courier_id, courier_name: c.courier_name, tracking_code: `${c.courier_id.toUpperCase()}${Math.floor(1e9 + Math.random() * 9e9)}`, status: "pending", ship_from: t.ship_from, ship_to: t.ship_to, items: t.items, shipping_fee: c.total, date: now, history: [{ status: "pending", at: now }], apiKey: t.apiKey }
      state.shipments.set(order_id, s)
      void deliver(s, "shipment.label.created")
      return ok(res, "Shipment label created successfully", shipmentView(s), 201)
    }
    const m = /^\/shipping\/labels\/list\/([\w-]+)$/.exec(p)
    if (req.method === "GET" && m) {
      const s = state.shipments.get(m[1])
      return ok(res, "Retrieved successfully", { results: s ? [shipmentView(s)] : [] })
    }
    if (req.method === "GET" && p === "/shipping/wallet/balance") return ok(res, "Retrieved successfully", { balance: state.wallet, currency: "NGN" })
    return fail(res, 404, "Not found")
  })

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ url, apiBase: `${url}/v1`, state, setStatus, webhookFor, close: () => new Promise((r) => server.close(r)) }))
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2)
  const port = Number(args.find((a) => /^\d+$/.test(a)) ?? 3249)
  const at = (flag) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : null
  }
  const mock = await startShipbubbleMock({ port, webhookUrl: at("--webhook-url"), walletNaira: Number(at("--wallet") ?? 150_000) })
  console.log(`Shipbubble mock on ${mock.apiBase} (wallet ₦${mock.state.wallet.toLocaleString()})${at("--webhook-url") ? `, webhooks → ${at("--webhook-url")}` : ""}`)
}
