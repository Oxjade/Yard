#!/usr/bin/env node
// CHECKOUT v3 live acceptance kit (cart, checkout, stub payments, Paystack webhook, provider events,
// refunds through PAYMENTS.requestRefund). Plain Node 22 (fetch, no deps). Prints one PASS/FAIL line
// per check and exits non-zero when any check fails.
//
//   node scripts/checks/v3-checkout.mjs            (server at YARD_BASE, default http://localhost:3000)
//
// Needs a DEVELOPMENT server with the payment STUB active (no PAYSTACK_SECRET_KEY): demo sign-in, the
// dev-only /api/checkout/{id}/stub-pay and /stub-expire hooks, /api/webhooks/paystack/simulate, and the
// stub email provider printing sign-up links to the dev log. Env:
//   YARD_BASE     server origin
//   YARD_DEV_LOG  the dev server's stdout log (sign-up verification links are read from it)
//
// Test data: every record carries this run's tag t_v3_checkout_<run> (shopper emails, product titles,
// SKUs, idempotency keys, provider-event references). Shoppers are fresh sign-ups owned by the run; the
// product lives in the seeded brand Lagos Static and is archived at the end. Seeded rows are only read.
import { readFileSync } from "node:fs"
import { pathToFileURL, fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { deflateSync, crc32 } from "node:zlib"

let base = (process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
const DEV_LOG = process.env.YARD_DEV_LOG ?? "/tmp/claude-0/-home-user/e300ec86-35a4-5f82-b2d8-95972eccde0c/scratchpad/dev.log"
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TAG = `t_v3_checkout_${RUN}`
const BRAND = "b_lagos_static"

let failed = 0
let passed = 0
let quiet = false
const results = []
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail !== "" && detail !== undefined && detail !== null ? (typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)) : ""
  results.push({ status: ok ? "PASS" : "FAIL", name, detail: d })
  if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${d && !ok ? ` — ${d}` : ""}`)
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

/** A cookie jar that follows Set-Cookie like a browser. */
class Jar {
  constructor(cookie = "") {
    this.cookie = cookie
  }
  has(name) {
    return this.cookie.split("; ").some((c) => c.split("=")[0] === name)
  }
}

async function api(method, path, { jar, cookie, body, headers, raw, noOrigin } = {}) {
  const h = { ...(noOrigin ? {} : { Origin: base, "X-Yard-Client": "1" }), ...(headers ?? {}) }
  const ck = jar ? jar.cookie : cookie
  if (ck) h.cookie = ck
  let payload
  if (raw !== undefined) payload = raw
  else if (body !== undefined) {
    h["Content-Type"] = "application/json"
    payload = JSON.stringify(body)
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, { method, headers: h, body: payload, redirect: "manual" })
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {}
      if (jar) jar.cookie = mergeCookies(jar.cookie, res)
      // A rate limit from concurrent kits sharing the server: wait it out once or twice.
      if (res.status === 429 && attempt < 3) {
        await sleep(Math.min(65, Number(res.headers.get("retry-after") ?? 10)) * 1000)
        continue
      }
      return { status: res.status, body: json, text, headers: res.headers, res }
    } catch (e) {
      // The shared dev server may be restarting (a guard restarts it): wait and retry for ~2 min.
      if (attempt >= 12) throw e
      await sleep(10_000)
    }
  }
}
const get = (p, o) => api("GET", p, o)
const post = (p, body, o = {}) => api("POST", p, { ...o, body })
const patch = (p, body, o = {}) => api("PATCH", p, { ...o, body })
const del = (p, o) => api("DELETE", p, o)
const brief = (r) => `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message} ${r.body.error.fields ? JSON.stringify(r.body.error.fields) : ""}` : r.text.slice(0, 240)}`
const fields = (r) => r.body?.error?.fields ?? {}

async function demo(actor, account, brandId) {
  const jar = new Jar()
  const r = await post("/api/auth/demo", { actor, account, ...(brandId ? { brandId } : {}) }, { jar })
  if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
  return jar
}

/**
 * The kit's shoppers are long-lived accounts tagged t_v3_checkout_ (sign-up emails are rate limited
 * per IP / globally and shared with every kit on this server, so each run signs in instead of signing
 * up). The first credentials that sign in win; otherwise the canonical account is signed up and
 * verified through the dev log. Every run empties their carts first.
 */
const KIT_PW = "Kit-checkout-v3-pw!"
const KNOWN = {
  s1: [["t_v3_checkout_mw86z93e7qkn_s1@example.com", "Kit-mw86z93e7qkn-pw!"]],
  s2: [["t_v3_checkout_mw86z93e7qkn_s2@example.com", "Kit-mw86z93e7qkn-pw!"]],
}
async function kitShopper(label) {
  const candidates = [...(KNOWN[label] ?? []), [`t_v3_checkout_kit_${label}@example.com`, KIT_PW]]
  for (const [email, password] of candidates) {
    const jar = new Jar()
    const r = await post("/api/auth/sign-in", { email, password, actor: "shopper" }, { jar })
    if (r.status === 200) {
      await del("/api/cart", { jar })
      return jar
    }
  }
  return signUpShopper(label, `t_v3_checkout_kit_${label}@example.com`, KIT_PW)
}

/** Signs up a new shopper and confirms it through the link the stub email provider prints to the dev log. */
async function signUpShopper(label, email, password, jar = new Jar()) {
  const r = await post("/api/auth/sign-up", { name: `Checkout Kit ${label}`, email, password })
  if (r.status !== 200) throw new Error(`sign-up ${label}: ${brief(r)}`)
  let token = null
  for (let i = 0; i < 60 && !token; i++) {
    try {
      const log = readFileSync(DEV_LOG, "utf8")
      const at = log.lastIndexOf(`to: ${email}`)
      if (at >= 0) token = /verify\?token=([\w-]+)/.exec(log.slice(at, at + 2000))?.[1] ?? null
    } catch {}
    if (!token) await sleep(2000)
  }
  if (!token) throw new Error(`no verification link for ${email} in ${DEV_LOG}`)
  const v = await post("/api/auth/verify-email/confirm", { token }, { jar })
  if (v.status !== 200) throw new Error(`verify-email ${label}: ${brief(v)}`)
  return jar
}

/** A valid 64x64 RGB PNG, built here so the kit has no file dependencies. */
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
    for (let x = 0; x < w; x++) rows.push(Buffer.from([(x * 4) & 255, (y * 4) & 255, 90]))
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
}

async function uploadBrandImage(jar) {
  const boundary = `----yardkit${RUN}`
  const bodyBuf = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}.png"\r\nContent-Type: image/png\r\n\r\n`),
    pngBytes(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return api("POST", `/api/uploads?purpose=social_post&as=brand`, { jar, raw: bodyBuf, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(bodyBuf.length) } })
}

/* ---------------- the kit ---------------- */

const created = { products: [] }
const shipTo = { name: "Checkout Kit", line1: "1 Kit Street", city: "Lagos", country: "NG", phone: "+234 800 000 0000" }
const key = (n) => `${TAG}_${n}`

