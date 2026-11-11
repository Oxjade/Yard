#!/usr/bin/env node
// ORDERS v3 live acceptance kit. Plain Node 22 (fetch, no deps). Prints one PASS/FAIL line per check
// and exits non-zero when any check fails.
//
//   node scripts/checks/v3-orders.mjs            (server at YARD_BASE, default http://localhost:3000)
//
// Needs a DEVELOPMENT server with the payment STUB active (no PAYSTACK_SECRET_KEY): demo sign-in,
// /api/checkout/{id}/stub-pay, /api/webhooks/paystack/simulate and the ORDERS dev helpers
// (/api/orders/dev: run a job / age a delivery, limited to orders of t_v3_ products; 404 in production).
//
// Test data: every record carries this run's tag. Shoppers are three fresh sign-ups owned by the
// run (see pickShoppers); their carts are emptied before each purchase. One product is created in the seeded brand Lagos Static (title/SKUs carry the tag) and archived at
// the end. Orders, refunds, returns and disputes made here all belong to those shoppers / that
// product. Seeded rows are only read, never changed.
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { deflateSync, crc32 } from "node:zlib"

let base = (process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TAG = `t_v3_orders_${RUN}`

let failed = 0
let passed = 0
let quiet = false
const results = []
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail !== "" && detail !== undefined && detail !== null ? (typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)) : ""
  results.push({ status: ok ? "PASS" : "FAIL", name, detail: ok ? "" : d })
  if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && d ? ` — ${d}` : ""}`)
  return !!ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ---------------- HTTP ---------------- */

const mergeCookies = (prev, res) => {
  const jar = new Map((prev ?? "").split("; ").filter(Boolean).map((c) => [c.split("=")[0], c]))
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const kv = c.split(";")[0]
    jar.set(kv.split("=")[0], kv)
  }
  return [...jar.values()].join("; ")
}

/** One request. 429s are waited out (Retry-After) unless noRetry; a restarting server is retried for ~2 min. */
async function api(method, path, { who, cookie, body, headers, raw, noRetry, noOrigin } = {}) {
  const ck = who?.cookie ?? cookie
  const h = { ...(noOrigin ? {} : { Origin: base, "X-Yard-Client": "1" }), ...(ck ? { cookie: ck } : {}), ...(headers ?? {}) }
  let payload
  if (raw !== undefined) payload = raw
  else if (body !== undefined) {
    h["Content-Type"] = "application/json"
    payload = JSON.stringify(body)
  }
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(`${base}${path}`, { method, headers: h, body: payload, redirect: "manual" })
    } catch (e) {
      if (attempt >= 12) throw e
      await sleep(10_000)
      continue
    }
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {}
    // Per-minute limits are waited out; a daily cap (Retry-After of hours) is reported as is.
    const retryAfter = Number(res.headers.get("retry-after") ?? 10) || 10
    if (res.status === 429 && !noRetry && attempt < 4 && retryAfter <= 90) {
      await sleep((retryAfter + 1) * 1000)
      continue
    }
    if (who && res.headers.getSetCookie?.().length) who.cookie = mergeCookies(who.cookie, res)
    return { status: res.status, body: json, text, headers: res.headers, res }
  }
}
const get = (p, o) => api("GET", p, o)
const post = (p, body, o = {}) => api("POST", p, { ...o, body })
const patch = (p, body, o = {}) => api("PATCH", p, { ...o, body })
const del = (p, o) => api("DELETE", p, o)
const brief = (r) => (r ? `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message} ${r.body.error.fields ? JSON.stringify(r.body.error.fields) : ""}` : (r.text ?? "").slice(0, 300)}` : "no response")

async function demo(actor, account, brandId) {
  const r = await post("/api/auth/demo", { actor, account, ...(brandId ? { brandId } : {}) })
  if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
  return { cookie: mergeCookies("", r.res), profile: r.body.profile, account }
}

/**
 * The kit's shoppers are fresh sign-ups owned by this run (t_v3_orders_<run>_s1/_s2/_s3), confirmed
 * through the link the stub email provider prints to the dev log. Shopper writes carry DAILY caps
 * per account (returns 10/day, cancels 20/day), so a rotating pool of seeded shoppers ran out after a
 * few runs a day. Sign-up mail is limited per client address, so the sign-ups send a per-run
 * X-Forwarded-For (the dev server trusts one proxy hop). Override with YARD_ORDERS_SHOPPERS=a,b,c
 * (seeded demo accounts) to reuse fixed shoppers.
 */
const DEV_LOG = process.env.YARD_DEV_LOG ?? "/tmp/claude-0/-home-user/e300ec86-35a4-5f82-b2d8-95972eccde0c/scratchpad/dev.log"
const KIT_IP = `10.${140 + Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
const KIT_PW = `Kit-orders-${RUN}-pw!`
async function signUpShopper(label) {
  const email = `${TAG}_${label}@example.com`
  const xff = { "X-Forwarded-For": KIT_IP }
  const r = await post("/api/auth/sign-up", { name: `Orders Kit ${label}`, email, password: KIT_PW }, { headers: xff })
  if (r.status !== 200) throw new Error(`sign-up ${label}: ${brief(r)}`)
  let token = null
  for (let i = 0; i < 40 && !token; i++) {
    try {
      const log = readFileSync(DEV_LOG, "utf8")
      const at = log.lastIndexOf(`to: ${email}`)
      if (at >= 0) token = /verify\?token=([\w-]+)/.exec(log.slice(at, at + 2000))?.[1] ?? null
    } catch {}
    if (!token) await sleep(1500)
  }
  if (!token) throw new Error(`no verification link for ${email} in ${DEV_LOG}`)
  const who = { cookie: "", account: email }
  const v = await post("/api/auth/verify-email/confirm", { token }, { who, headers: xff })
  if (v.status !== 200) throw new Error(`verify-email ${label}: ${brief(v)}`)
  if (!who.cookie) {
    const si = await post("/api/auth/sign-in", { actor: "shopper", email, password: KIT_PW }, { who, headers: xff })
    if (si.status !== 200) throw new Error(`sign-in ${label}: ${brief(si)}`)
  }
  return who
}
async function pickShoppers() {
  if (process.env.YARD_ORDERS_SHOPPERS) return Promise.all(process.env.YARD_ORDERS_SHOPPERS.split(",").map((a) => demo("shopper", a)))
  const out = []
  for (const label of ["s1", "s2", "s3"]) out.push(await signUpShopper(label))
  return out
}

/* ---------------- fixtures ---------------- */

function pngBytes() {
  const w = 96
  const hgt = 96
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
  ihdr.writeUInt32BE(hgt, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rows = []
  for (let y = 0; y < hgt; y++) {
    rows.push(Buffer.from([0]))
    for (let x = 0; x < w; x++) rows.push(Buffer.from([(x * 3) & 255, (y * 2) & 255, 77]))
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
}

async function uploadBrandImage(who) {
  const boundary = `----yardkit${RUN}`
  const bodyBuf = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}.png"\r\nContent-Type: image/png\r\n\r\n`),
    pngBytes(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return api("POST", `/api/uploads?purpose=social_post&as=brand`, { who, raw: bodyBuf, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(bodyBuf.length) } })
}

