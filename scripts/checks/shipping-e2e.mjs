#!/usr/bin/env node
// COURIER SHIPPING end-to-end kit (docs/SHIPPING.md): pickup address verified → live courier
// options in checkout (and the fallback when the courier is down) → order paid with a courier
// rate → "Book pickup" (idempotent, permissioned) → label → signed courier webhooks move the order
// to delivered → the ledger keeps courier money out of the brand's balance → Admin › Delivery.
// Runs the Shipbubble mock and the Bachs mock in-process: NOTHING here talks to a real provider,
// no courier is booked and no money moves. Plain Node 22, no deps.
//
//   node scripts/checks/shipping-e2e.mjs
//
// Needs a Yard server (development, or a production build with demo sign-in) started with:
//   YARD_SHIPPING_PROVIDER=shipbubble
//   SHIPBUBBLE_API_KEY=sb_sandbox_mock_0123456789abcdef     (the mock signs webhooks with it, as Shipbubble does)
//   SHIPBUBBLE_API_BASE=http://127.0.0.1:3249/v1           (SHIP_MOCK_PORT)
//   YARD_PAYMENTS=bachs  BACHS_SECRET_KEY=sk_live_mock_0123456789abcdef  BACHS_WEBHOOK_SECRET=whsec_mock_0123456789abcdef
//   BACHS_API_BASE=http://127.0.0.1:3248  BACHS_CHARGE_CURRENCIES=NGN
//   YARD_TRUSTED_PROXY_HOPS=1   (and in production: YARD_ALLOW_HTTP=1 for the mocks, YARD_DEMO_AUTH=1, YARD_DEMO_ADMIN=1, YARD_SEED_DEMO=1)
// Env for the kit: YARD_BASE (server origin), SHIP_MOCK_PORT, BACHS_MOCK_PORT, SHIPBUBBLE_API_KEY, BACHS_WEBHOOK_SECRET.
// Uses the seeded demo shopper (Ada), Lagos Static (owner Tobi, viewer, fulfilment) and Null Form's
// owner: run it against a throwaway data directory. KEEP_SHIPPING_E2E=1 leaves the order in place (screenshots).
import { createHmac } from "node:crypto"
import { pathToFileURL } from "node:url"
import { deflateSync, crc32 } from "node:zlib"
import { startBachsMock } from "./bachs-mock.mjs"
import { startShipbubbleMock } from "./shipbubble-mock.mjs"

const base = (process.env.YARD_BASE ?? "http://localhost:3247").replace(/\/$/, "")
const SHIP_PORT = Number(process.env.SHIP_MOCK_PORT ?? 3249)
const BACHS_PORT = Number(process.env.BACHS_MOCK_PORT ?? 3248)
const SB_KEY = process.env.SHIPBUBBLE_API_KEY ?? "sb_sandbox_mock_0123456789abcdef"
const BACHS_SECRET = process.env.BACHS_WEBHOOK_SECRET ?? "whsec_mock_0123456789abcdef"
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TAG = `t_ship_${RUN}`
const BRAND = "b_lagos_static"