async function main() {
  if (!quiet) console.log(`# CHECKOUT v3 kit against ${base}, run ${TAG}`)

  /* ===== Setup: a product in Lagos Static with controlled stock ===== */
  const OWNER = await demo("brand", "u_b_tobi", BRAND)
  const VIEWER_B = await demo("brand", "u_b_viewer", BRAND)
  const ADM_OWNER = await demo("admin", "adm_1")
  const ADM_TS = await demo("admin", "adm_3")
  const ADM_SUP = await demo("admin", "adm_5")

  const up = await uploadBrandImage(OWNER)
  const mediaId = up.body?.media?.id
  check("setup: brand photo upload", up.status === 201 && !!mediaId, brief(up))
  const createBody = {
    images: mediaId ? [{ mediaId, alt: TAG }] : [],
    title: `${TAG} Jacket`,
    description: "A checkout kit jacket.",
    categorySlug: "fashion",
    priceMinor: 20_000,
    options: [{ name: "Size", values: [{ value: "S" }, { value: "M" }, { value: "L" }, { value: "XL" }] }],
    variants: [
      { sku: `${TAG}-S`, options: { Size: "S" }, initialStock: 30 },
      { sku: `${TAG}-M`, options: { Size: "M" }, initialStock: 2 },
      { sku: `${TAG}-L`, options: { Size: "L" } },
      { sku: `${TAG}-XL`, options: { Size: "XL" }, initialStock: 10, priceMinor: 25_000 },
    ],
  }
  const c1 = await post("/api/studio/catalog/products", createBody, { jar: OWNER })
  const P = c1.body?.product
  if (!check("setup: kit product created in Lagos Static", c1.status === 201 && !!P, brief(c1))) throw new Error("setup failed")
  created.products.push(P.id)
  const pub = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: P.version }, { jar: OWNER })
  if (!check("setup: kit product published", pub.status === 200, brief(pub))) throw new Error("setup failed")
  const V = Object.fromEntries(P.variants.map((v) => [v.options.Size, v.id]))
  const studioVariant = async (size) => (await get(`/api/studio/catalog/products/${P.id}`, { jar: OWNER })).body?.product?.variants?.find((x) => x.id === V[size])
  const productVersion = async () => (await get(`/api/studio/catalog/products/${P.id}`, { jar: OWNER })).body?.product?.version

  /* ===== Cart: anonymous ===== */
  const ANON = new Jar()
  {
    const empty = await get("/api/cart?currency=NGN", { jar: ANON })
    check("cart: anonymous GET with no cookie is an empty cart", empty.status === 200 && empty.body.lines.length === 0 && empty.body.id === null && empty.body.itemCount === 0, brief(empty))
    check("cart: GET without a cart doesn't set a cookie", !ANON.has("yard_cart") && !ANON.has("__Host-yard_cart"))

    const add = await post("/api/cart/lines", { variantId: V.S, qty: 2 }, { jar: ANON })
    check("cart: anonymous add → 201 and sets the yard_cart cookie", add.status === 201 && (ANON.has("yard_cart") || ANON.has("__Host-yard_cart")), brief(add))
    const setCookie = add.res.headers.getSetCookie?.().find((c) => /yard_cart=/.test(c)) ?? ""
    check("cart: the cart cookie is httpOnly and SameSite=Lax", /httponly/i.test(setCookie) && /samesite=lax/i.test(setCookie), setCookie)
    await post("/api/cart/lines", { variantId: V.XL, qty: 1 }, { jar: ANON })
    const v = await get("/api/cart?currency=NGN", { jar: ANON })
    const lS = v.body?.lines?.find((l) => l.variantId === V.S)
    check(
      "cart: anonymous cart is re-priced from the catalogue (variant override honoured)",
      v.status === 200 && lS?.qty === 2 && lS.unitMinor === 20_000 && lS.lineMinor === 40_000 && v.body.lines.find((l) => l.variantId === V.XL)?.unitMinor === 25_000 && v.body.subtotalMinor === 65_000 && v.body.itemCount === 3,
      brief(v),
    )
    check("cart: lines carry integer minor prices and a status", v.body?.lines?.every((l) => Number.isInteger(l.unitMinor) && Number.isInteger(l.lineMinor) && l.status === "ok"))

    const tampered = new Jar(ANON.cookie.replace(/(yard_cart=[\w-]{43}\.)[\w-]/, (m, p1) => p1 + (m.endsWith("A") ? "B" : "A")))
    const tv = await get("/api/cart?currency=NGN", { jar: tampered })
    check("cart: a tampered cart cookie is ignored (empty cart)", tv.status === 200 && tv.body.lines.length === 0, brief(tv))
    const other = await get("/api/cart?currency=NGN", { jar: new Jar() })
    check("cart: another browser doesn't see this anonymous cart", other.status === 200 && other.body.lines.length === 0)

    const usd = await get("/api/cart?currency=USD", { jar: ANON })
    const uS = usd.body?.lines?.find((l) => l.variantId === V.S)
    check("cart: display currency converts prices (USD < NGN amount, catalog price kept)", usd.status === 200 && usd.body.currency === "USD" && uS?.unitMinor > 0 && uS.unitMinor < 20_000 && uS.unitPrice?.amountMinor === 20_000 && uS.unitPrice.currency === "NGN", brief(usd))
    check("cart: unknown currency is 400", (await get("/api/cart?currency=XYZ", { jar: ANON })).status === 400)
    check("cart: malformed currency is 400", (await get("/api/cart?currency=naira", { jar: ANON })).status === 400)
    check("cart: malformed destination is 400", (await get("/api/cart?currency=NGN&to=Nigeria", { jar: ANON })).status === 400)

    const ship = await get("/api/cart?currency=NGN&to=NG&city=Lagos", { jar: ANON })
    const g = ship.body?.groups?.find((x) => x.brandId === BRAND)
    check(
      "cart: with a destination each brand group has delivery options",
      ship.status === 200 && !!g?.shipping && Array.isArray(g.shipping.options) && g.shipping.options.some((o) => o.available && Number.isInteger(o.priceMinor)) && ship.body.destination?.country === "NG",
      brief(ship),
    )
    check("cart: group subtotal matches its lines", g?.subtotalMinor === 65_000 && g.variantIds.length === 2)
    const noTo = await get("/api/cart?currency=NGN", { jar: ANON })
    check("cart: without a destination there are no delivery quotes", noTo.body?.groups?.every((x) => x.shipping === null) && noTo.body.destination === null)

    // Validation and limits
    check("cart: add qty 0 is 400", (await post("/api/cart/lines", { variantId: V.S, qty: 0 }, { jar: ANON })).status === 400)
    check("cart: add qty 21 is 400", (await post("/api/cart/lines", { variantId: V.S, qty: 21 }, { jar: ANON })).status === 400)
    check("cart: add fractional qty is 400", (await post("/api/cart/lines", { variantId: V.S, qty: 1.5 }, { jar: ANON })).status === 400)
    check("cart: add with an unknown field is 400", (await post("/api/cart/lines", { variantId: V.S, qty: 1, priceMinor: 1 }, { jar: ANON })).status === 400)
    check("cart: malformed variant id is 400", (await post("/api/cart/lines", { variantId: "a b/../c", qty: 1 }, { jar: ANON })).status === 400)
    const unknown = await post("/api/cart/lines", { variantId: `pv_${RUN}nope`, qty: 1 }, { jar: ANON })
    check("cart: unknown variant is 404", unknown.status === 404, brief(unknown))
    const soldOut = await post("/api/cart/lines", { variantId: V.L, qty: 1 }, { jar: ANON })
    check("cart: a sold-out variant can't go in the cart (409)", soldOut.status === 409, brief(soldOut))
    const tooMany = await post("/api/cart/lines", { variantId: V.M, qty: 3 }, { jar: ANON })
    check("cart: more than available is 409 'Only 2 left'", tooMany.status === 409 && /2 left/.test(tooMany.body?.error?.message ?? ""), brief(tooMany))
    const over20 = await post("/api/cart/lines", { variantId: V.S, qty: 19 }, { jar: ANON })
    check("cart: adding past 20 of one piece is 422", over20.status === 422, brief(over20))
    const noOrigin = await api("POST", "/api/cart/lines", { jar: ANON, body: { variantId: V.S, qty: 1 }, noOrigin: true })
    check("cart: a write without Origin / X-Yard-Client is refused (403)", noOrigin.status === 403, brief(noOrigin))
    const evil = await api("POST", "/api/cart/lines", { jar: ANON, body: { variantId: V.S, qty: 1 }, headers: { Origin: "https://evil.example", "X-Yard-Client": "1" }, noOrigin: true })
    check("cart: a cross-site Origin is refused (403)", evil.status === 403, brief(evil))

    // PATCH / DELETE lines
    const p1 = await patch(`/api/cart/lines/${V.S}`, { qty: 3 }, { jar: ANON })
    check("cart: PATCH sets the quantity", p1.status === 200 && (await get("/api/cart?currency=NGN", { jar: ANON })).body.lines.find((l) => l.variantId === V.S)?.qty === 3, brief(p1))
    await post("/api/cart/lines", { variantId: V.M, qty: 1 }, { jar: ANON })
    const pM = await patch(`/api/cart/lines/${V.M}`, { qty: 3 }, { jar: ANON })
    check("cart: PATCH M to 3 (2 in stock) is 409", pM.status === 409, brief(pM))
    check("cart: PATCH qty 21 is 400", (await patch(`/api/cart/lines/${V.S}`, { qty: 21 }, { jar: ANON })).status === 400)
    check("cart: PATCH a variant not in the cart is 404", (await patch(`/api/cart/lines/${V.L}`, { qty: 1 }, { jar: ANON })).status === 404)
    check("cart: PATCH without any cart is 404", (await patch(`/api/cart/lines/${V.S}`, { qty: 1 }, { jar: new Jar() })).status === 404)
    const p0 = await patch(`/api/cart/lines/${V.M}`, { qty: 0 }, { jar: ANON })
    check("cart: PATCH qty 0 removes the line", p0.status === 200 && !(await get("/api/cart?currency=NGN", { jar: ANON })).body.lines.some((l) => l.variantId === V.M), brief(p0))
    await patch(`/api/cart/lines/${V.S}`, { qty: 2 }, { jar: ANON })
    await post("/api/cart/lines", { variantId: V.M, qty: 1 }, { jar: ANON })
    const dM = await del(`/api/cart/lines/${V.M}`, { jar: ANON })
    check("cart: DELETE a line → 204 and it's gone", dM.status === 204 && !(await get("/api/cart?currency=NGN", { jar: ANON })).body.lines.some((l) => l.variantId === V.M), brief(dM))
    check("cart: DELETE a line not in the cart is still 204", (await del(`/api/cart/lines/${V.M}`, { jar: ANON })).status === 204)
    check("cart: DELETE a malformed line id is 404", (await del(`/api/cart/lines/a%20b`, { jar: ANON })).status === 404)
  }

  /* ===== Merge on sign-in ===== */
  const S1 = await kitShopper("s1")
  const S2 = await kitShopper("s2")
  created.shoppers = [S1, S2]
  {
    check("merge: POST /api/cart/merge without a session is 401", (await post("/api/cart/merge", undefined, { jar: new Jar() })).status === 401)
    // S1 has S×1 in their own cart; the anonymous browser has S×2 + XL×1.
    const own = await post("/api/cart/lines", { variantId: V.S, qty: 1 }, { jar: S1 })
    check("cart: signed-in add → 201", own.status === 201, brief(own))
    check("cart: signed-in cart isn't visible to another shopper", (await get("/api/cart?currency=NGN", { jar: S2 })).body?.lines?.length === 0)
    // The anon cookie now joins S1's browser.
    const anonCookie = ANON.cookie.split("; ").find((c) => /yard_cart=/.test(c))
    const both = new Jar(`${S1.cookie}; ${anonCookie}`)
    const m = await post("/api/cart/merge", undefined, { jar: both })
    check("merge: explicit merge → { merged: 2 }", m.status === 200 && m.body?.merged === 2, brief(m))
    check("merge: the anonymous cookie is cleared after merging", !both.has("yard_cart") && !both.has("__Host-yard_cart"), both.cookie)
    const v = await get("/api/cart?currency=NGN", { jar: S1 })
    check(
      "merge: quantities add up (S 1+2=3, XL 1)",
      v.body?.lines?.find((l) => l.variantId === V.S)?.qty === 3 && v.body.lines.find((l) => l.variantId === V.XL)?.qty === 1 && v.body.lines.length === 2,
      brief(v),
    )
    const after = await get("/api/cart?currency=NGN", { jar: new Jar(anonCookie) })
    check("merge: the old anonymous cart is gone (cookie replays an empty cart)", after.body?.lines?.length === 0, brief(after))
    const again = await post("/api/cart/merge", undefined, { jar: S1 })
    check("merge: merging again with no anonymous cart → merged 0", again.status === 200 && again.body?.merged === 0)

    // Lazy merge: an anon cart in S2's browser merges on the next GET.
    const A2 = new Jar()
    await post("/api/cart/lines", { variantId: V.XL, qty: 2 }, { jar: A2 })
    const s2b = new Jar(`${S2.cookie}; ${A2.cookie}`)
    const lazy = await get("/api/cart?currency=NGN", { jar: s2b })
    check("merge: GET /api/cart merges this browser's anonymous cart lazily", lazy.body?.lines?.find((l) => l.variantId === V.XL)?.qty === 2, brief(lazy))
    // Cap at 20 per line when merging.
    const A3 = new Jar()
    await post("/api/cart/lines", { variantId: V.S, qty: 20 }, { jar: A3 })
    await post("/api/cart/lines", { variantId: V.S, qty: 5 }, { jar: S2 })
    await post("/api/cart/merge", undefined, { jar: new Jar(`${S2.cookie}; ${A3.cookie}`) })
    const capped = await get("/api/cart?currency=NGN", { jar: S2 })
    check("merge: merged quantities are capped at 20 per piece", capped.body?.lines?.find((l) => l.variantId === V.S)?.qty === 20, brief(capped))
    await del("/api/cart", { jar: S2 })
    check("cart: DELETE /api/cart empties it", (await get("/api/cart?currency=NGN", { jar: S2 })).body?.lines?.length === 0)
    await del("/api/cart", { jar: S2 })
  }

  /* ===== Checkout: auth, validation ===== */
  const coBody = (k, extra = {}) => ({ idempotencyKey: key(k), currency: "NGN", shipTo, shipping: [{ brandId: BRAND, service: "standard" }], ...extra })
  const pickService = async (jar) => {
    const v = await get("/api/cart?currency=NGN&to=NG&city=Lagos", { jar })
    const g = v.body?.groups?.find((x) => x.brandId === BRAND)
    const opt = g?.shipping?.options?.find((o) => o.available)
    return { service: opt?.service ?? "standard", shippingMinor: opt?.priceMinor ?? 0, subtotalMinor: g?.subtotalMinor ?? 0, view: v.body }
  }
  const { service: SERVICE } = await pickService(S1)
  const body = (k, extra = {}) => coBody(k, { shipping: [{ brandId: BRAND, service: SERVICE }], ...extra })
  {
    check("checkout: no session is 401", (await post("/api/checkout", body("anon"), { jar: new Jar() })).status === 401)
    check("checkout: a brand session is not a shopper (401)", (await post("/api/checkout", body("brand"), { jar: OWNER })).status === 401)
    check("checkout: GET a checkout without a session is 401", (await get(`/api/checkout/co_${RUN}`, { jar: new Jar() })).status === 401)
    const empty = await post("/api/checkout", body("empty"), { jar: S2 })
    check("checkout: an empty cart is 422", empty.status === 422, brief(empty))
    check("checkout: idempotencyKey too short is 400", (await post("/api/checkout", { ...body("x"), idempotencyKey: "short" }, { jar: S1 })).status === 400)
    check("checkout: idempotencyKey with odd characters is 400", (await post("/api/checkout", { ...body("x"), idempotencyKey: `${TAG} bad key!` }, { jar: S1 })).status === 400)
    check("checkout: missing shipTo is 400", (await post("/api/checkout", { ...body("x"), shipTo: undefined }, { jar: S1 })).status === 400)
    check("checkout: unknown field is 400", (await post("/api/checkout", { ...body("x"), totalMinor: 1 }, { jar: S1 })).status === 400)
    check("checkout: unknown delivery service is 400", (await post("/api/checkout", { ...body("x"), shipping: [{ brandId: BRAND, service: "teleport" }] }, { jar: S1 })).status === 400)
    check("checkout: negative expectedTotalMinor is 400", (await post("/api/checkout", body("x", { expectedTotalMinor: -1 }), { jar: S1 })).status === 400)
    check("checkout: malformed currency is 400", (await post("/api/checkout", body("x", { currency: "ngn" }), { jar: S1 })).status === 400)
    const gbp = await post("/api/checkout", body("gbp", { currency: "GBP" }), { jar: S1 })
    check("checkout: a Yard currency Paystack can't charge (GBP) is 422", gbp.status === 422, brief(gbp))
    const eur = await post("/api/checkout", body("eur", { currency: "EUR" }), { jar: S1 })
    check("checkout: EUR is 422 too", eur.status === 422, brief(eur))
    const noShip = await post("/api/checkout", { ...body("noship"), shipping: [{ brandId: "b_null_form", service: SERVICE }] }, { jar: S1 })
    check("checkout: delivery missing for a brand in the cart → 400 with shipping.<brand>", noShip.status === 400 && !!fields(noShip)[`shipping.${BRAND}`] && !!fields(noShip)["shipping.b_null_form"], brief(noShip))
    // Pickup is offered in Lagos only: asking for it with an Abuja address is a delivery conflict.
    const na = await post("/api/checkout", { ...body("na"), shipTo: { ...shipTo, city: "Abuja" }, shipping: [{ brandId: BRAND, service: "pickup" }] }, { jar: S1 })
    check("checkout: a delivery option not offered to the address (pickup in Abuja) is 409 with shipping.<brand>", na.status === 409 && !!fields(na)[`shipping.${BRAND}`], brief(na))
    const badCountry = await post("/api/checkout", body("ctry", { shipTo: { ...shipTo, country: "ZZ" } }), { jar: S1 })
    check("checkout: unknown ship-to country is 400", badCountry.status === 400, brief(badCountry))
  }

  /* ===== Repricing + expectedTotal ===== */
  let S1total
  {
    const q = await pickService(S1)
    S1total = q.subtotalMinor + q.shippingMinor
    check("checkout: cart subtotal for S1 is 3×20000 + 25000", q.subtotalMinor === 85_000, JSON.stringify(q.view?.groups))
    const ver = await productVersion()
    const up = await patch(`/api/studio/catalog/products/${P.id}`, { priceMinor: 21_000, expectedVersion: ver }, { jar: OWNER })
    check("setup: brand raises the price to 21000", up.status === 200, brief(up))
    const q2 = await pickService(S1)
    check("reprice: the cart picks up the new catalog price", q2.subtotalMinor === 3 * 21_000 + 25_000, JSON.stringify(q2.view?.groups))
    const stale = await post("/api/checkout", body("stale", { expectedTotalMinor: S1total }), { jar: S1 })
    const newTotal = q2.subtotalMinor + q2.shippingMinor
    check("checkout: expectedTotalMinor mismatch is 409 with the new total", stale.status === 409 && fields(stale).expectedTotalMinor === String(newTotal), brief(stale))
    S1total = newTotal
    // Nothing was created by the refused attempt: the same key is free for the right total.
  }

  /* ===== Stock shortage ===== */
  {
    // S1 wants 2 × M; S2 holds 1 × M first through its own checkout → S1 is short.
    await post("/api/cart/lines", { variantId: V.M, qty: 1 }, { jar: S2 })
    const holdCo = await post("/api/checkout", body("s2hold"), { jar: S2 })
    check("checkout: S2 starts a checkout for 1 × M (201)", holdCo.status === 201, brief(holdCo))
    const vM = await studioVariant("M")
    check("checkout: starting a checkout holds the stock (M held 1)", vM?.held === 1 && vM.onHand === 2, JSON.stringify(vM))
    const s2add = await post("/api/cart/lines", { variantId: V.M, qty: 2 }, { jar: S1 })
    check("cart: only 1 M left now → adding 2 is 409", s2add.status === 409, brief(s2add))
    await post("/api/cart/lines", { variantId: V.M, qty: 1 }, { jar: S1 })
    // Brand takes the last one off sale before S1 checks out.
    const st = await post(`/api/studio/catalog/variants/${V.M}/stock`, { mode: "set", qty: 1, reason: "correction", note: TAG }, { jar: OWNER })
    check("setup: brand sets M on-hand to 1 (all held)", st.status === 200, brief(st))
    const short = await post("/api/checkout", body("s1short"), { jar: S1 })
    check("checkout: stock shortage is 409 with lines.<variantId>", short.status === 409 && !!fields(short)[`lines.${V.M}`], brief(short))
    const cartIssues = await get("/api/cart?currency=NGN", { jar: S1 })
    check("cart: a sold-out line shows as unavailable with an issue", cartIssues.body?.lines?.find((l) => l.variantId === V.M)?.status === "unavailable" && cartIssues.body.issues.length >= 1, brief(cartIssues))
    await del(`/api/cart/lines/${V.M}`, { jar: S1 })
    // Expiry path on S2's checkout (hold released).
    if (holdCo.status === 201) {
      const id = holdCo.body.id
      check("checkout: stub view says nothing is charged", holdCo.body.payment?.stub === true && /Nothing will be charged/.test(holdCo.body.payment.message ?? "") && holdCo.body.payment.authorizationUrl === null, JSON.stringify(holdCo.body.payment))
      check("checkout: expiry hook needs the owner (404 for another shopper)", (await post(`/api/checkout/${id}/stub-expire`, undefined, { jar: S1 })).status === 404)
      const ex = await post(`/api/checkout/${id}/stub-expire`, undefined, { jar: S2 })
      const vM2 = await studioVariant("M")
      check("expiry: an expired checkout releases its hold", ex.status === 200 && ex.body?.status === "expired" && vM2?.held === 0, `${brief(ex)} held=${vM2?.held}`)
      check("expiry: the payment is abandoned", ex.body?.payment?.status === "abandoned", JSON.stringify(ex.body?.payment))
      const o = await get(`/api/orders/${holdCo.body.orderIds?.[0]}`, { jar: S2 })
      check("expiry: ORDERS marks the order's payment failed", o.status === 200 && o.body?.order?.states?.payment === "failed" || o.body?.states?.payment === "failed", brief(o).slice(0, 300))
      const late = await post(`/api/checkout/${id}/stub-pay`, { outcome: "success" }, { jar: S2 })
      check("expiry: stub-pay after expiry doesn't revive the checkout", late.status === 200 && late.body.status === "expired", brief(late))
      const exAgain = await post(`/api/checkout/${id}/stub-expire`, undefined, { jar: S2 })
      check("expiry: expiring again is a no-op", exAgain.status === 200 && exAgain.body.status === "expired" && (await studioVariant("M"))?.held === 0)
      created.expired = ex.body
    }
    await del("/api/cart", { jar: S2 })
  }

  /* ===== Idempotency + success path (S1) ===== */
  let paidCo = null
  {
    const vS0 = await studioVariant("S")
    const vXL0 = await studioVariant("XL")
    const r1 = await post("/api/checkout", body("main", { expectedTotalMinor: S1total }), { jar: S1 })
    check("checkout: start → 201 pending_payment", r1.status === 201 && r1.body?.status === "pending_payment" && r1.body.totalMinor === S1total, brief(r1))
    if (r1.status !== 201) throw new Error("checkout start failed; later checks depend on it")
    const co = r1.body
    check("checkout: totals add up (subtotal + shipping = total)", co.subtotalMinor + co.shippingMinor === co.totalMinor && co.subtotalMinor === 3 * 21_000 + 25_000)
    check("checkout: one order per brand, with a reference", co.orderIds.length === 1 && typeof co.reference === "string" && co.reference.length > 0, JSON.stringify(co).slice(0, 300))
    check("checkout: payment row is the stub, initialized, same amount", co.payment?.provider === "stub" && co.payment.status === "initialized" && co.payment.stub === true)
    const vS1 = await studioVariant("S")
    check("checkout: stock held for each line (S +3, XL +1)", vS1.held === vS0.held + 3 && (await studioVariant("XL")).held === vXL0.held + 1, `S held ${vS0.held}→${vS1.held}`)

    const r2 = await post("/api/checkout", body("main", { expectedTotalMinor: S1total }), { jar: S1 })
    check("idempotency: same key + same body → 200 with the same checkout", r2.status === 200 && r2.body.id === co.id, brief(r2))
    check("idempotency: a retry doesn't hold stock twice", (await studioVariant("S")).held === vS1.held)
    const r2b = await post("/api/checkout", body("main"), { jar: S1 })
    check("idempotency: expectedTotalMinor omitted on retry still the same checkout", r2b.status === 200 && r2b.body.id === co.id, brief(r2b))
    const r3 = await post("/api/checkout", body("main", { shipTo: { ...shipTo, line1: "2 Other Street" } }), { jar: S1 })
    check("idempotency: same key + different body → 409", r3.status === 409 || r3.status === 422, brief(r3))
    const r4 = await post("/api/checkout", body("main"), { jar: S2 })
    check("idempotency: the key is per shopper (S2 with S1's key is not S1's checkout)", r4.body?.id !== co.id, brief(r4))

    // Concurrency: two identical requests at once → one checkout.
    await post("/api/cart/lines", { variantId: V.XL, qty: 1 }, { jar: S2 })
    const [a, b] = await Promise.all([post("/api/checkout", body("race"), { jar: S2 }), post("/api/checkout", body("race"), { jar: S2 })])
    check("idempotency: two concurrent starts with one key → one checkout (201 + 200)", [a.status, b.status].sort().join() === "200,201" && a.body?.id === b.body?.id, `${brief(a)} | ${brief(b)}`)
    const raceCo = a.body?.id

    // Ownership
    check("checkout: owner can GET it", (await get(`/api/checkout/${co.id}`, { jar: S1 })).status === 200)
    check("checkout: another shopper GET is 404", (await get(`/api/checkout/${co.id}`, { jar: S2 })).status === 404)
    check("checkout: another shopper verify is 404", (await post(`/api/checkout/${co.id}/verify`, undefined, { jar: S2 })).status === 404)
    check("checkout: another shopper stub-pay is 404", (await post(`/api/checkout/${co.id}/stub-pay`, { outcome: "success" }, { jar: S2 })).status === 404)
    check("checkout: unknown checkout is 404", (await get(`/api/checkout/co_${RUN}missing`, { jar: S1 })).status === 404)
    check("checkout: malformed checkout id is 404", (await get(`/api/checkout/a%20b`, { jar: S1 })).status === 404)
    check("checkout: stub-pay with a bad outcome is 400", (await post(`/api/checkout/${co.id}/stub-pay`, { outcome: "maybe" }, { jar: S1 })).status === 400)
    const ver = await post(`/api/checkout/${co.id}/verify`, undefined, { jar: S1 })
    check("verify: with the stub provider it changes nothing (still pending)", ver.status === 200 && ver.body.status === "pending_payment", brief(ver))

    // Pay
    const paid = await post(`/api/checkout/${co.id}/stub-pay`, { outcome: "success" }, { jar: S1 })
    check("pay: stub success → checkout paid, payment succeeded", paid.status === 200 && paid.body.status === "paid" && paid.body.payment?.status === "succeeded" && !!paid.body.paidAt, brief(paid))
    paidCo = paid.body
    const vS2 = await studioVariant("S")
    const vXL2 = await studioVariant("XL")
    check("pay: hold committed (S on_hand −3, held back down)", vS2.onHand === vS0.onHand - 3 && vS2.held === vS0.held, `onHand ${vS0.onHand}→${vS2.onHand} held ${vS2.held}`)
    check("pay: XL committed too", vXL2.onHand === vXL0.onHand - 1 - 0 && vXL2.held === vXL0.held + 1 /* S2's race checkout still holds 1 */, `XL onHand ${vXL0.onHand}→${vXL2.onHand} held ${vXL2.held}`)
    const mv = (await get(`/api/studio/catalog/variants/${V.S}/movements`, { jar: OWNER })).body?.movements ?? []
    check("pay: one sale movement for the checkout", mv.filter((m) => m.reason === "sale" && m.refId === co.id).length === 1, JSON.stringify(mv[0]))
    const orderId = co.orderIds[0]
    const od = await get(`/api/orders/${orderId}`, { jar: S1 })
    const odState = od.body?.order?.states ?? od.body?.states
    check("pay: ORDERS marks the order paid", od.status === 200 && odState?.payment === "paid", brief(od).slice(0, 300))
    check("pay: another shopper can't read the order (404)", (await get(`/api/orders/${orderId}`, { jar: S2 })).status === 404)
    const cartAfter = await get("/api/cart?currency=NGN", { jar: S1 })
    check("pay: purchased pieces are removed from the cart", cartAfter.body?.lines?.length === 0, brief(cartAfter))
    const led = await get(`/api/admin/finance/ledger?brandId=${BRAND}&currency=NGN&limit=100`, { jar: ADM_OWNER })
    const ledText = JSON.stringify(led.body ?? {})
    check("pay: LEDGER posted the capture for the order", led.status === 200 && (ledText.includes(orderId) || ledText.includes(paidCo.payment.id)), brief(led).slice(0, 300))

    // Idempotent re-pay
    const again = await post(`/api/checkout/${co.id}/stub-pay`, { outcome: "success" }, { jar: S1 })
    check("pay: paying again is a no-op (still paid, stock unchanged)", again.status === 200 && again.body.status === "paid" && (await studioVariant("S")).onHand === vS2.onHand)
    const fl = await post(`/api/checkout/${co.id}/stub-pay`, { outcome: "failed" }, { jar: S1 })
    check("pay: a failure after success doesn't undo the payment", fl.status === 200 && fl.body.status === "paid")
    const retryAfterPaid = await post("/api/checkout", body("main"), { jar: S1 })
    check("idempotency: retrying a paid checkout's key returns the paid checkout", retryAfterPaid.status === 200 && retryAfterPaid.body.id === co.id && retryAfterPaid.body.status === "paid", brief(retryAfterPaid))

    // Failure path (S2's race checkout)
    if (raceCo) {
      const vXLb = await studioVariant("XL")
      const f = await post(`/api/checkout/${raceCo}/stub-pay`, { outcome: "failed" }, { jar: S2 })
      const vXLa = await studioVariant("XL")
      check("fail: stub failure → checkout failed, payment failed", f.status === 200 && f.body.status === "failed" && f.body.payment?.status === "failed", brief(f))
      check("fail: hold released (XL held −1, on_hand unchanged)", vXLa.held === vXLb.held - 1 && vXLa.onHand === vXLb.onHand, `held ${vXLb.held}→${vXLa.held}`)
      const fo = await get(`/api/orders/${f.body.orderIds?.[0]}`, { jar: S2 })
      check("fail: ORDERS marks the order's payment failed", (fo.body?.order?.states ?? fo.body?.states)?.payment === "failed", brief(fo).slice(0, 300))
      check("fail: the cart is kept after a failed payment", (await get("/api/cart?currency=NGN", { jar: S2 })).body?.lines?.some((l) => l.variantId === V.XL))
      const ok = await post(`/api/checkout/${raceCo}/stub-pay`, { outcome: "success" }, { jar: S2 })
      check("fail: stub-pay success after failure doesn't revive it", ok.status === 200 && ok.body.status === "failed")
      const newKey = await post("/api/checkout", body("race2"), { jar: S2 })
      check("fail: a new key after a failed checkout starts a fresh one (201)", newKey.status === 201 && newKey.body.id !== raceCo, brief(newKey))
      if (newKey.status === 201) created.s3second = newKey.body
    }
  }

  /* ===== Webhook signature ===== */
  {
    const ref = `${TAG}_wh`
    const evBody = JSON.stringify({ event: "charge.success", data: { reference: ref, status: "success", amount: 100, currency: "NGN", id: 1 } })
    const none = await api("POST", "/api/webhooks/paystack", { raw: evBody, headers: { "Content-Type": "application/json" }, noOrigin: true })
    check("webhook: missing signature is 401", none.status === 401, brief(none))
    const bad = await api("POST", "/api/webhooks/paystack", { raw: evBody, headers: { "Content-Type": "application/json", "x-paystack-signature": "ab".repeat(64) }, noOrigin: true })
    check("webhook: wrong signature is 401", bad.status === 401, brief(bad))
    const junk = await api("POST", "/api/webhooks/paystack", { raw: evBody, headers: { "Content-Type": "application/json", "x-paystack-signature": "not-hex" }, noOrigin: true })
    check("webhook: malformed signature is 401", junk.status === 401, brief(junk))
    const ev = await get(`/api/webhooks/paystack/events?ref=${ref}`, { jar: ADM_OWNER })
    check("webhook: a refused webhook stores nothing", ev.status === 200 && ev.body.events.length === 0, brief(ev))
    check("webhook: GET is not allowed (405)", (await get("/api/webhooks/paystack")).status === 405)
  }

  /* ===== Provider events: list / detail / replay (admin) ===== */
  {
    const ref = paidCo?.payment?.reference
    check("events: no session is 401", (await get("/api/webhooks/paystack/events", { jar: new Jar() })).status === 401)
    check("events: a shopper is 401", (await get("/api/webhooks/paystack/events", { jar: S1 })).status === 401)
    check("events: an admin without audit.view (support) is 403", (await get("/api/webhooks/paystack/events", { jar: ADM_SUP })).status === 403)
    check("events: bad status filter is 400", (await get("/api/webhooks/paystack/events?status=nope", { jar: ADM_OWNER })).status === 400)
    check("events: limit over 200 is 400", (await get("/api/webhooks/paystack/events?limit=500", { jar: ADM_OWNER })).status === 400)
    const list = await get(`/api/webhooks/paystack/events?ref=${ref}`, { jar: ADM_OWNER })
    const evs = list.body?.events ?? []
    const success = evs.find((e) => e.eventType === "charge.success")
    check("events: the simulated charge.success for the paid checkout is listed, processed", list.status === 200 && success?.status === "processed" && success.source === "simulated", brief(list).slice(0, 300))
    if (success) {
      const one = await get(`/api/webhooks/paystack/events/${success.id}`, { jar: ADM_OWNER })
      check("events: detail has the payload", one.status === 200 && one.body.event?.payload?.data?.reference === ref, brief(one).slice(0, 200))
      check("events: detail for trust & safety (audit.view) is 200", (await get(`/api/webhooks/paystack/events/${success.id}`, { jar: ADM_TS })).status === 200)
      check("events: unknown event is 404", (await get(`/api/webhooks/paystack/events/pe_${RUN}x`, { jar: ADM_OWNER })).status === 404)
      check("replay: no session is 401", (await post(`/api/webhooks/paystack/events/${success.id}/replay`, undefined, { jar: new Jar() })).status === 401)
      check("replay: a shopper is 401", (await post(`/api/webhooks/paystack/events/${success.id}/replay`, undefined, { jar: S1 })).status === 401)
      check("replay: support (no audit.view) is 403", (await post(`/api/webhooks/paystack/events/${success.id}/replay`, undefined, { jar: ADM_SUP })).status === 403)
      check("replay: trust & safety (audit.view, not a money role) is 403", (await post(`/api/webhooks/paystack/events/${success.id}/replay`, undefined, { jar: ADM_TS })).status === 403)
      check("replay: unknown event is 404", (await post(`/api/webhooks/paystack/events/pe_${RUN}x/replay`, undefined, { jar: ADM_OWNER })).status === 404)
      const ledCount = async () => ((await get(`/api/admin/finance/ledger?brandId=${BRAND}&currency=NGN&limit=200`, { jar: ADM_OWNER })).body?.entries ?? []).filter((e) => JSON.stringify(e).includes(paidCo.orderIds[0])).length
      const ledBefore = await ledCount()
      const sBefore = await studioVariant("S")
      const rp = await post(`/api/webhooks/paystack/events/${success.id}/replay`, undefined, { jar: ADM_OWNER })
      const sAfter = await studioVariant("S")
      check("replay: owner replays → processed, attempts +1", rp.status === 200 && rp.body.result?.status === "processed" && rp.body.event?.attempts === success.attempts + 1, brief(rp))
      check("replay: replaying a processed charge moves no stock and keeps it paid", sAfter.onHand === sBefore.onHand && sAfter.held === sBefore.held && (await get(`/api/checkout/${paidCo.id}`, { jar: S1 })).body.status === "paid")
      const ledAfter = await ledCount()
      check("replay: the ledger capture isn't posted twice", ledBefore > 0 && ledAfter === ledBefore, `entries for order: ${ledBefore} → ${ledAfter}`)
    }
  }

  /* ===== Simulate (admin, dev + stub only) ===== */
  {
    const sim = (b, jar = ADM_OWNER) => post("/api/webhooks/paystack/simulate", b, { jar })
    check("simulate: no session is 401", (await post("/api/webhooks/paystack/simulate", { event: "transfer.success", data: {} }, { jar: new Jar() })).status === 401)
    check("simulate: a shopper is 401", (await sim({ event: "transfer.success", data: {} }, S1)).status === 401)
    check("simulate: support (no audit.view) is 403", (await sim({ event: "transfer.success", data: {} }, ADM_SUP)).status === 403)
    check("simulate: trust & safety is 403", (await sim({ event: "transfer.success", data: {} }, ADM_TS)).status === 403)
    check("simulate: unknown event type is 400", (await sim({ event: "charge.maybe", data: {} })).status === 400)
    check("simulate: missing data is 400", (await sim({ event: "transfer.success" })).status === 400)
    const tr = await sim({ event: "transfer.success", data: { reference: `${TAG}_tr`, transfer_code: `${TAG}_tc` } })
    check("simulate: an unknown transfer reference is stored and ignored", tr.status === 200 && tr.body.result?.status === "ignored" && tr.body.event?.source === "simulated", brief(tr))
    const rf = await sim({ event: "refund.processed", data: { id: `${TAG}_rf`, transaction_reference: `${TAG}_nope`, amount: 100 } })
    check("simulate: an unknown refund is ignored", rf.status === 200 && rf.body.result?.status === "ignored", brief(rf))
    // A second checkout completed through simulate.
    const s3c = created.s3second
    if (s3c) {
      const mismatch = await sim({ event: "charge.success", data: { reference: s3c.payment.reference, status: "success", amount: s3c.totalMinor + 1, currency: "NGN", id: `${TAG}_mm` } })
      const afterMm = await get(`/api/checkout/${s3c.id}`, { jar: S2 })
      check("simulate: a charge for the wrong amount puts the checkout in review, not paid", mismatch.status === 200 && afterMm.body?.status === "review" && afterMm.body.payment?.status === "review", `${brief(mismatch)} → ${afterMm.body?.status}`)
    }
    // A charge that lands after the checkout expired: payment captured, checkout stays expired with a
    // note, no stock committed, ORDERS refunds the cancelled order.
    const exp = created.expired
    if (exp?.payment) {
      const mBefore = await studioVariant("M")
      const late = await sim({ event: "charge.success", data: { reference: exp.payment.reference, status: "success", amount: exp.totalMinor, currency: "NGN", id: `${TAG}_late` } })
      const v = await get(`/api/checkout/${exp.id}`, { jar: S2 })
      const mAfter = await studioVariant("M")
      check("late: a charge after expiry is captured but the checkout stays expired with a note", late.status === 200 && late.body.result?.status === "processed" && v.body?.status === "expired" && v.body.payment?.status === "succeeded" && /refunded/.test(v.body.failureReason ?? ""), `${brief(late)} → ${JSON.stringify({ s: v.body?.status, p: v.body?.payment?.status, f: v.body?.failureReason })}`)
      check("late: no stock is committed for a late capture", mAfter.onHand === mBefore.onHand && mAfter.held === mBefore.held, `M ${mBefore.onHand}/${mBefore.held} → ${mAfter.onHand}/${mAfter.held}`)
      let lo
      for (let i = 0; i < 10; i++) {
        lo = await get(`/api/orders/${exp.orderIds[0]}`, { jar: S2 })
        if ((lo.body?.order ?? lo.body)?.states?.payment === "refunded") break
        await sleep(1000)
      }
      const lord = lo.body?.order ?? lo.body
      check("late: ORDERS refunds the late-paid order in full (never more)", lord?.states?.payment === "refunded" && lord.refundedMinor === exp.totalMinor, brief(lo).slice(0, 300))
    }
    // Fresh checkout for S2, paid through simulate with the right amount.
    await post("/api/cart/lines", { variantId: V.S, qty: 1 }, { jar: S2 })
    const c2 = await post("/api/checkout", body("sim"), { jar: S2 })
    check("simulate: S2 starts a checkout (201)", c2.status === 201, brief(c2))
    if (c2.status === 201) {
      const ok = await sim({ event: "charge.success", data: { reference: c2.body.payment.reference, status: "success", amount: c2.body.totalMinor, currency: "NGN", id: `${TAG}_s2` } })
      const v = await get(`/api/checkout/${c2.body.id}`, { jar: S2 })
      check("simulate: charge.success with the right amount → paid", ok.status === 200 && ok.body.result?.status === "processed" && v.body?.status === "paid", `${brief(ok)} → ${v.body?.status}`)
      created.s2paid = v.body
    }
  }

  /* ===== Event detail redacts card token + customer contact details ===== */
  {
    const authCode = `AUTH_${TAG}`
    const piiEmail = `${TAG}_buyer@example.com`
    const pii = await post(
      "/api/webhooks/paystack/simulate",
      {
        event: "charge.success",
        data: {
          reference: `${TAG}_pii`,
          id: `${TAG}_pii`,
          status: "success",
          amount: 100,
          currency: "NGN",
          authorization: { authorization_code: authCode, bin: "408408", last4: "4081", exp_month: "12", exp_year: "2030", card_type: "visa", bank: "TEST BANK", reusable: true, signature: `SIG_${TAG}` },
          customer: { id: 1, email: piiEmail, phone: "+2348000000000", first_name: "Kit", last_name: "Buyer", customer_code: `CUS_${TAG}` },
        },
      },
      { jar: ADM_OWNER },
    )
    check("redact: simulated charge with card + customer data is stored", pii.status === 200 && !!pii.body?.event?.id, brief(pii))
    if (pii.body?.event?.id) {
      for (const [who, jar] of [["trust & safety", ADM_TS], ["owner", ADM_OWNER]]) {
        const d = await get(`/api/webhooks/paystack/events/${pii.body.event.id}`, { jar })
        const text = JSON.stringify(d.body ?? {})
        check(`redact: event detail for ${who} withholds the reusable authorization_code and card signature`, d.status === 200 && !text.includes(authCode) && !text.includes(`SIG_${TAG}`) && !text.includes("408408"), text.slice(0, 300))
        check(`redact: event detail for ${who} withholds customer email / phone / names`, d.status === 200 && !text.includes(piiEmail) && !text.includes("+2348000000000") && !text.includes("Buyer"), text.slice(0, 300))
        check(`redact: event detail for ${who} keeps the reference and card last4`, d.body?.event?.payload?.data?.reference === `${TAG}_pii` && d.body.event.payload.data.authorization?.last4 === "4081", text.slice(0, 300))
      }
    }
  }

  /* ===== One live checkout per shopper: new keys don't stack stock holds ===== */
  {
    await del("/api/cart", { jar: S2 })
    const add = await post("/api/cart/lines", { variantId: V.S, qty: 2 }, { jar: S2 })
    check("stack: S2 puts 2 × S in the cart", add.status === 201 || add.status === 200, brief(add))
    const s0 = await studioVariant("S")
    const k1 = await post("/api/checkout", body("stack1"), { jar: S2 })
    check("stack: first checkout → 201 and holds 2", k1.status === 201 && (await studioVariant("S")).held === s0.held + 2, brief(k1))
    const k2 = await post("/api/checkout", body("stack2"), { jar: S2 })
    const s2 = await studioVariant("S")
    check("stack: a second checkout with a new key → 201", k2.status === 201 && k2.body?.id !== k1.body?.id, brief(k2))
    check("stack: the shopper's holds don't add up across checkouts (S held +2, not +4)", s2.held === s0.held + 2, `held ${s0.held} → ${s2.held}`)
    const k3 = await post("/api/checkout", body("stack3"), { jar: S2 })
    check("stack: a third key still holds only 2", k3.status === 201 && (await studioVariant("S")).held === s0.held + 2, brief(k3))
    if (k1.status === 201) {
      const old = await get(`/api/checkout/${k1.body.id}`, { jar: S2 })
      check("stack: the replaced checkout is expired with a reason, its payment abandoned", old.body?.status === "expired" && /newer checkout/.test(old.body.failureReason ?? "") && old.body.payment?.status === "abandoned", brief(old).slice(0, 300))
      const late = await post(`/api/checkout/${k1.body.id}/stub-pay`, { outcome: "success" }, { jar: S2 })
      check("stack: the replaced checkout can't be paid back to life", late.status === 200 && late.body.status === "expired", brief(late))
      const o = await get(`/api/orders/${k1.body.orderIds?.[0]}`, { jar: S2 })
      check("stack: ORDERS marks the replaced checkout's order payment failed", (o.body?.order ?? o.body)?.states?.payment === "failed", brief(o).slice(0, 300))
    }
    const retry = await post("/api/checkout", body("stack3"), { jar: S2 })
    check("stack: retrying the live checkout's key returns it (200) and replaces nothing", retry.status === 200 && retry.body.id === k3.body?.id && retry.body.status === "pending_payment", brief(retry))
    if (k3.status === 201) await post(`/api/checkout/${k3.body.id}/stub-expire`, undefined, { jar: S2 })
    check("stack: after expiry the holds are back to where they started", (await studioVariant("S")).held === s0.held)
    await del("/api/cart", { jar: S2 })
  }

  /* ===== Refund resend safety (unit: Paystack has no idempotency key on POST /refund) ===== */
  {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
    const tsx = path.join(root, "node_modules/.bin/tsx")
    const r = spawnSync(tsx, ["--test", "src/server/payments/refund-recovery.test.ts"], { cwd: root, encoding: "utf8", timeout: 120_000 })
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
    const oks = [...out.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)]
    check("refund-retry: unit tests ran", r.status !== null && oks.length >= 8, out.slice(-400))
    for (const m of oks) check(`refund-retry: ${m[2]}`, m[1] === "ok")
    // Wiring: submitRefund decides (lookup) before it can POST /refund again, and claims each attempt.
    const money = readFileSync(path.join(root, "src/server/payments/money.ts"), "utf8")
    const fn = money.slice(money.indexOf("export async function submitRefund"), money.indexOf("export async function retryRefunds"))
    check("refund-retry: submitRefund checks the provider before resending", fn.includes("decideResend(") && fn.indexOf("decideResend(") < fn.indexOf("provider.refund("))
    check("refund-retry: submitRefund claims the attempt atomically (attempts compare-and-set)", /eq\(refunds\.attempts, rf\.attempts\)/.test(fn) && fn.indexOf("if (!claimed) return") > 0)
    const events = readFileSync(path.join(root, "src/server/payments/events.ts"), "utf8")
    check("refund-retry: refund.pending/processing webhooks record the provider reference", events.includes("refundEventChange(") && events.includes('change.kind === "ref"'))
  }

  /* ===== Refunds through ORDERS → PAYMENTS.requestRefund ===== */
  if (paidCo) {
    const orderId = paidCo.orderIds[0]
    const so = await get(`/api/studio/orders/${orderId}`, { jar: OWNER })
    const total = so.body?.order?.totalMinor ?? so.body?.totalMinor ?? paidCo.totalMinor
    const refund = (b, jar = OWNER) => post(`/api/studio/orders/${orderId}/refunds`, b, { jar })
    // Brand refunds need a recent re-auth (demo brand sessions confirm with { demo: true } in development).
    const noRe = await refund({ amountMinor: 100, reason: TAG, idempotencyKey: key("rfre") })
    check("refund: without a recent re-auth → 403 fields.reauth=required", noRe.status === 403 && noRe.body?.error?.fields?.reauth === "required", brief(noRe))
    const ra = await post("/api/auth/reauth?as=brand", { demo: true }, { jar: OWNER })
    if (ra.status !== 200) throw new Error(`brand re-auth: ${brief(ra)}`)
    check("refund: a viewer can't refund (403)", (await refund({ amountMinor: 100, reason: TAG, idempotencyKey: key("rfv") }, VIEWER_B)).status === 403)
    check("refund: zero amount is 400/422", [400, 422].includes((await refund({ amountMinor: 0, reason: TAG, idempotencyKey: key("rf0") })).status))
    const over = await refund({ amountMinor: total + 1, reason: TAG, idempotencyKey: key("rfover") })
    check("refund: more than the order total is 422", over.status === 422, brief(over))
    const r1 = await refund({ amountMinor: 10_000, reason: TAG, idempotencyKey: key("rf1") })
    check("refund: partial refund succeeds (stub payment refunds at once)", [200, 201].includes(r1.status), brief(r1))
    const r1b = await refund({ amountMinor: 10_000, reason: TAG, idempotencyKey: key("rf1") })
    check("refund: same key again → same refund, no second refund", [200, 201].includes(r1b.status) && !!r1.body?.refundId && r1b.body?.refundId === r1.body.refundId, brief(r1b))
    const r1c = await refund({ amountMinor: 12_000, reason: TAG, idempotencyKey: key("rf1") })
    // (ORDERS issueRefund answers a reused key with the first refund without comparing the amount.)
    check("refund: same key with a different amount is refused (409/422)", [409, 422].includes(r1c.status), brief(r1c).slice(0, 160))
    check("refund: …and in any case no money moves for it", r1c.body?.refundId === undefined || r1c.body.refundId === r1.body?.refundId)
    const rest = await refund({ amountMinor: total - 10_000 + 1, reason: TAG, idempotencyKey: key("rf2") })
    check("refund: remainder + 1 is 422 (never more than paid)", rest.status === 422, brief(rest))
    const r2 = await refund({ amountMinor: total - 10_000, reason: TAG, idempotencyKey: key("rf3") })
    check("refund: the exact remainder succeeds", [200, 201].includes(r2.status), brief(r2))
    const one = await refund({ amountMinor: 1, reason: TAG, idempotencyKey: key("rf4") })
    check("refund: nothing left → 422", one.status === 422, brief(one))
    const od = await get(`/api/orders/${orderId}`, { jar: S1 })
    const ord = od.body?.order ?? od.body
    check("refund: order fully refunded, refundedMinor = total", ord?.states?.payment === "refunded" && ord.refundedMinor === total, brief(od).slice(0, 300))
  }
}