const created = { productId: null, productB: null }
const SHIP_TO = { name: "Orders Kit", line1: "12 Kit Street", city: "Lagos", country: "NG", phone: "+234 801 234 5678" }
let keyN = 0
const key = (label) => `${TAG}_${label}_${++keyN}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80)

/** Puts exactly `lines` in the shopper's cart, checks out, and (unless pay=false) pays with the stub. */
async function buy(who, lines, { pay = "success" } = {}) {
  await del("/api/cart", { who })
  for (const l of lines) {
    const a = await post("/api/cart/lines", { variantId: l.variantId, qty: l.qty }, { who })
    if (a.status >= 300) throw new Error(`cart add: ${brief(a)}`)
  }
  const cart = await get("/api/cart?currency=NGN&to=NG&city=Lagos", { who })
  if (cart.status !== 200) throw new Error(`cart: ${brief(cart)}`)
  const shipping = cart.body.groups.map((g) => {
    const opt = g.shipping?.options?.find((o) => o.available)
    if (!opt) throw new Error(`no delivery option for ${g.brandId}: ${JSON.stringify(g.shipping).slice(0, 200)}`)
    return { brandId: g.brandId, service: opt.service }
  })
  const co = await post("/api/checkout", { idempotencyKey: key("co"), currency: "NGN", shipTo: SHIP_TO, shipping }, { who })
  if (co.status !== 201) throw new Error(`checkout: ${brief(co)}`)
  const checkout = co.body.checkout ?? co.body
  if (pay) {
    const sp = await post(`/api/checkout/${checkout.id}/stub-pay`, { outcome: pay }, { who })
    if (sp.status !== 200) throw new Error(`stub-pay ${pay}: ${brief(sp)}`)
  }
  const after = await get(`/api/checkout/${checkout.id}`, { who })
  const view = after.body?.checkout ?? after.body
  return { checkout: view, orderId: view.orderIds?.[0], orderIds: view.orderIds ?? [] }
}

const shopperOrder = async (who, id) => (await get(`/api/orders/${id}`, { who })).body?.order
const studioOrder = async (who, id) => (await get(`/api/studio/orders/${id}`, { who })).body?.order
async function stockOf(variantId) {
  const r = await get(`/api/catalog/variants?ids=${variantId}`)
  return r.body?.variants?.find((v) => v.variantId === variantId)?.available ?? null
}
async function ship(brand, orderId, statuses) {
  for (const status of statuses) {
    const r = await post(`/api/studio/orders/${orderId}/shipment`, { status, ...(status === "shipped" ? { carrier: "GIG Logistics", trackingNumber: `KIT${RUN}`.slice(0, 20) } : {}) }, { who: brand })
    if (r.status !== 201) throw new Error(`shipment ${status} on ${orderId}: ${brief(r)}`)
  }
}
const devJob = (job, orderIds, at) => post("/api/orders/dev", { op: "run-job", job, orderIds, ...(at ? { at } : {}) })
const ageDelivery = (orderId, days) => post("/api/orders/dev", { op: "age-delivery", orderId, days })
const sumRefunds = (o) => (o?.refunds ?? []).filter((r) => r.status === "succeeded" || r.status === "pending").reduce((s, r) => s + r.amountMinor, 0)
const code = (r) => r?.body?.error?.code
/**
 * Brand money actions (refund, cancelling a paid order, receiving a return with its refund) need a
 * re-auth within 5 minutes. Demo brand sessions confirm with { demo: true } (development only).
 * Re-confirms when the last one is older than 3 minutes, so a long section never runs out.
 */
async function brandReauth(...whos) {
  for (const who of whos) {
    if (who.reauthAt && Date.now() - who.reauthAt < 180_000) continue
    const r = await post("/api/auth/reauth?as=brand", { demo: true }, { who })
    if (r.status !== 200) throw new Error(`brand re-auth ${who.account}: ${brief(r)}`)
    who.reauthAt = Date.now()
  }
}
const needsReauth = (r) => r?.status === 403 && r.body?.error?.fields?.reauth === "required"

/* ---------------- the kit ---------------- */

async function main() {
  if (!quiet) console.log(`# ORDERS v3 kit against ${base}, run ${TAG}`)

  /* ===== Sessions ===== */
  // Brand refunds and payout changes carry durable daily caps per account; the kits' demo brand
  // accounts share them across runs, so clear today's buckets first (dev-only op, those keys only).
  {
    const rc = await post("/api/orders/dev", { op: "reset-kit-daily-caps" })
    if (rc.status !== 200) throw new Error(`reset-kit-daily-caps: ${brief(rc)}`)
  }
  const TOBI = await demo("brand", "u_b_tobi", "b_lagos_static") // owner
  const KEMI = await demo("brand", "u_b_kemi", "b_lagos_static") // fulfilment
  const VIEWER = await demo("brand", "u_b_viewer", "b_lagos_static")
  const MINJI = await demo("brand", "u_b_minji", "b_null_form") // another brand's owner
  const ADM_OWNER = await demo("admin", "adm_1")
  const ADM_TS = await demo("admin", "adm_3") // shipping.view only
  const ADM_SUP = await demo("admin", "adm_5") // shipping.view + shipping.resolve
  const ADM_ADS = await demo("admin", "adm_4") // no shipping permission
  check("setup: roles are as the kit expects (tobi owner, kemi fulfilment, viewer)", TOBI.profile.role === "owner" && KEMI.profile.role === "fulfilment" && VIEWER.profile.role === "viewer", [TOBI.profile.role, KEMI.profile.role, VIEWER.profile.role])
  const [S1, S2, S3] = await pickShoppers()
  check("setup: three shopper sessions", !!S1?.cookie && !!S2?.cookie && !!S3?.cookie, [S1, S2, S3].map((x) => x?.account))
  if (!quiet) console.log(`# shoppers ${[S1, S2, S3].map((x) => x?.account).join(", ")}`)

  /* ===== Product ===== */
  const up = await uploadBrandImage(TOBI)
  const mediaId = up.body?.media?.id
  const cp = await post(
    "/api/studio/catalog/products",
    {
      title: `${TAG} Tee`,
      description: "ORDERS kit product.",
      categorySlug: "fashion",
      priceMinor: 10_000,
      options: [{ name: "Size", values: [{ value: "S" }, { value: "M" }] }],
      variants: [
        { sku: `${TAG}-S`, options: { Size: "S" }, initialStock: 60 },
        { sku: `${TAG}-M`, options: { Size: "M" }, initialStock: 60 },
      ],
      images: mediaId ? [{ mediaId, alt: "kit" }] : [],
    },
    { who: TOBI },
  )
  const P = cp.body?.product
  if (P) created.productId = P.id
  const pub = P ? await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: P.version }, { who: TOBI }) : null
  check("setup: kit product created and published in Lagos Static", cp.status === 201 && pub?.status === 200, `${brief(cp).slice(0, 150)} / ${brief(pub).slice(0, 150)}`)
  if (!P || pub?.status !== 200) throw new Error("no product to sell")
  const vS = P.variants.find((v) => v.options?.Size === "S")?.id ?? P.variants[0].id
  const vM = P.variants.find((v) => v.options?.Size === "M")?.id ?? P.variants[1].id

  /* ===== Auth required ===== */
  {
    const fake = "or_doesnotexist"
    const anon = [
      ["GET /api/orders", () => get("/api/orders")],
      ["GET /api/orders/{id}", () => get(`/api/orders/${fake}`)],
      ["POST cancel", () => post(`/api/orders/${fake}/cancel`, { idempotencyKey: key("x") })],
      ["POST returns", () => post(`/api/orders/${fake}/returns`, { reason: "other", idempotencyKey: key("x") })],
      ["POST return cancel", () => post(`/api/orders/${fake}/returns/rt_x/cancel`, {})],
      ["GET checkout receipt", () => get(`/api/orders/checkouts/co_x`)],
      ["GET studio list", () => get("/api/studio/orders")],
      ["GET studio detail", () => get(`/api/studio/orders/${fake}`)],
      ["POST studio refund", () => post(`/api/studio/orders/${fake}/refunds`, { amountMinor: 1, reason: "test", idempotencyKey: key("x") })],
      ["GET admin order", () => get(`/api/orders/admin/${fake}`)],
      ["POST admin refund", () => post(`/api/orders/admin/${fake}/refunds`, { amountMinor: 1, reason: "test", idempotencyKey: key("x") })],
      ["GET admin disputes", () => get(`/api/orders/admin/disputes`)],
    ]
    const res = []
    for (const [n, f] of anon) res.push([n, (await f()).status])
    check("auth: every ORDERS route answers 401 without a session", res.every(([, s]) => s === 401), res.filter(([, s]) => s !== 401))
    check("auth: a brand session can't read shopper orders (401)", (await get("/api/orders", { who: TOBI })).status === 401)
    check("auth: a shopper session can't read Studio orders (401)", (await get("/api/studio/orders", { who: S1 })).status === 401)
    check("auth: a brand session can't use admin order routes (401)", (await get(`/api/orders/admin/disputes`, { who: TOBI })).status === 401)
    check("auth: an admin without shipping permissions is refused (403)", (await get(`/api/orders/admin/disputes`, { who: ADM_ADS })).status === 403)
    const noOrigin = await api("POST", `/api/orders/${fake}/cancel`, { who: S1, body: { idempotencyKey: key("x") }, noOrigin: true })
    check("auth: a mutation without Origin / X-Yard-Client is refused (403)", noOrigin.status === 403, brief(noOrigin))
  }

  /* ===== Concurrent refunds never exceed the total (first, while the brand's refund rate budget is fresh) ===== */
  {
    const O = await buy(S1, [{ variantId: vS, qty: 1 }])
    const before = await studioOrder(TOBI, O.orderId)
    const T = before?.totalMinor ?? 0
    const amt = Math.floor(T * 0.4)
    await post("/api/auth/reauth?as=admin", { demo: true }, { who: ADM_SUP })
    await brandReauth(TOBI)
    const fire = (i) =>
      i % 2 === 0
        ? post(`/api/studio/orders/${O.orderId}/refunds`, { amountMinor: amt, reason: "parallel goodwill", idempotencyKey: key(`par${i}`) }, { who: TOBI, noRetry: true })
        : post(`/api/orders/admin/${O.orderId}/refunds`, { amountMinor: amt, reason: "parallel platform", idempotencyKey: key(`par${i}`) }, { who: ADM_SUP, noRetry: true })
    const rs = await Promise.all([0, 1, 2, 3, 4, 5].map(fire))
    const ok = rs.filter((r) => r.status === 201).length
    const refused = rs.filter((r) => r.status === 422).length
    const after = await studioOrder(TOBI, O.orderId)
    check("refund concurrency: 6 parallel 40% refunds (brand + admin) → exactly 2 succeed, the rest 422", ok === 2 && refused === 4, rs.map((r) => brief(r).slice(0, 80)))
    check("refund concurrency: recorded refunds never exceed the order total", sumRefunds(after) <= T && (after?.refundedMinor ?? 0) <= T && sumRefunds(after) === ok * amt, { T, sum: sumRefunds(after), refunded: after?.refundedMinor })
    check("refund concurrency: payment state partially_refunded, refundable = total − refunds", after?.states?.payment === "partially_refunded" && after?.refundableMinor === T - ok * amt, { states: after?.states, refundable: after?.refundableMinor })
  }

  /* ===== O1: list, detail, actions, receipt, tenancy, refunds ===== */
  const O1 = await buy(S1, [{ variantId: vS, qty: 2 }, { variantId: vM, qty: 1 }])
  check("setup: paid order via cart + checkout + stub-pay", O1.checkout?.status === "paid" && !!O1.orderId, JSON.stringify(O1.checkout).slice(0, 300))
  {
    const d = await shopperOrder(S1, O1.orderId)
    check("shopper detail: own order 200 with payment paid / fulfilment unfulfilled / return none / dispute none", d?.states?.payment === "paid" && d.states.fulfilment === "unfulfilled" && d.states.return === "none" && d.states.dispute === "none" && d.states.merchant === "paid", d?.states)
    check("shopper detail: lines from checkout (2×S + 1×M at 10,000) and totals add up", d?.lines?.length === 2 && d.lines.find((l) => l.variantId === vS)?.qty === 2 && d.lines.every((l) => l.unitMinor === 10_000) && d.subtotalMinor === 30_000 && d.totalMinor === d.subtotalMinor + d.shippingMinor, { lines: d?.lines, sub: d?.subtotalMinor, ship: d?.shippingMinor, total: d?.totalMinor })
    check("shopper detail: actions — can cancel, can't return yet, no window", d?.actions?.canCancel === true && d.actions.canRequestReturn === false && d.actions.returnWindowEndsAt === null, d?.actions)
    check("shopper detail: refundableMinor = total, paidAt set, checkoutId set", d?.refundableMinor === d?.totalMinor && !!d?.paidAt && d?.checkoutId === O1.checkout.id, { r: d?.refundableMinor, paidAt: d?.paidAt, co: d?.checkoutId })
    check("shopper detail: timeline has order.placed then payment.captured (ids/amounts only)", d?.timeline?.[0]?.kind === "order.placed" && d.timeline.some((e) => e.kind === "payment.captured"), d?.timeline?.map((e) => e.kind))
    check("shopper detail: shipTo is the checkout address; disputes hidden from shoppers", d?.shipTo?.country === "NG" && d.shipTo.city === "Lagos" && Array.isArray(d.disputes) && d.disputes.length === 0, d?.shipTo)
    check("shopper detail: delivery view from shipping is attached", d?.delivery !== undefined && d?.delivery !== null, typeof d?.delivery)

    check("shopper detail: another shopper's order is 404", (await get(`/api/orders/${O1.orderId}`, { who: S2 })).status === 404)
    check("shopper detail: unknown id is 404", (await get(`/api/orders/or_${RUN}_none`, { who: S1 })).status === 404)
    check("shopper detail: unsafe id in path is 404", (await get(`/api/orders/a.b`, { who: S1 })).status === 404)

    const l1 = await get("/api/orders?limit=50", { who: S1 })
    const l2 = await get("/api/orders?limit=50", { who: S2 })
    check("shopper list: own orders only (S1 sees O1, S2 doesn't)", l1.status === 200 && l1.body.items.some((o) => o.id === O1.orderId) && !l2.body?.items?.some((o) => o.id === O1.orderId), brief(l1).slice(0, 120))
    check("shopper list: summaries carry states and integer money", l1.body?.items?.every((o) => o.states && Number.isInteger(o.totalMinor) && o.brand?.id), "")
    const p1 = await get("/api/orders?limit=1", { who: S1 })
    const p2 = p1.body?.nextCursor ? await get(`/api/orders?limit=1&before=${encodeURIComponent(p1.body.nextCursor)}`, { who: S1 }) : null
    check("shopper list: limit + before cursor pages without repeats", p1.body?.items?.length === 1 && !!p2 && p2.status === 200 && p2.body.items.length === 1 && p2.body.items[0].id !== p1.body.items[0].id, `${brief(p1).slice(0, 100)} | ${brief(p2).slice(0, 100)}`)
    check("shopper list: next cursor includes the order-ID tie-breaker", typeof p1.body?.nextCursor === "string" && p1.body.nextCursor.includes("|"), p1.body?.nextCursor)
    check("shopper list: limit=0 is 400, before=garbage is 400", (await get("/api/orders?limit=0", { who: S1 })).status === 400 && (await get("/api/orders?before=yesterday", { who: S1 })).status === 400)

    const rc = await get(`/api/orders/checkouts/${O1.checkout.id}`, { who: S1 })
    check("receipt: checkout's orders for its shopper", rc.status === 200 && rc.body.items.length === 1 && rc.body.items[0].id === O1.orderId, brief(rc).slice(0, 160))
    check("receipt: another shopper's checkout is 404", (await get(`/api/orders/checkouts/${O1.checkout.id}`, { who: S2 })).status === 404)

    const sl = await get("/api/studio/orders?limit=100", { who: TOBI })
    check("studio list: the brand sees the order", sl.status === 200 && sl.body.items.some((o) => o.id === O1.orderId), brief(sl).slice(0, 120))
    const sp1 = await get("/api/studio/orders?limit=1", { who: TOBI })
    const sp2 = sp1.body?.nextCursor ? await get(`/api/studio/orders?limit=1&before=${encodeURIComponent(sp1.body.nextCursor)}`, { who: TOBI }) : null
    check("studio list: stable keyset cursor pages without repeats", typeof sp1.body?.nextCursor === "string" && sp1.body.nextCursor.includes("|") && !!sp2 && sp2.status === 200 && sp2.body.items.length === 1 && sp2.body.items[0].id !== sp1.body.items[0].id, `${brief(sp1).slice(0, 100)} | ${brief(sp2).slice(0, 100)}`)
    check("studio list: filters payment=paid and q=reference find it", (await get(`/api/studio/orders?payment=paid&q=${encodeURIComponent(d.reference)}`, { who: TOBI })).body?.items?.some((o) => o.id === O1.orderId))
    check("studio list: filter payment=refunded excludes it; bad filter is 400", !(await get(`/api/studio/orders?payment=refunded&q=${encodeURIComponent(d.reference)}`, { who: TOBI })).body?.items?.some((o) => o.id === O1.orderId) && (await get(`/api/studio/orders?payment=bogus`, { who: TOBI })).status === 400)
    check("studio tenancy: another brand's list never contains it", !(await get(`/api/studio/orders?limit=100&q=${encodeURIComponent(d.reference)}`, { who: MINJI })).body?.items?.some((o) => o.id === O1.orderId))
    check("studio tenancy: another brand's detail is 404", (await get(`/api/studio/orders/${O1.orderId}`, { who: MINJI })).status === 404)
    const vd = await get(`/api/studio/orders/${O1.orderId}`, { who: VIEWER })
    check("studio detail: any member (viewer) may read; brand sees the address", vd.status === 200 && vd.body.order.shipTo?.line1 === SHIP_TO.line1, brief(vd).slice(0, 120))
    check("admin detail: shipping.view admin reads any order; no-permission admin 403", (await get(`/api/orders/admin/${O1.orderId}`, { who: ADM_TS })).status === 200 && (await get(`/api/orders/admin/${O1.orderId}`, { who: ADM_ADS })).status === 403)

    // Refund validation and roles
    await brandReauth(TOBI, MINJI)
    const R = (b, who = TOBI) => post(`/api/studio/orders/${O1.orderId}/refunds`, b, { who })
    const v = [
      ["amount 0", { amountMinor: 0, reason: "goodwill", idempotencyKey: key("v") }],
      ["fractional amount", { amountMinor: 10.5, reason: "goodwill", idempotencyKey: key("v") }],
      ["no idempotency key", { amountMinor: 100, reason: "goodwill" }],
      ["short key", { amountMinor: 100, reason: "goodwill", idempotencyKey: "abc" }],
      ["short reason", { amountMinor: 100, reason: "x", idempotencyKey: key("v") }],
      ["extra field (status)", { amountMinor: 100, reason: "goodwill", idempotencyKey: key("v"), status: "succeeded" }],
    ]
    const vr = []
    for (const [n, b] of v) vr.push([n, (await R(b)).status])
    check("refund validation: bad bodies are 400", vr.every(([, s]) => s === 400), vr)
    check("refund roles: fulfilment member (orders.fulfil, not owner/admin) is 403", (await R({ amountMinor: 100, reason: "goodwill", idempotencyKey: key("v") }, KEMI)).status === 403)
    check("refund roles: viewer is 403", (await R({ amountMinor: 100, reason: "goodwill", idempotencyKey: key("v") }, VIEWER)).status === 403)
    check("refund tenancy: another brand's owner gets 404", (await R({ amountMinor: 100, reason: "goodwill", idempotencyKey: key("v") }, MINJI)).status === 404)
    const T = d.totalMinor

    const k1 = key("partial")
    const r1 = await R({ amountMinor: 5_000, reason: "goodwill partial", idempotencyKey: k1 })
    check("refund partial: 201 succeeded (stub provider)", r1.status === 201 && r1.body.status === "succeeded" && r1.body.duplicate === false, brief(r1).slice(0, 200))
    const r1b = await R({ amountMinor: 5_000, reason: "goodwill partial", idempotencyKey: k1 })
    check("refund idempotency: same key → 200 duplicate, same refund id", r1b.status === 200 && r1b.body.duplicate === true && r1b.body.refundId === r1.body.refundId, brief(r1b).slice(0, 200))
    const k2 = key("samekey")
    const par = await Promise.all([1, 2, 3].map(() => R({ amountMinor: 1_000, reason: "same key in parallel", idempotencyKey: k2 })))
    const afterPar = await studioOrder(TOBI, O1.orderId)
    check(
      "refund idempotency: same key fired 3× in parallel → one refund",
      par.every((r) => r.status === 200 || r.status === 201) && new Set(par.map((r) => r.body?.refundId)).size === 1 && afterPar.refunds.length === 2,
      { statuses: par.map((r) => brief(r).slice(0, 80)), refunds: afterPar?.refunds?.length },
    )
    check("refund partial: refundedMinor 6,000, payment partially_refunded, refundable shrinks", afterPar.refundedMinor === 6_000 && afterPar.states.payment === "partially_refunded" && afterPar.refundableMinor === T - 6_000, { refunded: afterPar.refundedMinor, states: afterPar.states, refundable: afterPar.refundableMinor })
    const over = await R({ amountMinor: T - 6_000 + 1, reason: "too much", idempotencyKey: key("over") })
    check("refund cap: over-refund by one minor unit is 422", over.status === 422, brief(over))
    const full = await R({ amountMinor: T - 6_000, reason: "the rest", idempotencyKey: key("rest") })
    const dFull = await shopperOrder(S1, O1.orderId)
    check("refund full: remaining amount → payment refunded, merchant refunded, refundable 0", full.status === 201 && dFull.states.payment === "refunded" && dFull.refundedMinor === T && dFull.refundableMinor === 0 && dFull.states.merchant === "refunded", { s: brief(full).slice(0, 100), states: dFull?.states, refunded: dFull?.refundedMinor })
    const more = await R({ amountMinor: 1, reason: "one more", idempotencyKey: key("more") })
    check("refund cap: anything after a full refund is 422", more.status === 422, brief(more))
    check("refund: timeline has refund.requested + refund.succeeded for each", dFull.timeline.filter((e) => e.kind === "refund.succeeded").length === 3 && dFull.timeline.filter((e) => e.kind === "refund.requested").length === 3, dFull.timeline.map((e) => e.kind))
    const cancelRefunded = await post(`/api/orders/${O1.orderId}/cancel`, { idempotencyKey: key("c") }, { who: S1 })
    check("cancel: a fully refunded order can't be cancelled (422) and actions say so", cancelRefunded.status === 422 && dFull.actions.canCancel === false, brief(cancelRefunded))
  }

  /* ===== Admin refund + re-auth ===== */
  {
    const O = await buy(S2, [{ variantId: vM, qty: 1 }])
    const fresh = await demo("admin", "adm_5")
    const body = () => ({ amountMinor: 1_500, reason: "delivery issue", idempotencyKey: key("adm") })
    const noReauth = await post(`/api/orders/admin/${O.orderId}/refunds`, body(), { who: fresh })
    check("admin refund: without a recent re-auth → 403 fields.reauth=required", noReauth.status === 403 && noReauth.body?.error?.fields?.reauth === "required", brief(noReauth))
    check("admin refund: shipping.view-only admin is 403", (await post(`/api/orders/admin/${O.orderId}/refunds`, body(), { who: ADM_TS })).status === 403)
    const ra = await post("/api/auth/reauth?as=admin", { demo: true }, { who: fresh })
    check("admin refund: demo re-auth (development) ok", ra.status === 200, brief(ra))
    const ok = await post(`/api/orders/admin/${O.orderId}/refunds`, body(), { who: fresh })
    check("admin refund: after re-auth → 201 platform refund", ok.status === 201 && ok.body.order?.refunds?.[0]?.kind === "platform" && ok.body.order.refundedMinor === 1_500, brief(ok).slice(0, 200))
    const bad = await post(`/api/orders/admin/${O.orderId}/refunds`, { amountMinor: 10 ** 12 + 1, reason: "x", idempotencyKey: key("adm") }, { who: fresh })
    check("admin refund: validation 400", bad.status === 400, brief(bad))
    const overA = await post(`/api/orders/admin/${O.orderId}/refunds`, { amountMinor: ok.body.order.totalMinor, reason: "too much", idempotencyKey: key("adm") }, { who: fresh })
    check("admin refund: over-refund 422", overA.status === 422, brief(overA))
  }

  /* ===== Brand money actions need a recent re-auth (password; demo confirm in development) ===== */
  {
    // Fresh sessions: signing in doesn't count as a re-auth, so their first money action is refused.
    const owner = await demo("brand", "u_b_tobi", "b_lagos_static")
    const staff = await demo("brand", "u_b_kemi", "b_lagos_static")
    const O = await buy(S3, [{ variantId: vS, qty: 1 }])
    const refundPath = `/api/studio/orders/${O.orderId}/refunds`
    const body = { amountMinor: 1_000, reason: "goodwill after reauth", idempotencyKey: key("rr") }
    const no = await post(refundPath, body, { who: owner })
    check("brand refund reauth: owner without a recent re-auth → 403 fields.reauth=required", needsReauth(no), brief(no))
    const d0 = await studioOrder(owner, O.orderId)
    check("brand refund reauth: the refused refund recorded nothing", d0?.refunds?.length === 0 && d0.refundedMinor === 0 && d0.states.payment === "paid", { refunds: d0?.refunds, states: d0?.states })
    const role = await post(refundPath, { ...body, idempotencyKey: key("rr") }, { who: staff })
    check("brand refund reauth: a fulfilment member is still refused by role (403, not a re-auth ask)", role.status === 403 && !needsReauth(role), brief(role))
    const wrong = await post("/api/auth/reauth?as=brand", { password: "not-the-demo-way" }, { who: owner })
    check("brand refund reauth: a demo session can't confirm with a password (422)", wrong.status === 422, brief(wrong))
    const ra = await post("/api/auth/reauth?as=brand", { demo: true }, { who: owner })
    check("brand refund reauth: demo re-auth as brand (development) → 200", ra.status === 200 && ra.body?.ok === true, brief(ra))
    const ok = await post(refundPath, body, { who: owner })
    check("brand refund reauth: retry with the SAME Idempotency-Key after re-auth → 201 succeeded", ok.status === 201 && ok.body.status === "succeeded" && ok.body.duplicate === false && ok.body.order?.refundedMinor === 1_000, brief(ok).slice(0, 200))
    const dup = await post(refundPath, body, { who: owner })
    check("brand refund reauth: the same key again → 200 duplicate, one refund", dup.status === 200 && dup.body.duplicate === true && dup.body.refundId === ok.body.refundId && dup.body.order?.refunds?.length === 1, brief(dup).slice(0, 200))

    // Cancel: an unpaid order refunds nothing, so no password; a paid one is a refund, so it asks.
    const U = await buy(S3, [{ variantId: vS, qty: 1 }], { pay: null })
    const cu = await post(`/api/studio/orders/${U.orderId}/cancel`, { reason: "Out of stock", idempotencyKey: key("rcu") }, { who: staff })
    check("brand cancel reauth: an unpaid order cancels without a re-auth (200, no refund)", cu.status === 200 && cu.body.order?.states?.fulfilment === "cancelled" && cu.body.order.refunds.length === 0, brief(cu).slice(0, 200))
    const P = await buy(S3, [{ variantId: vS, qty: 1 }])
    const ck = key("rcp")
    const cancel = () => post(`/api/studio/orders/${P.orderId}/cancel`, { reason: "Out of stock", idempotencyKey: ck }, { who: staff })
    const c1 = await cancel()
    const dp = await studioOrder(owner, P.orderId)
    check("brand cancel reauth: a paid order without a recent re-auth → 403 fields.reauth=required, order untouched", needsReauth(c1) && dp?.states?.fulfilment === "unfulfilled" && dp.states.payment === "paid" && dp.refunds.length === 0, { c1: brief(c1), states: dp?.states })
    const rs = await post("/api/auth/reauth?as=brand", { demo: true }, { who: staff })
    const c2 = await cancel()
    check("brand cancel reauth: after re-auth the same key cancels and refunds in full", rs.status === 200 && c2.status === 200 && c2.body.order?.states?.fulfilment === "cancelled" && c2.body.order.states.payment === "refunded" && c2.body.order.refunds.length === 1, brief(c2).slice(0, 200))
    const c3 = await cancel()
    check("brand cancel reauth: the same key again → alreadyCancelled, still one refund", c3.status === 200 && c3.body.alreadyCancelled === true && c3.body.order?.refunds?.length === 1, brief(c3).slice(0, 200))
  }

  /* ===== O2: shopper cancel before dispatch (refund + restock, idempotent) ===== */
  {
    const s0 = await stockOf(vS)
    const O = await buy(S1, [{ variantId: vS, qty: 3 }])
    const s1 = await stockOf(vS)
    check("cancel setup: paying took 3 from stock", s0 !== null && s1 === s0 - 3, { s0, s1 })
    check("cancel: missing idempotency key is 400", (await post(`/api/orders/${O.orderId}/cancel`, {}, { who: S1 })).status === 400)
    check("cancel: unknown field is 400", (await post(`/api/orders/${O.orderId}/cancel`, { idempotencyKey: key("c"), refund: false }, { who: S1 })).status === 400)
    check("cancel: another shopper gets 404", (await post(`/api/orders/${O.orderId}/cancel`, { idempotencyKey: key("c") }, { who: S2 })).status === 404)
    const c = await post(`/api/orders/${O.orderId}/cancel`, { idempotencyKey: key("c"), reason: "Changed my mind" }, { who: S1 })
    const d = c.body?.order
    check("cancel: 200, fulfilment cancelled, payment refunded in full", c.status === 200 && d?.states?.fulfilment === "cancelled" && d.states.payment === "refunded" && d.refundedMinor === d.totalMinor && d.states.merchant === "cancelled", { s: brief(c).slice(0, 120), states: d?.states })
    check("cancel: one cancellation refund (succeeded) for the full total", d?.refunds?.length === 1 && d.refunds[0].kind === "cancellation" && d.refunds[0].status === "succeeded" && d.refunds[0].amountMinor === d.totalMinor, d?.refunds)
    check("cancel: units restocked and recorded on the lines", (await stockOf(vS)) === s0 && d?.lines?.[0]?.restockedQty === 3, { now: await stockOf(vS), s0, lines: d?.lines })
    const again = await post(`/api/orders/${O.orderId}/cancel`, { idempotencyKey: key("c") }, { who: S1 })
    const d2 = again.body?.order
    check("cancel: cancelling again → 200 alreadyCancelled, no second refund, no second restock", again.status === 200 && again.body.alreadyCancelled === true && d2.refunds.length === 1 && (await stockOf(vS)) === s0, brief(again).slice(0, 160))
    check("cancel: actions after cancel — nothing allowed", d2?.actions?.canCancel === false && d2.actions.canRequestReturn === false, d2?.actions)
    check("studio list: fulfilment=cancelled filter finds it", (await get(`/api/studio/orders?fulfilment=cancelled&q=${encodeURIComponent(d2.reference)}`, { who: TOBI })).body?.items?.some((o) => o.id === O.orderId))
    await brandReauth(TOBI)
    const late = await post(`/api/studio/orders/${O.orderId}/refunds`, { amountMinor: 100, reason: "after cancel", idempotencyKey: key("x") }, { who: TOBI })
    check("cancel: a refund after the full cancellation refund is 422", late.status === 422, brief(late))
  }

  /* ===== O3: brand cancel ===== */
  {
    const s0 = await stockOf(vM)
    const O = await buy(S2, [{ variantId: vM, qty: 2 }])
    await brandReauth(KEMI)
    const B = (b, who) => post(`/api/studio/orders/${O.orderId}/cancel`, b, { who })
    check("brand cancel: reason under 3 chars is 400", (await B({ reason: "x", idempotencyKey: key("bc") }, KEMI)).status === 400)
    check("brand cancel: viewer is 403", (await B({ reason: "Out of stock", idempotencyKey: key("bc") }, VIEWER)).status === 403)
    check("brand cancel: another brand is 404", (await B({ reason: "Out of stock", idempotencyKey: key("bc") }, MINJI)).status === 404)
    const c = await B({ reason: "Damaged in the studio", restock: false, idempotencyKey: key("bc") }, KEMI)
    const d = c.body?.order
    check("brand cancel: fulfilment member cancels a paid order → refunded, cancelReason kept", c.status === 200 && d?.states?.fulfilment === "cancelled" && d.states.payment === "refunded" && d.cancelReason === "Damaged in the studio", brief(c).slice(0, 200))
    check("brand cancel: restock=false leaves stock as sold", (await stockOf(vM)) === s0 - 2 && d?.lines?.[0]?.restockedQty === 0, { now: await stockOf(vM), s0 })
    const sd = await shopperOrder(S2, O.orderId)
    check("brand cancel: shopper sees cancelled + refunded", sd?.states?.fulfilment === "cancelled" && sd.states.payment === "refunded")
  }

  /* ===== Unpaid orders ===== */
  {
    const F = await buy(S2, [{ variantId: vS, qty: 1 }], { pay: "failed" })
    const d = await shopperOrder(S2, F.orderId)
    check("payment failed: order payment failed, fulfilment cancelled, no actions", d?.states?.payment === "failed" && d.states.fulfilment === "cancelled" && d.actions.canCancel === false && d.refundableMinor === 0, d?.states)
    await brandReauth(TOBI)
    const r = await post(`/api/studio/orders/${F.orderId}/refunds`, { amountMinor: 100, reason: "nothing paid", idempotencyKey: key("x") }, { who: TOBI })
    check("payment failed: refunding an unpaid order is 422", r.status === 422, brief(r))

    const s0 = await stockOf(vS)
    const U = await buy(S2, [{ variantId: vS, qty: 2 }], { pay: null })
    const du = await shopperOrder(S2, U.orderId)
    check("unpaid: pending order shows payment pending and can be cancelled", du?.states?.payment === "pending" && du.actions.canCancel === true, { states: du?.states, actions: du?.actions })
    const c = await post(`/api/orders/${U.orderId}/cancel`, { idempotencyKey: key("uc") }, { who: S2 })
    check("unpaid: cancel → cancelled with no refund", c.status === 200 && c.body.order.states.fulfilment === "cancelled" && c.body.order.refunds.length === 0 && c.body.refundId === null, brief(c).slice(0, 200))
    const late = await post(`/api/checkout/${U.checkout.id}/stub-pay`, { outcome: "success" }, { who: S2 })
    let dl = null
    for (let i = 0; i < 10; i++) {
      dl = await shopperOrder(S2, U.orderId)
      if (dl?.states?.payment === "refunded") break
      await sleep(1000)
    }
    check("late payment on a cancelled order: marked paid then refunded in full automatically", late.status === 200 && dl?.states?.payment === "refunded" && dl.refunds.length === 1 && dl.refunds[0].kind === "cancellation", { pay: brief(late).slice(0, 120), states: dl?.states, refunds: dl?.refunds })
    check("late payment on a cancelled order: stock ends where it started", (await stockOf(vS)) === s0, { now: await stockOf(vS), s0 })
  }

  /* ===== O4: returns — request / cancel / brand reject / admin override / receive ===== */
  {
    const s0 = await stockOf(vS)
    const O = await buy(S1, [{ variantId: vS, qty: 2 }, { variantId: vM, qty: 1 }])
    const RET = (b, who = S1) => post(`/api/orders/${O.orderId}/returns`, b, { who })
    const early = await RET({ reason: "too_small", idempotencyKey: key("r") })
    check("returns: before delivery → 422", early.status === 422, brief(early))
    await ship(TOBI, O.orderId, ["shipped"])
    const cShipped = await post(`/api/orders/${O.orderId}/cancel`, { idempotencyKey: key("c") }, { who: S1 })
    check("cancel: after dispatch → 422, actions.canCancel false", cShipped.status === 422 && (await shopperOrder(S1, O.orderId))?.actions?.canCancel === false, brief(cShipped))
    await brandReauth(TOBI)
    check("brand cancel: after dispatch → 422", (await post(`/api/studio/orders/${O.orderId}/cancel`, { reason: "Too late now", idempotencyKey: key("bc") }, { who: TOBI })).status === 422)
    await ship(TOBI, O.orderId, ["delivered"])
    const d0 = await shopperOrder(S1, O.orderId)
    const winMs = d0?.actions?.returnWindowEndsAt ? Date.parse(d0.actions.returnWindowEndsAt) - Date.now() : 0
    check("returns: delivered → fulfilment delivered, canRequestReturn, window ≈ 7 days", d0?.states?.fulfilment === "delivered" && d0.actions.canRequestReturn === true && winMs > 6.9 * 86_400_000 && winMs <= 7 * 86_400_000 + 60_000, { states: d0?.states, actions: d0?.actions })

    const bad = [
      ["unknown reason", { reason: "meh", idempotencyKey: key("r") }],
      ["no key", { reason: "too_small" }],
      ["qty 0", { reason: "too_small", lines: [{ variantId: vS, qty: 0 }], idempotencyKey: key("r") }],
      ["empty lines", { reason: "too_small", lines: [], idempotencyKey: key("r") }],
    ]
    const br = []
    // Body validation runs before the order is looked up, so a third shopper spends their daily return budget on these.
    for (const [n, b] of bad) br.push([n, (await RET(b, S3)).status])
    check("returns validation: bad bodies 400", br.every(([, s]) => s === 400), br)
    const notOn = await RET({ reason: "too_small", lines: [{ variantId: `pv_${RUN}`, qty: 1 }], idempotencyKey: key("r") })
    check("returns: a variant not on the order → 422", notOn.status === 422, brief(notOn))
    const tooMany = await RET({ reason: "too_small", lines: [{ variantId: vS, qty: 3 }], idempotencyKey: key("r") })
    check("returns: more than bought → 422", tooMany.status === 422, brief(tooMany))
    const dupLine = await RET({ reason: "too_small", lines: [{ variantId: vS, qty: 1 }, { variantId: vS, qty: 1 }], idempotencyKey: key("r") })
    check("returns: the same item listed twice → 422", dupLine.status === 422, brief(dupLine))
    check("returns: another shopper → 404", (await RET({ reason: "too_small", idempotencyKey: key("r") }, S2)).status === 404)

    const kr1 = key("ret1")
    const r1 = await RET({ reason: "too_small", note: "a bit tight", lines: [{ variantId: vS, qty: 1 }], idempotencyKey: kr1 })
    const rid1 = r1.body?.returnId
    check("returns: request 1×S → 201 requested; merchant refund_requested; no more returns allowed", r1.status === 201 && r1.body.order.states.return === "requested" && r1.body.order.states.merchant === "refund_requested" && r1.body.order.actions.canRequestReturn === false && r1.body.order.returns[0].lines[0].qty === 1, brief(r1).slice(0, 200))
    const r1b = await RET({ reason: "too_small", note: "a bit tight", lines: [{ variantId: vS, qty: 1 }], idempotencyKey: kr1 })
    check("returns idempotency: same key → 200 duplicate, same return", r1b.status === 200 && r1b.body.duplicate === true && r1b.body.returnId === rid1, brief(r1b).slice(0, 160))
    const second = await RET({ reason: "too_large", idempotencyKey: key("r") })
    check("returns: a second open return → 409", second.status === 409, brief(second))
    check("studio list: returns=open finds the order", (await get(`/api/studio/orders?returns=open&q=${encodeURIComponent(d0.reference)}`, { who: TOBI })).body?.items?.some((o) => o.id === O.orderId))
    await brandReauth(TOBI)
    check("brand cancel: with a return in progress → 409 or 422", [409, 422].includes((await post(`/api/studio/orders/${O.orderId}/cancel`, { reason: "No longer", idempotencyKey: key("bc") }, { who: TOBI })).status))

    check("return cancel: another shopper → 404", (await post(`/api/orders/${O.orderId}/returns/${rid1}/cancel`, {}, { who: S2 })).status === 404)
    check("return cancel: unknown return → 404", (await post(`/api/orders/${O.orderId}/returns/rt_${RUN}/cancel`, {}, { who: S1 })).status === 404)
    const rc = await post(`/api/orders/${O.orderId}/returns/${rid1}/cancel`, {}, { who: S1 })
    check("return cancel: shopper withdraws → cancelled, merchant back to delivered, can request again", rc.status === 200 && rc.body.status === "cancelled" && rc.body.order.states.merchant === "delivered" && rc.body.order.actions.canRequestReturn === true, brief(rc).slice(0, 200))
    const rc2 = await post(`/api/orders/${O.orderId}/returns/${rid1}/cancel`, {}, { who: S1 })
    check("return cancel: again → 200 unchanged", rc2.status === 200 && rc2.body.status === "cancelled", brief(rc2))

    const r2 = await RET({ reason: "damaged", lines: [{ variantId: vS, qty: 1 }], idempotencyKey: key("ret2") })
    const rid2 = r2.body?.returnId
    check("returns: request again after withdrawing → 201", r2.status === 201 && !!rid2, brief(r2).slice(0, 160))
    const DEC = (b, who) => post(`/api/studio/orders/${O.orderId}/returns/${rid2}/decision`, b, { who })
    check("brand decision: reject without a reason → 400", (await DEC({ decision: "reject" }, KEMI)).status === 400)
    check("brand decision: viewer → 403", (await DEC({ decision: "approve" }, VIEWER)).status === 403)
    check("brand decision: another brand → 404", (await DEC({ decision: "approve" }, MINJI)).status === 404)
    const rej = await DEC({ decision: "reject", reason: "Shows signs of wear" }, KEMI)
    check("brand decision: reject → rejected, merchant back to delivered, decidedBy brand", rej.status === 200 && rej.body.status === "rejected" && rej.body.order.states.return === "rejected" && rej.body.order.states.merchant === "delivered" && rej.body.order.returns[0].decidedBy === "brand", brief(rej).slice(0, 200))
    check("brand decision: approving after rejecting → 409", (await DEC({ decision: "approve" }, TOBI)).status === 409)
    check("return cancel: a rejected return can't be withdrawn (409)", (await post(`/api/orders/${O.orderId}/returns/${rid2}/cancel`, {}, { who: S1 })).status === 409)
    const recRej = await post(`/api/studio/orders/${O.orderId}/returns/${rid2}/receive`, { idempotencyKey: key("rcv") }, { who: KEMI })
    check("receive: a rejected return can't be received (409)", recRej.status === 409, brief(recRej))

    const ADEC = (b, who) => post(`/api/orders/admin/${O.orderId}/returns/${rid2}/decision`, b, { who })
    check("admin decision: shipping.view-only admin → 403", (await ADEC({ decision: "approve", reason: "Platform review" }, ADM_TS)).status === 403)
    check("admin decision: reason required → 400", (await ADEC({ decision: "approve" }, ADM_SUP)).status === 400)
    const ov = await ADEC({ decision: "approve", reason: "Photos show damage on arrival" }, ADM_SUP)
    check("admin override: Yard approves the brand-declined return → approved, decidedBy platform", ov.status === 200 && ov.body.status === "approved" && ov.body.order.returns[0].decidedBy === "platform" && ov.body.order.states.merchant === "refund_requested", brief(ov).slice(0, 200))
    check("return cancel: an approved return can't be withdrawn (409)", (await post(`/api/orders/${O.orderId}/returns/${rid2}/cancel`, {}, { who: S1 })).status === 409)

    const REC = (b, who) => post(`/api/studio/orders/${O.orderId}/returns/${rid2}/receive`, b, { who })
    // Receiving with its refund moves money: a fulfilment member who hasn't re-confirmed is asked to.
    const kemiFresh = await demo("brand", "u_b_kemi", "b_lagos_static")
    const recNoReauth = await REC({ idempotencyKey: key("rcv") }, kemiFresh)
    check("receive reauth: refund without a recent re-auth → 403 fields.reauth=required, return still approved", needsReauth(recNoReauth) && (await studioOrder(TOBI, O.orderId))?.returns?.find((r) => r.id === rid2)?.status === "approved", brief(recNoReauth))
    await brandReauth(KEMI, MINJI)
    check("receive: viewer → 403, another brand → 404", (await REC({ idempotencyKey: key("rcv") }, VIEWER)).status === 403 && (await REC({ idempotencyKey: key("rcv") }, MINJI)).status === 404)
    check("receive: missing key → 400", (await REC({}, KEMI)).status === 400)
    const sBefore = await stockOf(vS)
    const tooMuch = await REC({ amountMinor: 10_001, idempotencyKey: key("rcv") }, KEMI)
    check("receive: refund above the returned items' value → 422", tooMuch.status === 422, brief(tooMuch))
    const rec = await REC({ idempotencyKey: key("rcv") }, KEMI)
    const dr = rec.body?.order
    check("receive: → received; refund of the returned item (10,000) succeeded", rec.status === 200 && rec.body.status === "received" && dr?.refunds?.length === 1 && dr.refunds[0].kind === "return" && dr.refunds[0].amountMinor === 10_000 && dr.refunds[0].status === "succeeded", brief(rec).slice(0, 240))
    check("receive: restocked 1 and line shows returnedQty 1 / restockedQty 1", (await stockOf(vS)) === sBefore + 1 && dr?.lines?.find((l) => l.variantId === vS)?.returnedQty === 1 && dr.lines.find((l) => l.variantId === vS).restockedQty === 1, { stock: await stockOf(vS), sBefore, lines: dr?.lines })
    check("receive: payment partially_refunded, merchant back to delivered, return state received", dr?.states?.payment === "partially_refunded" && dr.states.return === "received" && dr.states.merchant === "delivered", dr?.states)
    const rec2 = await REC({ idempotencyKey: key("rcv") }, KEMI)
    check("receive: again → 200 same refund, no extra stock", rec2.status === 200 && rec2.body.refundId === rec.body.refundId && rec2.body.order.refunds.length === 1 && (await stockOf(vS)) === sBefore + 1, brief(rec2).slice(0, 160))
    check("returns: stock overall = start − 2 sold + 1 back", (await stockOf(vS)) === s0 - 2 + 1, { now: await stockOf(vS), s0 })
    const d3 = await shopperOrder(S1, O.orderId)
    check("returns: shopper may return the rest (1×S + 1×M left)", d3?.actions?.canRequestReturn === true)
    const r3 = await RET({ reason: "unwanted", lines: [{ variantId: vS, qty: 2 }], idempotencyKey: key("r") })
    check("returns: can't return more than what's left of a line (422)", r3.status === 422, brief(r3))
  }

  /* ===== O5: whole-order return, lower refund, completion job ===== */
  {
    const O = await buy(S2, [{ variantId: vM, qty: 1 }])
    await ship(TOBI, O.orderId, ["shipped", "delivered"])
    const r = await post(`/api/orders/${O.orderId}/returns`, { reason: "not_as_described", idempotencyKey: key("ret") }, { who: S2 })
    const rid = r.body?.returnId
    check("returns: whole order (lines omitted) → 201 with every line", r.status === 201 && r.body.order.returns[0].lines.length === 1 && r.body.order.returns[0].lines[0].qty === 1, brief(r).slice(0, 160))
    const ap = await post(`/api/studio/orders/${O.orderId}/returns/${rid}/decision`, { decision: "approve" }, { who: TOBI })
    check("brand decision: approve → approved", ap.status === 200 && ap.body.status === "approved", brief(ap).slice(0, 120))
    const ap2 = await post(`/api/studio/orders/${O.orderId}/returns/${rid}/decision`, { decision: "approve" }, { who: TOBI })
    check("brand decision: approve again → 200 unchanged", ap2.status === 200 && ap2.body.status === "approved")
    const T = ap.body.order.totalMinor
    const sBefore = await stockOf(vM)
    await brandReauth(TOBI)
    const tooMuch = await post(`/api/studio/orders/${O.orderId}/returns/${rid}/receive`, { amountMinor: T + 1, idempotencyKey: key("rcv") }, { who: TOBI })
    check("receive: everything back — refund may be the full total incl. shipping, never more (422)", tooMuch.status === 422, brief(tooMuch))
    const half = Math.floor(T / 2)
    const rec = await post(`/api/studio/orders/${O.orderId}/returns/${rid}/receive`, { amountMinor: half, restock: false, idempotencyKey: key("rcv") }, { who: TOBI })
    check("receive: a lower refund and restock=false → refund = given amount, stock unchanged", rec.status === 200 && rec.body.order.refunds[0]?.amountMinor === half && (await stockOf(vM)) === sBefore && rec.body.order.states.payment === "partially_refunded", brief(rec).slice(0, 200))

    const notYet = await devJob("complete", [O.orderId])
    const dn = await shopperOrder(S2, O.orderId)
    check("completion: inside the return window nothing completes", notYet.status === 200 && notYet.body.result.completed === 0 && dn.completedAt === null, brief(notYet).slice(0, 200))
    const aged = await ageDelivery(O.orderId, 8)
    check("dev: delivery aged 8 days", aged.status === 200 && aged.body.events === 1, brief(aged))
    const dAged = await shopperOrder(S2, O.orderId)
    check("returns: past the window → canRequestReturn false", dAged?.actions?.canRequestReturn === false && Date.parse(dAged.actions.returnWindowEndsAt) < Date.now(), dAged?.actions)
    const job = await devJob("complete", [O.orderId])
    const dc = await shopperOrder(S2, O.orderId)
    check("completion job: after the window → completed, timeline order.completed", job.status === 200 && job.body.result.completed === 1 && !!dc.completedAt && dc.timeline.some((e) => e.kind === "order.completed"), brief(job).slice(0, 200))
    const job2 = await devJob("hourly", [O.orderId])
    check("completion job: running again (hourly) completes nothing twice", job2.status === 200 && job2.body.result.done.completed === 0, brief(job2).slice(0, 200))
    const seedRun = await devJob("complete", ["mo_null_form_903"])
    check("dev jobs: an order that isn't a kit shopper's → 404, nothing runs", seedRun.status === 404, brief(seedRun))
    const badJob = await post("/api/orders/dev", { op: "run-job", job: "delete-everything", orderIds: [O.orderId] })
    check("dev jobs: unknown job → 400", badJob.status === 400, brief(badJob))
  }

  /* ===== O8: return window closed ===== */
  {
    const O = await buy(S3, [{ variantId: vM, qty: 1 }])
    await ship(TOBI, O.orderId, ["shipped", "delivered"])
    await ageDelivery(O.orderId, 7.5)
    const r = await post(`/api/orders/${O.orderId}/returns`, { reason: "unwanted", idempotencyKey: key("late") }, { who: S3 })
    check("returns: after the 7-day window → 422", r.status === 422, brief(r))
    const job = await devJob("hourly", [O.orderId])
    const d = await shopperOrder(S3, O.orderId)
    check("completion job (hourly): a delivered order past its window with nothing open completes", job.status === 200 && job.body.result.done.completed === 1 && !!d?.completedAt, brief(job).slice(0, 200))
  }

  /* ===== O7: disputes via the webhook simulator ===== */
  {
    const O = await buy(S2, [{ variantId: vS, qty: 1 }])
    const payRef = O.checkout?.payment?.reference
    const T = (await studioOrder(TOBI, O.orderId))?.totalMinor
    const dpId = `${TAG}_dp`
    const sim = (event, data) => post("/api/webhooks/paystack/simulate", { event, data }, { who: ADM_OWNER })
    const open = await sim("charge.dispute.create", { id: dpId, status: "awaiting-merchant-feedback", currency: "NGN", refund_amount: T, category: "fraud", dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(), transaction: { reference: payRef, amount: T, currency: "NGN" } })
    check("dispute: simulated charge.dispute.create is processed", open.status === 200 && open.body?.event?.status === "processed", brief(open).slice(0, 240))
    const sd = await studioOrder(TOBI, O.orderId)
    const disp = sd?.disputes?.[0]
    check("dispute: order dispute state open; brand sees the dispute (awaiting response, evidence due)", sd?.states?.dispute === "open" && disp?.status === "awaiting_response" && !!disp.evidenceDueAt && disp.amountMinor === T, { states: sd?.states, disp })
    const shd = await shopperOrder(S2, O.orderId)
    check("dispute: shopper doesn't see dispute details; can't cancel", shd?.disputes?.length === 0 && shd.actions.canCancel === false && shd.states.dispute === "open", { d: shd?.disputes, a: shd?.actions })
    const c = await post(`/api/orders/${O.orderId}/cancel`, { idempotencyKey: key("c") }, { who: S2 })
    check("dispute: cancelling a disputed order → 409", c.status === 409, brief(c))
    const list = await get("/api/orders/admin/disputes?status=awaiting_response", { who: ADM_TS })
    const adm = list.body?.items?.find((x) => x.providerDisputeId === dpId)
    check("admin disputes: listed with provider ids and orders", list.status === 200 && !!adm && adm.orderRefIds?.includes(O.orderId) && adm.provider, brief(list).slice(0, 200))
    check("admin disputes: bad status filter → 400", (await get("/api/orders/admin/disputes?status=nope", { who: ADM_TS })).status === 400)
    const EV = (b, who, orderId = O.orderId) => post(`/api/studio/orders/${orderId}/disputes/${disp?.id}/evidence`, b, { who })
    check("dispute evidence: under 10 chars → 400", (await EV({ evidence: "short" }, KEMI)).status === 400)
    check("dispute evidence: viewer 403, another brand 404", (await EV({ evidence: "Delivered with signature on file." }, VIEWER)).status === 403 && (await EV({ evidence: "Delivered with signature on file." }, MINJI)).status === 404)
    const ev = await EV({ evidence: "Delivered to the shopper; signature and tracking on file." }, KEMI)
    check("dispute evidence: fulfilment member submits → stored with time", ev.status === 200 && ev.body.dispute.brandEvidence?.startsWith("Delivered") && !!ev.body.dispute.brandEvidenceAt, brief(ev).slice(0, 200))
    await brandReauth(TOBI)
    const gw = await post(`/api/studio/orders/${O.orderId}/refunds`, { amountMinor: T, reason: "goodwill during a chargeback", idempotencyKey: key("gwd") }, { who: TOBI })
    check("dispute open: a brand goodwill refund → 409 (would pay the shopper twice)", gw.status === 409, brief(gw).slice(0, 200))
    await post("/api/auth/reauth?as=admin", { demo: true }, { who: ADM_SUP })
    const pr = await post(`/api/orders/admin/${O.orderId}/refunds`, { amountMinor: T, reason: "platform during a chargeback", idempotencyKey: key("prd") }, { who: ADM_SUP })
    check("dispute open: an admin platform refund → 409", pr.status === 409, brief(pr).slice(0, 200))
    const nd = await studioOrder(TOBI, O.orderId)
    check("dispute open: no refund recorded, refundableMinor 0", nd?.refunds?.length === 0 && nd.refundableMinor === 0 && nd.states.payment === "paid", { refunds: nd?.refunds, refundable: nd?.refundableMinor })
    const PD = (b, who) => patch(`/api/orders/admin/disputes/${disp?.id}`, b, { who })
    check("admin dispute update: shipping.view-only admin → 403", (await PD({ adminNote: "looking" }, ADM_TS)).status === 403)
    check("admin dispute update: unknown field → 400", (await PD({ status: "won" }, ADM_SUP)).status === 400)
    const pd = await PD({ adminNote: "Evidence sent to Paystack", responseSubmitted: true, status: "under_review" }, ADM_SUP)
    check("admin dispute update: note + response submitted + under_review", pd.status === 200 && pd.body.dispute.status === "under_review" && !!pd.body.dispute.responseSubmittedAt && pd.body.dispute.adminNote === "Evidence sent to Paystack", brief(pd).slice(0, 200))

    await ship(TOBI, O.orderId, ["shipped", "delivered"])
    await ageDelivery(O.orderId, 8)
    const blocked = await devJob("complete", [O.orderId])
    check("completion: an open dispute blocks completion", blocked.status === 200 && blocked.body.result.completed === 0 && (await shopperOrder(S2, O.orderId))?.completedAt === null, brief(blocked).slice(0, 200))

    const lost = await sim("charge.dispute.resolve", { id: dpId, status: "resolved", resolution: "merchant-accepted", currency: "NGN", refund_amount: T, transaction: { reference: payRef, amount: T, currency: "NGN" } })
    const dl = await studioOrder(TOBI, O.orderId)
    check("dispute lost: processed; dispute state lost; a succeeded 'dispute' refund for the amount taken; payment refunded", lost.status === 200 && dl?.states?.dispute === "lost" && dl.disputes[0].status === "lost" && dl.refunds.length === 1 && dl.refunds[0].kind === "dispute" && dl.refunds[0].status === "succeeded" && dl.refunds[0].amountMinor === T && dl.states.payment === "refunded", { s: brief(lost).slice(0, 120), states: dl?.states, refunds: dl?.refunds })
    const again = await sim("charge.dispute.resolve", { id: dpId, status: "resolved", resolution: "merchant-accepted", currency: "NGN", refund_amount: T, transaction: { reference: payRef, amount: T, currency: "NGN" } })
    check("dispute lost: a repeated resolve event records no second refund", again.status === 200 && (await studioOrder(TOBI, O.orderId))?.refunds?.length === 1, brief(again).slice(0, 160))
    check("dispute: evidence after resolution → 409", (await EV({ evidence: "More evidence after the fact." }, KEMI)).status === 409)
    check("admin dispute update: closing a lost dispute → 409", (await PD({ status: "closed" }, ADM_SUP)).status === 409)
    await brandReauth(TOBI)
    const rf = await post(`/api/studio/orders/${O.orderId}/refunds`, { amountMinor: 1, reason: "after dispute", idempotencyKey: key("x") }, { who: TOBI })
    check("dispute lost: nothing left to refund (422)", rf.status === 422, brief(rf))
  }

  /* ===== Two-brand checkout: one order per brand, tenancy, apportioned dispute loss ===== */
  {
    const upB = await uploadBrandImage(MINJI)
    const cb = await post(
      "/api/studio/catalog/products",
      { title: `${TAG} Cap`, description: "ORDERS kit product (brand B).", categorySlug: "fashion", priceMinor: 20_000, variants: [{ sku: `${TAG}-B1`, initialStock: 20 }], images: upB.body?.media?.id ? [{ mediaId: upB.body.media.id }] : [] },
      { who: MINJI },
    )
    const PB = cb.body?.product
    if (PB) created.productB = PB.id
    const pubB = PB ? await post(`/api/studio/catalog/products/${PB.id}/status`, { action: "publish", expectedVersion: PB.version }, { who: MINJI }) : null
    check("two brands setup: a kit product in Null Form", cb.status === 201 && pubB?.status === 200, `${brief(cb).slice(0, 120)} / ${brief(pubB).slice(0, 120)}`)
    let M = null
    try {
      M = PB ? await buy(S3, [{ variantId: vS, qty: 1 }, { variantId: PB.variants[0].id, qty: 1 }]) : null
    } catch (e) {
      check("two brands: checkout with two brands", false, String(e.message).slice(0, 300))
    }
    if (M) {
      const rc = await get(`/api/orders/checkouts/${M.checkout.id}`, { who: S3 })
      const items = rc.body?.items ?? []
      const oA = items.find((o) => o.brand.id === "b_lagos_static")
      const oB = items.find((o) => o.brand.id === "b_null_form")
      check("two brands: one checkout → two paid orders under one group reference", items.length === 2 && !!oA && !!oB && oA.groupReference === oB.groupReference && items.every((o) => o.states.payment === "paid"), brief(rc).slice(0, 240))
      check("two brands: each brand sees only its own order", (await get(`/api/studio/orders/${oA?.id}`, { who: MINJI })).status === 404 && (await get(`/api/studio/orders/${oB?.id}`, { who: TOBI })).status === 404 && (await get(`/api/studio/orders/${oB?.id}`, { who: MINJI })).status === 200)
      const gross = (oA?.totalMinor ?? 0) + (oB?.totalMinor ?? 0)
      const payRef = M.checkout?.payment?.reference
      const dpId = `${TAG}_dpm`
      const sim = (event, data) => post("/api/webhooks/paystack/simulate", { event, data }, { who: ADM_OWNER })
      await sim("charge.dispute.create", { id: dpId, status: "awaiting-merchant-feedback", currency: "NGN", refund_amount: gross, transaction: { reference: payRef, amount: gross } })
      const da = await studioOrder(TOBI, oA?.id)
      const db = await studioOrder(MINJI, oB?.id)
      check("two brands dispute: both orders flagged open, both brands see the same dispute", da?.states?.dispute === "open" && db?.states?.dispute === "open" && da.disputes[0]?.id === db.disputes[0]?.id, { a: da?.states, b: db?.states })
      check(
        "two brands dispute: each brand's amount is at most its own order (never the whole transaction)",
        da?.disputes?.[0]?.amountMinor === oA?.totalMinor && db?.disputes?.[0]?.amountMinor === oB?.totalMinor,
        { a: da?.disputes?.[0]?.amountMinor, b: db?.disputes?.[0]?.amountMinor, ta: oA?.totalMinor, tb: oB?.totalMinor },
      )
      const mdp = da?.disputes?.[0]?.id
      const privA = `PRIVATE brand A note ${TAG}: tracking KIT123, shopper phone on file.`
      const evA = await post(`/api/studio/orders/${oA?.id}/disputes/${mdp}/evidence`, { evidence: privA }, { who: TOBI })
      check("two brands evidence: brand A submits on its own order → 200, sees its own text", evA.status === 200 && evA.body.dispute.brandEvidence === privA, brief(evA).slice(0, 200))
      const vb = await studioOrder(MINJI, oB?.id)
      check("two brands evidence: brand B can't read brand A's evidence on the shared dispute", vb?.disputes?.[0]?.id === mdp && vb.disputes[0].brandEvidence === null && vb.disputes[0].brandEvidenceAt === null && !JSON.stringify(vb).includes("PRIVATE brand A"), vb?.disputes?.[0])
      const evB = await post(`/api/studio/orders/${oB?.id}/disputes/${mdp}/evidence`, { evidence: `Brand B account ${TAG}: delivered by courier.` }, { who: MINJI })
      check("two brands evidence: brand B's submission → 200 with only its own text", evB.status === 200 && evB.body.dispute.brandEvidence?.startsWith("Brand B account") && !JSON.stringify(evB.body).includes("PRIVATE brand A"), brief(evB).slice(0, 200))
      const va = await studioOrder(TOBI, oA?.id)
      check("two brands evidence: brand B can't overwrite brand A's evidence", va?.disputes?.[0]?.brandEvidence === privA, va?.disputes?.[0])
      check("two brands evidence: brand B can't submit on brand A's order (404)", (await post(`/api/studio/orders/${oA?.id}/disputes/${mdp}/evidence`, { evidence: "brand B overwrote it" }, { who: MINJI })).status === 404)
      const al = await get("/api/orders/admin/disputes?limit=100", { who: ADM_TS })
      const ad = al.body?.items?.find((x) => x.id === mdp)
      check(
        "two brands evidence: Yard sees each brand's evidence separately",
        ad?.evidenceByBrand?.length === 2 && ad.evidenceByBrand.find((e) => e.brandId === "b_lagos_static")?.evidence === privA && ad.evidenceByBrand.find((e) => e.brandId === "b_null_form")?.evidence?.startsWith("Brand B account") && ad.brandEvidence?.includes(privA),
        ad ?? brief(al).slice(0, 200),
      )
      const half = Math.floor(gross / 2)
      await sim("charge.dispute.resolve", { id: dpId, status: "resolved", resolution: "merchant-accepted", currency: "NGN", refund_amount: half, transaction: { reference: payRef, amount: gross } })
      const la = await studioOrder(TOBI, oA?.id)
      const lb = await studioOrder(MINJI, oB?.id)
      const ra = sumRefunds(la)
      const rb = sumRefunds(lb)
      check(
        "two brands dispute lost (half taken): split across the orders by total, sums to the amount taken, each within its total",
        ra + rb === half && ra <= la.totalMinor && rb <= lb.totalMinor && Math.abs(ra - Math.floor((half * la.totalMinor) / gross)) <= 1 && la.refunds[0]?.kind === "dispute" && lb.refunds[0]?.kind === "dispute",
        { half, ra, rb, ta: la?.totalMinor, tb: lb?.totalMinor },
      )
      check("two brands dispute lost: payment states partially_refunded", la?.states?.payment === "partially_refunded" && lb?.states?.payment === "partially_refunded", { a: la?.states, b: lb?.states })
    }
  }

  /* ===== Receiving a return while a chargeback is open ===== */
  {
    const O = await buy(S1, [{ variantId: vM, qty: 1 }])
    await ship(TOBI, O.orderId, ["shipped", "delivered"])
    const r = await post(`/api/orders/${O.orderId}/returns`, { reason: "unwanted", idempotencyKey: key("rdp") }, { who: S1 })
    const rid = r.body?.returnId
    await post(`/api/studio/orders/${O.orderId}/returns/${rid}/decision`, { decision: "approve" }, { who: TOBI })
    const payRef = O.checkout?.payment?.reference
    const dpId = `${TAG}_dpr`
    const sim = (event, data) => post("/api/webhooks/paystack/simulate", { event, data }, { who: ADM_OWNER })
    await sim("charge.dispute.create", { id: dpId, status: "awaiting-merchant-feedback", currency: "NGN", transaction: { reference: payRef } })
    await brandReauth(KEMI)
    const rec = await post(`/api/studio/orders/${O.orderId}/returns/${rid}/receive`, { idempotencyKey: key("rcvd") }, { who: KEMI })
    const d = await studioOrder(TOBI, O.orderId)
    check("dispute open: receiving a return with its refund → 409, no refund, return still approved", rec.status === 409 && d?.refunds?.length === 0 && d.states.return === "approved" && d.states.payment === "paid", { rec: brief(rec).slice(0, 160), refunds: d?.refunds, states: d?.states })
    await sim("charge.dispute.resolve", { id: dpId, status: "resolved", resolution: "declined", currency: "NGN", transaction: { reference: payRef } })
    const rec2 = await post(`/api/studio/orders/${O.orderId}/returns/${rid}/receive`, { idempotencyKey: key("rcvd") }, { who: KEMI })
    check("dispute won: the return can then be received and refunded", rec2.status === 200 && rec2.body.order.refunds.length === 1 && rec2.body.order.refunds[0].status === "succeeded", brief(rec2).slice(0, 200))
  }

  /* ===== A backdated delivery doesn't shorten the return window ===== */
  {
    const O = await buy(S2, [{ variantId: vM, qty: 1 }])
    const placedAt = (await studioOrder(TOBI, O.orderId))?.placedAt
    await sleep(3000)
    const before = Date.now()
    const bd = await post(`/api/studio/orders/${O.orderId}/shipment`, { status: "delivered", occurredAt: placedAt }, { who: TOBI })
    const d = await shopperOrder(S2, O.orderId)
    const win = d?.actions?.returnWindowEndsAt ? Date.parse(d.actions.returnWindowEndsAt) : 0
    check(
      "backdated delivery: the return window runs 7 days from when Yard recorded it, not from the reported time",
      bd.status === 201 && d?.states?.fulfilment === "delivered" && win >= before - 1000 + 7 * 86_400_000 && d.actions.canRequestReturn === true,
      { s: brief(bd).slice(0, 120), placedAt, window: d?.actions?.returnWindowEndsAt, deliveredAt: d?.deliveredAt },
    )
    const early = await devJob("complete", [O.orderId], new Date(Date.parse(placedAt) + 7 * 86_400_000 + 1000).toISOString())
    check("backdated delivery: the order doesn't complete (no payout) 7 days after the reported time", early.status === 200 && early.body.result.completed === 0 && (await shopperOrder(S2, O.orderId))?.completedAt === null, brief(early).slice(0, 200))
  }

  /* ===== A declined cancellation refund is retried; the brand's restock choice holds ===== */
  {
    const O = await buy(S3, [{ variantId: vM, qty: 2 }])
    const s0 = await stockOf(vM)
    const dc = await post("/api/orders/dev", { op: "decline-cancel-refund", orderId: O.orderId, restock: false })
    const d0 = await studioOrder(TOBI, O.orderId)
    check("declined cancel refund (dev): cancelled, refund failed, payment still paid", dc.status === 200 && d0?.states?.fulfilment === "cancelled" && d0.states.payment === "paid" && d0.refunds.length === 1 && d0.refunds[0].status === "failed", { s: brief(dc).slice(0, 160), states: d0?.states, refunds: d0?.refunds })
    const j1 = await devJob("retry-cancelled", [O.orderId])
    const d1 = await studioOrder(TOBI, O.orderId)
    const ok = d1?.refunds?.filter((r) => r.kind === "cancellation" && r.status === "succeeded") ?? []
    check("declined cancel refund: the sweep requests a NEW refund (not the failed duplicate) → payment refunded", j1.status === 200 && j1.body.result.refunded === 1 && ok.length === 1 && ok[0].amountMinor === d1.totalMinor && d1.states.payment === "refunded", { j: brief(j1).slice(0, 160), refunds: d1?.refunds, states: d1?.states })
    check("cancel restock=false: the refund sweep doesn't put the units back", (await stockOf(vM)) === s0 && d1?.lines?.every((l) => l.restockedQty === 0), { now: await stockOf(vM), s0, lines: d1?.lines })
    const j2 = await devJob("retry-cancelled", [O.orderId])
    check("declined cancel refund: a second sweep counts nothing (nothing new sent)", j2.status === 200 && j2.body.result.refunded === 0 && (await studioOrder(TOBI, O.orderId))?.refunds?.length === 2, brief(j2).slice(0, 160))
  }

  /* ===== Dispute won ===== */
  {
    const O = await buy(S1, [{ variantId: vM, qty: 1 }])
    const payRef = O.checkout?.payment?.reference
    const dpId = `${TAG}_dpw`
    const sim = (event, data) => post("/api/webhooks/paystack/simulate", { event, data }, { who: ADM_OWNER })
    await sim("charge.dispute.create", { id: dpId, status: "awaiting-merchant-feedback", currency: "NGN", transaction: { reference: payRef } })
    const won = await sim("charge.dispute.resolve", { id: dpId, status: "resolved", resolution: "declined", currency: "NGN", transaction: { reference: payRef } })
    const d = await studioOrder(TOBI, O.orderId)
    check("dispute won: dispute state won, no refund, order can be cancelled again", won.status === 200 && d?.states?.dispute === "won" && d.refunds.length === 0 && d.states.payment === "paid" && d.actions.canCancel === true, { states: d?.states, refunds: d?.refunds, actions: d?.actions })
  }
}

