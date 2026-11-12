#!/usr/bin/env node
// BACHS end-to-end kit: Yard checkout → Bachs hosted checkout → signed webhook → order paid; refund
// once (ok), a second refund on the same charge (refused, 422); duplicate webhooks ignored; bad
// signatures refused. Runs the local Bachs mock (bachs-mock.mjs) in-process: NOTHING here talks to
// the real Bachs API and no money moves. Plain Node 22, no deps.
//
//   node scripts/checks/bachs-e2e.mjs
//
// Needs a DEVELOPMENT Yard server started with (the mock must listen where the server expects it):
//   YARD_PAYMENTS=bachs
//   BACHS_SECRET_KEY=sk_live_mock_0123456789abcdef      (any sk_live_… value: the mock accepts it)
//   BACHS_WEBHOOK_SECRET=whsec_mock_0123456789abcdef    (the kit signs webhooks with the same value)
//   BACHS_API_BASE=http://127.0.0.1:3248                (the mock's address; BACHS_MOCK_PORT)
//   BACHS_CHARGE_CURRENCIES=NGN,USD
//   YARD_TRUSTED_PROXY_HOPS=1
// Env for the kit: YARD_BASE (server origin), BACHS_MOCK_PORT (3248), BACHS_WEBHOOK_SECRET (same as the server).
// Uses the seeded demo shopper (Ada), brand Lagos Static and admin demo accounts: run it against a
// throwaway data directory, not the shared dev server.
import { createHmac } from "node:crypto"
import { pathToFileURL } from "node:url"
import { deflateSync, crc32 } from "node:zlib"
import { startBachsMock } from "./bachs-mock.mjs"

const base = (process.env.YARD_BASE ?? "http://localhost:3247").replace(/\/$/, "")
const MOCK_PORT = Number(process.env.BACHS_MOCK_PORT ?? 3248)
const SECRET = process.env.BACHS_WEBHOOK_SECRET ?? "whsec_mock_0123456789abcdef"
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TAG = `t_bachs_${RUN}`
const BRAND = "b_lagos_static"
const IP = `10.${140 + Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`

let failed = 0
let passed = 0
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail && typeof detail !== "string" ? JSON.stringify(detail).slice(0, 400) : detail
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
class Jar {
  constructor(cookie = "") {
    this.cookie = cookie
  }
}
async function api(method, path, { jar, body, headers, raw, noOrigin } = {}) {
  const h = { "X-Forwarded-For": IP, ...(noOrigin ? {} : { Origin: base, "X-Yard-Client": "1" }), ...(headers ?? {}) }
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
  return { status: res.status, body: json, text }
}
const get = (p, o) => api("GET", p, o)
const post = (p, body, o = {}) => api("POST", p, { ...o, body })
const del = (p, o) => api("DELETE", p, o)
const brief = (r) => `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message}` : r.text.slice(0, 300)}`

async function demo(actor, account, brandId) {
  const jar = new Jar()
  const r = await post("/api/auth/demo", { actor, account, ...(brandId ? { brandId } : {}) }, { jar })
  if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
  return jar
}

/** Signs a Bachs webhook exactly as Bachs does: X-Bachs-Signature-V2 = t={unix},v1=hex(HMAC-SHA256(secret, `${t}.${raw}`)). */
const sign = (raw, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`
async function deliver(envelope, opts = {}) {
  const raw = opts.raw ?? JSON.stringify(envelope)
  const header = "header" in opts ? opts.header : sign(opts.signBody ?? raw, opts)
  return api("POST", "/api/webhooks/bachs", { raw, noOrigin: true, headers: { "Content-Type": "application/json", ...(header === null ? {} : { "X-Bachs-Signature-V2": header }) } })
}

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
    for (let x = 0; x < w; x++) rows.push(Buffer.from([(x * 3) & 255, (y * 5) & 255, 120]))
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
}

/* ---------------- the kit ---------------- */