async function cleanup() {
  // Archive the product this run made in the seeded brand (tagged rows stay as history).
  try {
    const A = await demo("brand", "u_b_tobi", BRAND)
    for (const id of created.products) {
      const p = (await get(`/api/studio/catalog/products/${id}`, { cookie: A.cookie })).body?.product
      if (p && p.status !== "archived") await del(`/api/studio/catalog/products/${id}?expectedVersion=${p.version}`, { cookie: A.cookie })
    }
    for (const jar of created.shoppers ?? []) await del("/api/cart", { jar })
    const left = await get(`/api/studio/catalog/products?q=${TAG}&status=published`, { cookie: A.cookie })
    check("cleanup: no product of this run stays published", (left.body?.products ?? []).length === 0)
  } catch (e) {
    check("cleanup", false, String(e.message))
  }
}

async function run() {
  try {
    await main()
  } catch (e) {
    check("kit ran to the end", false, String(e?.stack ?? e).slice(0, 500))
  }
  await cleanup()
  return results
}

/** scripts/db-check.mjs entry: returns { status, name, detail } rows instead of printing. */
export default async function v3checkout(opts = {}) {
  if (opts.base) base = String(opts.base).replace(/\/$/, "")
  quiet = true
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
  console.log(`# ${passed} passed, ${failed} failed (run ${TAG})`)
  process.exit(failed ? 1 : 0)
}