async function cleanup() {
  try {
    if (!created.productId) return
    const TOBI = await demo("brand", "u_b_tobi", "b_lagos_static")
    const cur = (await get(`/api/studio/catalog/products/${created.productId}`, { who: TOBI })).body?.product
    const r = cur ? await post(`/api/studio/catalog/products/${created.productId}/status`, { action: "archive", expectedVersion: cur.version }, { who: TOBI }) : null
    check("cleanup: the kit product is archived", r?.status === 200, brief(r).slice(0, 160))
    if (created.productB) {
      const MINJI = await demo("brand", "u_b_minji", "b_null_form")
      const curB = (await get(`/api/studio/catalog/products/${created.productB}`, { who: MINJI })).body?.product
      const rb = curB ? await post(`/api/studio/catalog/products/${created.productB}/status`, { action: "archive", expectedVersion: curB.version }, { who: MINJI }) : null
      check("cleanup: the brand-B kit product is archived", rb?.status === 200, brief(rb).slice(0, 160))
    }
  } catch (e) {
    check("cleanup", false, String(e.message))
  }
}

async function run() {
  try {
    await main()
  } catch (e) {
    check("kit ran to the end", false, String(e?.stack ?? e).slice(0, 600))
  }
  await cleanup()
  return results
}

/** scripts/db-check.mjs entry: returns { status, name, detail } rows instead of printing. */
export default async function v3orders(opts = {}) {
  if (opts.base) base = String(opts.base).replace(/\/$/, "")
  quiet = true
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
  console.log(`# ${passed} passed, ${failed} failed (run ${TAG})`)
  process.exit(failed ? 1 : 0)
}