async function main(mock) {
  console.log(`# Bachs e2e against ${base}, mock ${mock.url}, run ${TAG}`)

  const opts = await get("/api/checkout/options")
  check("options: provider is bachs, mode live (sk_live_ key), currencies from BACHS_CHARGE_CURRENCIES", opts.status === 200 && opts.body?.provider === "bachs" && opts.body?.mode === "live" && opts.body?.currencies?.includes("NGN"), brief(opts))

  // Setup: a product in Lagos Static.
  await post("/api/orders/dev", { op: "reset-kit-daily-caps" })
  const OWNER = await demo("brand", "u_b_tobi", BRAND)
  const ADM = await demo("admin", "adm_1")
  const boundary = `----yardbachs${RUN}`
  const img = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}.png"\r\nContent-Type: image/png\r\n\r\n`), pngBytes(), Buffer.from(`\r\n--${boundary}--\r\n`)])
  const up = await api("POST", "/api/uploads?purpose=social_post&as=brand", { jar: OWNER, raw: img, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` } })
  const mediaId = up.body?.media?.id
  const c1 = await post(
    "/api/studio/catalog/products",
    {
      images: mediaId ? [{ mediaId, alt: TAG }] : [],
      title: `${TAG} Shirt`,
      description: "A Bachs kit shirt.",
      categorySlug: "fashion",
      priceMinor: 1_234_567,
      options: [{ name: "Size", values: [{ value: "S" }, { value: "M" }] }],
      variants: [
        { sku: `${TAG}-S`, options: { Size: "S" }, initialStock: 20 },
        { sku: `${TAG}-M`, options: { Size: "M" }, initialStock: 20 },
      ],
    },
    { jar: OWNER },
  )
  const P = c1.body?.product
  if (!check("setup: product created", c1.status === 201 && !!P, brief(c1))) throw new Error("setup failed")
  const pub = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: P.version }, { jar: OWNER })
  if (!check("setup: product published", pub.status === 200, brief(pub))) throw new Error("setup failed")
  const V = Object.fromEntries(P.variants.map((v) => [v.options.Size, v.id]))
  const variant = async (size) => (await get(`/api/studio/catalog/products/${P.id}`, { jar: OWNER })).body?.product?.variants?.find((x) => x.id === V[size])

  const ADA = await demo("shopper", "u_ada")
  await del("/api/cart", { jar: ADA })
  const add = await post("/api/cart/lines", { variantId: V.S, qty: 2 }, { jar: ADA })
  check("cart: shopper adds 2 pieces", add.status === 201, brief(add))
  const shipTo = { name: "Bachs Kit", line1: "1 Kit Street", city: "Lagos", country: "NG", phone: "+234 800 000 0000" }
  const cart = await get("/api/cart?currency=NGN&to=NG&city=Lagos", { jar: ADA })
  const service = cart.body?.groups?.find((g) => g.brandId === BRAND)?.shipping?.options?.find((o) => o.available)?.service ?? "standard"
  const coBody = (k, extra = {}) => ({ idempotencyKey: `${TAG}_${k}`, currency: "NGN", shipTo, shipping: [{ brandId: BRAND, service }], ...extra })
  const s0 = await variant("S")

  /* ===== Checkout → Bachs hosted checkout ===== */
  const before = mock.state.requests.length
  const r1 = await post("/api/checkout", coBody("main", { paymentMethod: "bank_transfer" }), { jar: ADA })
  const co = r1.body
  check("checkout: 201 with a Bachs payment", r1.status === 201 && co?.payment?.provider === "bachs" && co.payment.stub === false, brief(r1))
  check("checkout: authorizationUrl is the Bachs hosted checkout URL", typeof co?.payment?.authorizationUrl === "string" && co.payment.authorizationUrl.startsWith(`${mock.url}/c/`), co?.payment?.authorizationUrl)
  const creates = mock.state.requests.slice(before).filter((r) => r.method === "POST" && r.path === "/v1/checkout-sessions")
  check("checkout: exactly one create-session call reached Bachs", creates.length === 1, creates.length)
  const sent = creates[0] ? JSON.parse(creates[0].body) : {}
  const expect = `${Math.floor(co.totalMinor / 100)}.${String(co.totalMinor % 100).padStart(2, "0")}`
  check("checkout: amount sent as a decimal string at currency precision (exact)", sent.pricing?.amount === expect && sent.pricing?.currency === "NGN", `${JSON.stringify(sent.pricing)} vs ${co.totalMinor} minor`)
  check("checkout: our payment reference is the Bachs reference; metadata names the Yard checkout", sent.reference === co.payment.reference && sent.metadata?.checkoutId === co.id && sent.metadata?.paymentId === co.payment.id, JSON.stringify({ ref: sent.reference, meta: sent.metadata }))
  check("checkout: idempotency key sent (Idempotency-Key header)", creates[0]?.headers["idempotency-key"] === `yard-checkout-${co.payment.id}`, creates[0]?.headers["idempotency-key"])
  check("checkout: the chosen method restricts the corridor (bank transfer → NGN_BANK_TRANSFER)", JSON.stringify(sent.payment_method_types) === '["NGN_BANK_TRANSFER"]', JSON.stringify(sent.payment_method_types))
  check("checkout: no localhost return URLs are sent (Bachs refuses them)", sent.success_url === undefined && sent.cancel_url === undefined, JSON.stringify({ s: sent.success_url }))
  check("checkout: the secret key went in the Authorization header", /^Bearer sk_live_/.test(creates[0]?.headers.authorization ?? ""))
  check("checkout: hold expiry matches the Bachs session lifetime", Number.isInteger(sent.expires_in_minutes) && sent.expires_in_minutes >= 29 && sent.expires_in_minutes <= 30, sent.expires_in_minutes)
  const hosted = await fetch(co.payment.authorizationUrl)
  check("checkout: the hosted URL opens", hosted.status === 200 && /Bachs mock checkout/.test(await hosted.text()))
  const r1b = await post("/api/checkout", coBody("main", { paymentMethod: "bank_transfer" }), { jar: ADA })
  check("checkout: a retry with the same key returns the same checkout, no new session", r1b.status === 200 && r1b.body?.id === co.id && mock.state.requests.slice(before).filter((r) => r.path === "/v1/checkout-sessions" && r.method === "POST").length === 1, brief(r1b))
  const chk = [...mock.state.sessions.values()].find((s) => s.reference === co.payment.reference)

  const v0 = await post(`/api/checkout/${co.id}/verify`, undefined, { jar: ADA })
  check("verify: unpaid session → still pending (provider status open)", v0.status === 200 && v0.body?.status === "pending_payment" && v0.body?.payment?.providerStatus === "open", brief(v0))

  /* ===== Webhook signatures ===== */
  const [completed, collected] = mock.pay(chk.checkout_id, { method: "NGN_BANK_TRANSFER" })
  const rawC = JSON.stringify(collected)
  const tampered = await deliver(null, { raw: rawC.replace(/"amount":"[\d.]+"/, '"amount":"1.00"'), signBody: rawC })
  check("webhook: a tampered body is refused (400)", tampered.status === 400, brief(tampered))
  const expired = await deliver(collected, { t: Math.floor(Date.now() / 1000) - 600 })
  check("webhook: an expired timestamp is refused (400)", expired.status === 400, brief(expired))
  const wrong = await deliver(collected, { secret: "whsec_not_the_right_secret_000" })
  check("webhook: a signature under another secret is refused (400)", wrong.status === 400, brief(wrong))
  const none = await deliver(collected, { header: null })
  check("webhook: no signature header is refused (400)", none.status === 400, brief(none))
  const stillPending = await get(`/api/checkout/${co.id}`, { jar: ADA })
  check("webhook: nothing was applied by the refused deliveries", stillPending.body?.status === "pending_payment", stillPending.body?.status)
  const evs0 = await get(`/api/webhooks/paystack/events?ref=${co.payment.reference}`, { jar: ADM })
  check("webhook: nothing was stored for the refused deliveries", evs0.status === 200 && !(evs0.body?.events ?? []).some((e) => e.provider === "bachs" && e.source === "webhook"), brief(evs0))

  /* ===== Signed webhook → order paid ===== */
  const ok = await deliver(collected)
  check("webhook: signed collection.succeeded → 200", ok.status === 200 && ok.body?.ok === true, brief(ok))
  const paid = await get(`/api/checkout/${co.id}`, { jar: ADA })
  check("paid: checkout paid, payment succeeded, channel bank_transfer", paid.body?.status === "paid" && paid.body?.payment?.status === "succeeded" && paid.body?.payment?.channel === "bank_transfer" && !!paid.body?.paidAt, JSON.stringify({ s: paid.body?.status, p: paid.body?.payment }))
  const orderId = co.orderIds[0]
  const od = await get(`/api/orders/${orderId}`, { jar: ADA })
  const ord = od.body?.order ?? od.body
  check("paid: ORDERS marked the order paid", ord?.states?.payment === "paid", brief(od).slice(0, 200))
  const s1 = await variant("S")
  check("paid: stock committed (on hand −2, hold released)", s1?.onHand === s0.onHand - 2 && s1?.held === s0.held, `${s0?.onHand}/${s0?.held} → ${s1?.onHand}/${s1?.held}`)
  const led = await get(`/api/admin/finance/ledger?brandId=${BRAND}&currency=NGN&limit=100`, { jar: ADM })
  check("paid: LEDGER posted the capture", led.status === 200 && JSON.stringify(led.body ?? {}).includes(orderId), brief(led).slice(0, 200))

  /* ===== Duplicates ===== */
  const dup = await deliver(collected)
  check("duplicate: the same event again → 200 duplicate, nothing changes", dup.status === 200 && dup.body?.duplicate === true && (await variant("S"))?.onHand === s1.onHand, brief(dup))
  const comp = await deliver(completed)
  check("duplicate: checkout.completed for the same payment → 200, still paid once", comp.status === 200 && (await get(`/api/checkout/${co.id}`, { jar: ADA })).body?.status === "paid" && (await variant("S"))?.onHand === s1.onHand, brief(comp))
  const evs = (await get(`/api/webhooks/paystack/events?ref=${co.payment.reference}`, { jar: ADM })).body?.events ?? []
  const hooks = evs.filter((e) => e.provider === "bachs" && e.source === "webhook")
  check("events: Bachs events are in the payment event log, one row per event id", hooks.length === 2 && hooks.some((e) => e.eventType === "collection.succeeded" && e.status === "processed") && hooks.some((e) => e.eventType === "checkout.completed"), JSON.stringify(hooks.map((e) => [e.eventType, e.status])))
  const detail = hooks[0] ? await get(`/api/webhooks/paystack/events/${hooks[0].id}`, { jar: ADM }) : null
  check("events: event detail opens for admins", detail?.status === 200 && !!detail.body?.event?.payload, detail ? brief(detail).slice(0, 200) : "no event")
  const replay = hooks[0] ? await post(`/api/webhooks/paystack/events/${hooks[0].id}/replay`, undefined, { jar: ADM }) : null
  check("events: admin replay re-checks with Bachs and changes nothing", replay?.status === 200 && ["processed", "ignored"].includes(replay.body?.result?.status) && (await variant("S"))?.onHand === s1.onHand, replay ? brief(replay) : "")

  /* ===== Refunds: one per charge ===== */
  const ra = await post("/api/auth/reauth?as=brand", { demo: true }, { jar: OWNER })
  if (ra.status !== 200) throw new Error(`brand re-auth: ${brief(ra)}`)
  const refund = (b) => post(`/api/studio/orders/${orderId}/refunds`, b, { jar: OWNER })
  const rb = mock.state.requests.length
  const rf1 = await refund({ amountMinor: 50_000, reason: TAG, idempotencyKey: `${TAG}_rf1` })
  check("refund: first (partial) refund accepted", [200, 201].includes(rf1.status), brief(rf1))
  const refundCall = mock.state.requests.slice(rb).find((r) => r.method === "POST" && r.path === "/v1/refunds")
  const rsent = refundCall ? JSON.parse(refundCall.body) : {}
  const charge = mock.state.charges.get(mock.state.sessions.get(chk.checkout_id)?.charge_id)
  check("refund: sent to Bachs with charge_id, a decimal amount and a unique reference", rsent.charge_id === charge?.id && rsent.amount === "500.00" && typeof rsent.reference === "string" && rsent.reference.length > 0 && !!rsent.idempotency_key, JSON.stringify(rsent))
  const bachsRefund = [...mock.state.refunds.values()].find((r) => r.reference === rsent.reference)
  const rf2 = await refund({ amountMinor: 10_000, reason: TAG, idempotencyKey: `${TAG}_rf2` })
  check("refund: a second refund on the same charge is refused with 422 (do it by hand)", rf2.status === 422 && /one refund/i.test(rf2.body?.error?.message ?? "") && /by hand/i.test(rf2.body?.error?.message ?? ""), brief(rf2))
  check("refund: …and nothing was sent to Bachs for it", mock.state.requests.slice(rb).filter((r) => r.method === "POST" && r.path === "/v1/refunds").length === 1)
  const paidHook = await deliver(mock.settleRefund(bachsRefund.refund_id, "paid"))
  check("refund: signed refund.paid → 200", paidHook.status === 200, brief(paidHook))
  const od2 = await get(`/api/orders/${orderId}`, { jar: ADA })
  const ord2 = od2.body?.order ?? od2.body
  check("refund: the order reads partially refunded by exactly the refund", ord2?.states?.payment === "partially_refunded" && ord2.refundedMinor === 50_000, brief(od2).slice(0, 300))
  const rf3 = await refund({ amountMinor: 10_000, reason: TAG, idempotencyKey: `${TAG}_rf3` })
  check("refund: after the first refund settled, another is still refused (422)", rf3.status === 422, brief(rf3))

  /* ===== A webhook before Bachs confirms; an expired checkout ===== */
  await post("/api/cart/lines", { variantId: V.M, qty: 1 }, { jar: ADA })
  const r2 = await post("/api/checkout", coBody("second", { paymentMethod: "card" }), { jar: ADA })
  const co2 = r2.body
  check("second: checkout with card → NGN_CARD corridor", r2.status === 201 && JSON.stringify(JSON.parse(mock.state.requests.filter((r) => r.path === "/v1/checkout-sessions" && r.method === "POST").pop().body).payment_method_types) === '["NGN_CARD"]', brief(r2))
  const chk2 = [...mock.state.sessions.values()].find((s) => s.reference === co2?.payment?.reference)
  const fake = { id: `evt_${RUN}early`, type: "checkout.completed", created_at: new Date().toISOString(), organization_id: "acct_mockYard", data: { checkout_id: chk2?.checkout_id, reference: co2?.payment?.reference, status: "completed", payment_status: "paid", amount: chk2?.amount, currency: "NGN" } }
  const early = await deliver(fake)
  check("second: a 'completed' event Bachs' API doesn't confirm → 500 (Bachs retries), nothing applied", early.status === 500 && (await get(`/api/checkout/${co2.id}`, { jar: ADA })).body?.status === "pending_payment", brief(early))
  const m0 = await variant("M")
  const exp = await deliver(mock.expire(chk2.checkout_id))
  const after2 = await get(`/api/checkout/${co2.id}`, { jar: ADA })
  check("second: checkout.expired → checkout failed, payment failed, hold released", exp.status === 200 && after2.body?.status === "failed" && after2.body?.payment?.status === "failed", `${brief(exp)} → ${after2.body?.status}/${after2.body?.payment?.status}`)
  const m1 = await variant("M")
  check("second: the expired checkout's stock hold is released", m1?.held === m0.held - 1 && m1?.onHand === m0.onHand, `${m0?.onHand}/${m0?.held} → ${m1?.onHand}/${m1?.held}`)

  // Cleanup: archive the product.
  const p = (await get(`/api/studio/catalog/products/${P.id}`, { jar: OWNER })).body?.product
  if (p && p.status !== "archived") await del(`/api/studio/catalog/products/${P.id}?expectedVersion=${p.version}`, { jar: OWNER })
  await del("/api/cart", { jar: ADA })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = await startBachsMock({ port: MOCK_PORT })
  try {
    await main(mock)
  } catch (e) {
    check("kit ran to the end", false, String(e?.stack ?? e).slice(0, 600))
  }
  await mock.close()
  await sleep(10)
  console.log(`# ${passed} passed, ${failed} failed (run ${TAG})`)
  process.exit(failed ? 1 : 0)
}