let failed = 0
let passed = 0
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail && typeof detail !== "string" ? JSON.stringify(detail).slice(0, 500) : detail
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${d && !ok ? ` — ${d}` : ""}`)
  return !!ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- HTTP ---------------- */

const mergeCookies = (prev, res) => {
  const jar = new Map((prev ?? "").split("; ").filter(Boolean).map((c) => [c.split("=")[0], c]))
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const kv = c.split(";")[0]
    const name = kv.split("=")[0]
    if (kv === `${name}=` || /max-age=0/i.test(c)) jar.delete(name)
    else jar.set(name, kv)
  }
  return [...jar.values()].join("; ")
}
const newIp = () => `10.${160 + Math.floor(Math.random() * 30)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
class Jar {
  constructor() {
    this.cookie = ""
    // One address per account: production allows 20 demo sign-ins per IP per 10 minutes.
    this.ip = newIp()
  }
}
const anonIp = newIp()
async function api(method, path, { jar, body, headers, raw, noOrigin } = {}) {
  const h = { "X-Forwarded-For": jar?.ip ?? anonIp, ...(noOrigin ? {} : { Origin: base, "X-Yard-Client": "1" }), ...(headers ?? {}) }
  if (jar?.cookie) h.cookie = jar.cookie
  let payload
  if (raw !== undefined) payload = raw
  else if (body !== undefined) {
    h["Content-Type"] = "application/json"
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${base}${path}`, { method, headers: h, body: payload, redirect: "manual" })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  if (jar) jar.cookie = mergeCookies(jar.cookie, res)
  return { status: res.status, body: json, text, type: res.headers.get("content-type") ?? "" }
}
const get = (p, o) => api("GET", p, o)
const post = (p, body, o = {}) => api("POST", p, { ...o, body })
const put = (p, body, o = {}) => api("PUT", p, { ...o, body })
const del = (p, o) => api("DELETE", p, o)
const brief = (r) => `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message}` : r.text.slice(0, 300)}`

async function demo(actor, account, brandId) {
  const jar = new Jar()
  const r = await post("/api/auth/demo", { actor, account, ...(brandId ? { brandId } : {}) }, { jar })
  if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
  return jar
}

const signBachs = (raw, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", BACHS_SECRET).update(`${t}.${raw}`).digest("hex")}`
const deliverBachs = (envelope) => {
  const raw = JSON.stringify(envelope)
  return api("POST", "/api/webhooks/bachs", { raw, noOrigin: true, headers: { "Content-Type": "application/json", "X-Bachs-Signature-V2": signBachs(raw) } })
}
const deliverShip = (raw, signature) => api("POST", "/api/webhooks/shipbubble", { raw, noOrigin: true, headers: { "Content-Type": "application/json", ...(signature === null ? {} : { "x-ship-signature": signature }) } })

function pngBytes() {
  const w = 64
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(w, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rows = []
  for (let y = 0; y < w; y++) {
    rows.push(Buffer.from([0]))
    for (let x = 0; x < w; x++) rows.push(Buffer.from([(x * 5) & 255, 90, (y * 3) & 255]))
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
}

/* ---------------- the kit ---------------- */

async function main(ship, bachs) {
  console.log(`# Courier shipping e2e against ${base}; Shipbubble mock ${ship.apiBase}, Bachs mock ${bachs.url}; run ${TAG}`)
  const OWNER = await demo("brand", "u_b_tobi", BRAND)
  const VIEWER = await demo("brand", "u_b_viewer", BRAND)
  const OTHER = await demo("brand", "u_b_minji", "b_null_form")
  const ADM = await demo("admin", "adm_1")
  const ADA = await demo("shopper", "u_ada")

  /* ===== Studio: pickup address, verified with the courier service ===== */
  const pickup = { contactName: "Tobi Adeyemi", phone: "+2348011111111", email: "ship@lagosstatic.example", address: "12 Bode Thomas Street, Surulere", city: "Lagos", state: "Lagos", country: "NG", parcelWeightGrams: 500, parcelLengthCm: 30, parcelWidthCm: 25, parcelHeightCm: 10 }
  const badAddr = await put("/api/studio/shipping/courier", { ...pickup, address: "Nowhere Street, Nowhere" }, { jar: OWNER })
  check("pickup: an address the courier service can't find is refused on the field (400), nothing saved", badAddr.status === 400 && !!badAddr.body?.error?.fields?.address, brief(badAddr))
  const viewerSave = await put("/api/studio/shipping/courier", pickup, { jar: VIEWER })
  check("pickup: a viewer can't change it (403)", viewerSave.status === 403, brief(viewerSave))
  const saved = await put("/api/studio/shipping/courier", pickup, { jar: OWNER })
  check("pickup: saved and verified with Shipbubble (address_code kept server side)", saved.status === 200 && saved.body?.settings?.verified === true && saved.body?.blocker === null && saved.body?.provider?.id === "shipbubble" && saved.body?.provider?.sandbox === true, brief(saved))
  check("pickup: the validate call carried name, email, phone and a one-line address", ship.state.requests.some((r) => r.path === "/v1/shipping/address/validate" && r.body?.address === "12 Bode Thomas Street, Surulere, Lagos, Lagos" && r.body?.phone === pickup.phone))

  /* ===== A product with its own packed weight ===== */
  const boundary = `----yardship${RUN}`
  const img = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}.png"\r\nContent-Type: image/png\r\n\r\n`), pngBytes(), Buffer.from(`\r\n--${boundary}--\r\n`)])
  const up = await api("POST", "/api/uploads?purpose=social_post&as=brand", { jar: OWNER, raw: img, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` } })
  const mediaId = up.body?.media?.id
  const c1 = await post("/api/studio/catalog/products", { images: mediaId ? [{ mediaId, alt: TAG }] : [], title: `${TAG} Overshirt`, description: "A courier kit overshirt.", categorySlug: "fashion", priceMinor: 4_500_000, weightGrams: 450, options: [{ name: "Size", values: [{ value: "M" }] }], variants: [{ sku: `${TAG}-M`, options: { Size: "M" }, initialStock: 20 }] }, { jar: OWNER })
  const P = c1.body?.product
  if (!check("setup: product created with weightGrams 450", c1.status === 201 && P?.weightGrams === 450, brief(c1))) throw new Error("setup failed")
  const pub = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: P.version }, { jar: OWNER })
  if (!check("setup: product published", pub.status === 200, brief(pub))) throw new Error("setup failed")
  const V = P.variants[0].id

  /* ===== Cart and checkout quotes ===== */
  await del("/api/cart", { jar: ADA })
  const add = await post("/api/cart/lines", { variantId: V, qty: 2 }, { jar: ADA })
  check("cart: shopper adds 2 pieces", add.status === 201, brief(add))
  const lines = [{ productId: P.id, variantId: V, qty: 2 }]
  const quoteBody = (extra = {}) => ({ to: "NG", city: "Lagos", currency: "NGN", groups: [{ brandId: BRAND, lines }], ...extra })
  const shopperAddress = { name: "Ada Kit", phone: "+2348022222222", line1: "4 Admiralty Way, Lekki Phase 1", city: "Lagos" }

  const cartQ = await post("/api/shipping/quote", quoteBody(), { jar: ADA })
  const g0 = cartQ.body?.groups?.[0]
  check("cart quote (no address): the brand's own rates, flagged 'courier price at checkout'", cartQ.status === 200 && g0?.courierAtCheckout === true && g0.options.every((o) => !o.courier) && g0.options.some((o) => o.available && o.service === "standard"), brief(cartQ))
  const anon = await post("/api/shipping/quote", quoteBody({ address: shopperAddress }))
  check("quote: an anonymous caller's address is ignored (no courier call on its behalf)", anon.status === 200 && anon.body?.groups?.[0]?.options.every((o) => !o.courier), brief(anon))

  const ratesBefore = ship.state.requests.filter((r) => r.path === "/v1/shipping/fetch_rates").length
  const liveQ = await post("/api/shipping/quote", quoteBody({ address: shopperAddress }), { jar: ADA })
  const g1 = liveQ.body?.groups?.[0]
  const couriers = (g1?.options ?? []).filter((o) => o.courier)
  check("checkout quote (address in): live courier options with name, price and ETA, cheapest first", liveQ.status === 200 && couriers.length === 3 && couriers.every((o) => o.key?.startsWith("c:") && o.price.currency === "NGN" && o.price.amount > 0 && o.courier.name && o.courier.eta && o.estimate?.arrivalFrom) && couriers[0].price.amount <= couriers[1].price.amount, brief(liveQ))
  check("checkout quote: the brand's own standard/express rates are replaced while couriers answer", !(g1?.options ?? []).some((o) => !o.courier && (o.service === "standard" || o.service === "express")), JSON.stringify(g1?.options?.map((o) => o.key)))
  const rateCall = ship.state.requests.filter((r) => r.path === "/v1/shipping/fetch_rates").at(-1)?.body
  check("rates request: Shipbubble's fields, the product's own weight (0.45 kg × 2), fashion category", rateCall?.package_items?.[0]?.unit_weight === "0.45" && rateCall.package_items[0].quantity === "2" && rateCall.package_items[0].unit_amount === "45000.00" && rateCall.category_id === 98190590 && "reciever_address_code" in rateCall && /^\d{4}-\d{2}-\d{2}$/.test(rateCall.pickup_date), JSON.stringify(rateCall))
  const ratesAfterLive = ship.state.requests.filter((r) => r.path === "/v1/shipping/fetch_rates").length
  const again = await post("/api/shipping/quote", quoteBody({ address: shopperAddress }), { jar: ADA })
  check("price hold: the same request within the hold reuses the stored rates (no second rates call)", ratesAfterLive > ratesBefore && ship.state.requests.filter((r) => r.path === "/v1/shipping/fetch_rates").length === ratesAfterLive && again.body?.groups?.[0]?.options?.[0]?.price?.amount === couriers[0].price.amount)

  // Fallback: the courier service is down → the brand's own rates, checkout keeps working.
  await fetch(`${ship.url}/__mock/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ratesDown: true }) })
  const downQ = await post("/api/shipping/quote", quoteBody({ address: { ...shopperAddress, line1: "9 Fallback Close, Yaba" } }), { jar: ADA })
  const gd = downQ.body?.groups?.[0]
  check("fallback: courier down → the brand's own rates, no error", downQ.status === 200 && gd?.options?.some((o) => o.available && !o.courier && o.service === "standard") && !gd?.unavailable, brief(downQ))
  await fetch(`${ship.url}/__mock/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ratesDown: false }) })
  const failures = await get("/api/admin/delivery/couriers", { jar: ADM })
  check("fallback: the failure shows in Admin › Delivery › Couriers", failures.status === 200 && failures.body?.failures?.some((f) => f.kind === "quote_failed"), brief(failures))

  /* ===== Checkout with a courier rate, paid ===== */
  const ratesAtCheckout = ship.state.requests.filter((r) => r.path === "/v1/shipping/fetch_rates").length
  const pick = couriers.find((o) => o.courier.name === "GIG Logistics") ?? couriers[0]
  const shipTo = { name: shopperAddress.name, line1: shopperAddress.line1, city: shopperAddress.city, country: "NG", phone: shopperAddress.phone }
  const subtotal = g1.subtotal.amount
  const r1 = await post("/api/checkout", { idempotencyKey: `${TAG}_main`, currency: "NGN", shipTo, shipping: [{ brandId: BRAND, service: pick.service, option: pick.key }], expectedTotalMinor: subtotal + pick.price.amount, paymentMethod: "card" }, { jar: ADA })
  const co = r1.body
  check("checkout: 201, shipping is exactly the courier price shown", r1.status === 201 && co?.shippingMinor === pick.price.amount && co?.totalMinor === subtotal + pick.price.amount, brief(r1))
  check("checkout: the held price was charged (no new rates call)", ship.state.requests.filter((r) => r.path === "/v1/shipping/fetch_rates").length === ratesAtCheckout)
  const stale = await post("/api/checkout", { idempotencyKey: `${TAG}_stale`, currency: "NGN", shipTo, shipping: [{ brandId: BRAND, service: "standard", option: "c:nope:nope" }], paymentMethod: "card" }, { jar: ADA })
  check("checkout: a courier option that's no longer offered → 409 'choose again'", stale.status === 409, brief(stale))
  const chk = [...bachs.state.sessions.values()].find((s) => s.reference === co?.payment?.reference)
  const [, collected] = bachs.pay(chk.checkout_id, { method: "NGN_CARD" })
  const paidHook = await deliverBachs(collected)
  check("payment: signed Bachs webhook → order paid", paidHook.status === 200 && (await get(`/api/checkout/${co.id}`, { jar: ADA })).body?.status === "paid", brief(paidHook))
  const orderId = co.orderIds[0]

  /* ===== Ledger: courier money is Yard's ===== */
  const fin = await get("/api/admin/finance/overview", { jar: ADM })
  const ngn = fin.body?.currencies?.find((c) => c.currency === "NGN")
  check("ledger: the courier price went to shipping collected (Yard), not to the brand", fin.status === 200 && ngn?.shippingCollectedMinor >= pick.price.amount, brief(fin))
  const ledg = await get(`/api/admin/finance/ledger?brandId=${BRAND}&currency=NGN&limit=200`, { jar: ADM })
  const capture = (ledg.body?.items ?? ledg.body?.entries ?? []).filter?.((e) => e.orderId === orderId) ?? []
  const brandCredit = capture.filter((e) => /^brand_/.test(e.account) && e.direction === "credit").reduce((s, e) => s + e.amountMinor, 0)
  check("ledger: the brand is credited items less commission only (no shipping)", ledg.status === 200 && brandCredit > 0 && brandCredit <= subtotal, `brand credit ${brandCredit} vs items ${subtotal}; ${brief(ledg).slice(0, 200)}`)

  /* ===== Book pickup: permissions ===== */
  const courierPath = `/api/studio/orders/${orderId}/courier`
  const st0 = await get(courierPath, { jar: OWNER })
  check("studio: the order shows the courier the shopper paid for, bookable", st0.status === 200 && st0.body?.courierOrder === true && st0.body?.choice?.name === pick.courier.name && st0.body?.refusal === null && st0.body?.shipment === null, brief(st0))
  const asShopper = await post(`${courierPath}/book`, {}, { jar: ADA })
  check("permissions: a shopper can't book (401/403)", asShopper.status === 401 || asShopper.status === 403, brief(asShopper))
  const asOther = await post(`${courierPath}/book`, {}, { jar: OTHER })
  check("permissions: another brand's owner gets 404", asOther.status === 404, brief(asOther))
  const asViewer = await post(`${courierPath}/book`, {}, { jar: VIEWER })
  check("permissions: a viewer of this brand can't book (403)", asViewer.status === 403, brief(asViewer))
  const anonBook = await post(`${courierPath}/book`, {})
  check("permissions: signed out → 401", anonBook.status === 401, brief(anonBook))
  check("permissions: nothing reached Shipbubble", ship.state.shipments.size === 0)

  /* ===== Book pickup: idempotent under a double click ===== */
  const walletBefore = ship.state.wallet
  const [b1, b2] = await Promise.all([post(`${courierPath}/book`, {}, { jar: OWNER }), post(`${courierPath}/book`, {}, { jar: OWNER })])
  const okOne = [b1, b2].filter((r) => r.status === 200)
  check("book: a double click books once (one 200, the other 200 with the same booking or 409)", okOne.length >= 1 && [b1, b2].every((r) => r.status === 200 || r.status === 409) && ship.state.shipments.size === 1, `${brief(b1)} | ${brief(b2)} | mock shipments ${ship.state.shipments.size}`)
  const b3 = await post(`${courierPath}/book`, {}, { jar: OWNER })
  check("book: booking again returns the same shipment, no second booking", b3.status === 200 && b3.body?.shipment?.id === okOne[0].body?.shipment?.id && ship.state.shipments.size === 1, brief(b3))
  const sb = [...ship.state.shipments.values()][0]
  const booked = okOne[0].body?.shipment
  check("book: tracking code, courier and print link saved", booked?.status === "booked" && booked.trackingCode === sb.tracking_code && booked.courierName === pick.courier.name && booked.printUrl.endsWith("/courier/label"), JSON.stringify(booked))
  check("book: paid from the courier wallet (mock wallet down by the courier price)", Math.round((walletBefore - ship.state.wallet) * 100) === pick.price.amount, `${walletBefore} → ${ship.state.wallet}`)
  check("book: the cost equals what the shopper paid (token still valid, no re-quote)", booked?.costMinor === pick.price.amount && booked.priceDiffMinor === 0 && booked.requoted === false, JSON.stringify(booked))
  const label = await get(`${courierPath}/label`, { jar: OWNER })
  check("label: printable HTML with the tracking code and both addresses", label.status === 200 && label.type.includes("text/html") && label.text.includes(sb.tracking_code) && label.text.includes("Ada Kit") && label.text.includes("Bode Thomas") && label.text.includes("<svg"), `${label.status} ${label.type}`)
  const otherLabel = await get(`${courierPath}/label`, { jar: OTHER })
  check("label: another brand can't open it (404)", otherLabel.status === 404, brief(otherLabel))

  const so1 = await get(`/api/studio/orders/${orderId}`, { jar: OWNER })
  check("order: shipped after booking (merchant status and fulfilment)", so1.body?.order?.status === "shipped" || so1.body?.order?.states?.merchant === "shipped", JSON.stringify({ s: so1.body?.order?.status, st: so1.body?.order?.states }))
  const del1 = await get(`/api/orders/${orderId}/delivery`, { jar: ADA })
  check("shopper: the delivery shows a carrier 'shipped' event with the tracking number", del1.status === 200 && (del1.body?.events ?? []).some((e) => e.status === "shipped" && e.source === "carrier" && e.trackingNumber === sb.tracking_code), brief(del1).slice(0, 300))
  const notes = await get("/api/notifications?as=shopper", { jar: ADA })
  check("shopper: told it shipped (notification)", (notes.body?.items ?? notes.body?.notifications ?? []).some((n) => n.key === `shipped:${orderId}`), brief(notes).slice(0, 200))

  /* ===== Courier webhooks ===== */
  const hookUrl = `${base}/api/webhooks/shipbubble`
  const pickedUp = await fetch(`${ship.url}/__mock/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: sb.order_id, status: "picked_up" }) }).then((r) => r.json())
  check("webhook: signed picked_up delivered → 200", pickedUp.ok && pickedUp.deliveries?.[0]?.status === 200, JSON.stringify(pickedUp))
  const forged = JSON.stringify({ event: "shipment.status.changed", order_id: sb.order_id, status: "completed", courier: { tracking_code: sb.tracking_code } })
  const bad = await deliverShip(forged, createHmac("sha512", "sb_sandbox_wrong_key_000000").update(forged).digest("hex"))
  check("webhook: a forged signature is refused (400) and nothing changes", bad.status === 400, brief(bad))
  const none = await deliverShip(forged, null)
  check("webhook: no signature → 400", none.status === 400, brief(none))
  const mid = await get(`/api/orders/${orderId}/delivery`, { jar: ADA })
  check("webhook: picked_up → an in_transit event; still not delivered", (mid.body?.events ?? []).some((e) => e.status === "in_transit" && e.source === "carrier") && !(mid.body?.events ?? []).some((e) => e.status === "delivered"), brief(mid).slice(0, 300))
  const done = await fetch(`${ship.url}/__mock/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: sb.order_id, status: "completed" }) }).then((r) => r.json())
  check("webhook: signed completed delivered → 200", done.ok && done.deliveries?.[0]?.status === 200, JSON.stringify(done))
  const replayBody = JSON.stringify({ event: "shipment.status.changed", ...(await fetch(`${ship.url}/__mock/state`).then((r) => r.json())).shipments[0] })
  const replay = await deliverShip(replayBody, createHmac("sha512", SB_KEY).update(replayBody).digest("hex"))
  check("webhook: a redelivery of an applied status changes nothing (200)", replay.status === 200, brief(replay))
  const fin2 = await get(`/api/orders/${orderId}/delivery`, { jar: ADA })
  check("delivered: one delivered event, from the carrier", (fin2.body?.events ?? []).filter((e) => e.status === "delivered" && e.source === "carrier").length === 1, brief(fin2).slice(0, 300))
  const so2 = await get(`/api/studio/orders/${orderId}`, { jar: OWNER })
  check("delivered: the order reads delivered, its return window started", so2.body?.order?.states?.fulfilment === "delivered" || so2.body?.order?.status === "delivered", JSON.stringify(so2.body?.order?.states))
  const st2 = await get(courierPath, { jar: OWNER })
  check("delivered: the courier shipment reads delivered", st2.body?.shipment?.status === "delivered", brief(st2))
  const notes2 = await get("/api/notifications?as=shopper", { jar: ADA })
  check("delivered: the shopper is told", (notes2.body?.items ?? notes2.body?.notifications ?? []).some((n) => n.key === `delivered:${orderId}`), brief(notes2).slice(0, 200))
  const bnotes = await get("/api/notifications?as=brand", { jar: OWNER })
  check("delivered: the brand is told (picked up, delivered)", JSON.stringify(bnotes.body ?? {}).includes(`courier:${booked.id}:delivered`), brief(bnotes).slice(0, 200))

  /* ===== Admin › Delivery › Couriers ===== */
  const ad = await get("/api/admin/delivery/couriers", { jar: ADM })
  const row = ad.body?.shipments?.find((s) => s.orderId === orderId)
  const tot = ad.body?.totals?.find((t) => t.currency === "NGN")
  check("admin: the booked shipment with cost vs collected", ad.status === 200 && row?.status === "delivered" && row.costMinor === pick.price.amount && row.collectedMinor === pick.price.amount, brief(ad).slice(0, 300))
  check("admin: shipping collected vs spent from the ledger", tot && tot.collectedMinor >= pick.price.amount && tot.spentMinor >= pick.price.amount, JSON.stringify(ad.body?.totals))
  // Read at most once a minute per process: the figure is the balance before or after this booking.
  check("admin: the wallet balance is read from the provider (read-only, cached a minute)", ad.body?.wallet && !("error" in ad.body.wallet) && [Math.round(ship.state.wallet * 100), Math.round(walletBefore * 100)].includes(ad.body.wallet.amountMinor) && ship.state.requests.filter((r) => r.path === "/v1/shipping/wallet/balance").length <= 2, JSON.stringify(ad.body?.wallet))
  const notAdmin = await get("/api/admin/delivery/couriers", { jar: OWNER })
  check("admin: brands can't read it", notAdmin.status === 401 || notAdmin.status === 403, brief(notAdmin))

  /* ===== An expired rate: re-quoted at booking, Yard absorbs the rise, Admin told above the cap ===== */
  await post("/api/cart/lines", { variantId: V, qty: 1 }, { jar: ADA })
  const q2 = await post("/api/shipping/quote", { to: "NG", city: "Lagos", currency: "NGN", groups: [{ brandId: BRAND, lines: [{ productId: P.id, variantId: V, qty: 1 }] }], address: shopperAddress }, { jar: ADA })
  const opt2 = q2.body?.groups?.[0]?.options?.find((o) => o.courier?.name === pick.courier.name)
  const r2 = await post("/api/checkout", { idempotencyKey: `${TAG}_second`, currency: "NGN", shipTo, shipping: [{ brandId: BRAND, service: "standard", option: opt2?.key }], expectedTotalMinor: q2.body?.groups?.[0]?.subtotal?.amount + opt2?.price?.amount, paymentMethod: "card" }, { jar: ADA })
  const co2 = r2.body
  const chk2 = [...bachs.state.sessions.values()].find((x) => x.reference === co2?.payment?.reference)
  const [, collected2] = bachs.pay(chk2.checkout_id, { method: "NGN_CARD" })
  await deliverBachs(collected2)
  const order2 = co2.orderIds[0]
  check("re-quote setup: a second courier order, paid", r2.status === 201 && (await get(`/api/checkout/${co2.id}`, { jar: ADA })).body?.status === "paid", brief(r2))
  await fetch(`${ship.url}/__mock/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expireTokens: true, priceBumpNaira: 1500 }) })
  const rb = await post(`/api/studio/orders/${order2}/courier/book`, {}, { jar: OWNER })
  const s2 = rb.body?.shipment
  check("re-quote: the provider refused the stored token → re-quoted and booked", rb.status === 200 && s2?.status === "booked" && s2.requoted === true, brief(rb))
  check("re-quote: the price rise is recorded and absorbed by Yard (the shopper paid the held price)", s2?.collectedMinor === opt2.price.amount && s2.costMinor > s2.collectedMinor && s2.priceDiffMinor === s2.costMinor - s2.collectedMinor, JSON.stringify(s2))
  const ad2 = await get("/api/admin/delivery/couriers", { jar: ADM })
  check("re-quote: above the cap (₦1,000) Admin is alerted", ad2.body?.failures?.some((f) => f.kind === "price_over_cap" && f.orderId === order2) && ad2.body?.shipments?.find((x) => x.orderId === order2)?.overCap === true, brief(ad2).slice(0, 300))
  const adminNotes = await get("/api/notifications?as=admin", { jar: ADM })
  check("re-quote: the admin notification names the order", JSON.stringify(adminNotes.body ?? {}).includes(`courier-over-cap:${s2?.id}`), brief(adminNotes).slice(0, 200))
  await fetch(`${ship.url}/__mock/config`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ priceBumpNaira: 0 }) })

  if (process.env.KEEP_SHIPPING_E2E === "1") {
    console.log(`# kept: order ${orderId}, product ${P.id}`)
    return { orderId, productId: P.id }
  }
  const p = (await get(`/api/studio/catalog/products/${P.id}`, { jar: OWNER })).body?.product
  if (p && p.status !== "archived") await del(`/api/studio/catalog/products/${P.id}?expectedVersion=${p.version}`, { jar: OWNER })
  await del("/api/cart", { jar: ADA })
  void hookUrl
  return { orderId, productId: P.id }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ship = await startShipbubbleMock({ port: SHIP_PORT, webhookUrl: `${base}/api/webhooks/shipbubble`, walletNaira: 150_000 })
  const bachs = await startBachsMock({ port: BACHS_PORT })
  try {
    await main(ship, bachs)
  } catch (e) {
    check("kit ran to the end", false, String(e?.stack ?? e).slice(0, 600))
  }
  if (process.env.KEEP_MOCKS === "1") {
    console.log(`# ${passed} passed, ${failed} failed (run ${TAG}); mocks stay up (KEEP_MOCKS=1)`)
  } else {
    await ship.close()
    await bachs.close()
    await sleep(10)
    console.log(`# ${passed} passed, ${failed} failed (run ${TAG})`)
    process.exit(failed ? 1 : 0)
  }
}
