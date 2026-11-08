#!/usr/bin/env node
// LEDGER v3 live acceptance kit. Plain Node 22 (fetch, no deps). Prints one PASS/FAIL line per check
// and exits non-zero when any check fails.
//
//   node scripts/checks/v3-ledger.mjs            (server at YARD_BASE, default http://localhost:3000)
//
// Needs a DEVELOPMENT server with the payment STUB active (no PAYSTACK_SECRET_KEY): demo sign-in,
// demo re-auth, /api/checkout/{id}/stub-pay, /api/webhooks/paystack/simulate, the ORDERS dev helper
// (/api/orders/dev) and the LEDGER dev helper (/api/admin/finance/dev). All dev helpers are 404 in
// production.
//
// Test data. The kit's money lives in the seeded brand Kumasi Thread Co. (b_kumasi_thread, GHS, owner
// u_b_multi), which no other kit sells from, so its balances move only with this kit and exact deltas
// can be checked. Signal Bloom (b_signal_bloom, same owner) is the "other brand" of the same user.
// Every record carries this run's tag: product title/SKUs, payout idempotency keys, the payout account
// name, adjustment keys, notes. The kit adds temporary memberships (ids tm_t_v3_ledger_*) of demo staff
// to Kumasi Thread and removes them at the end; it sets finance overrides on Kumasi Thread and clears
// them at the end; its product is archived. The shopper is the seeded test shopper u_t_c3 (no other kit
// uses it; override with YARD_LEDGER_SHOPPER); its cart is emptied before each purchase and at the end.
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import { deflateSync, crc32 } from "node:zlib"

let base = (process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TAG = `t_v3_ledger_${RUN}`
const K = "b_kumasi_thread"
const SB = "b_signal_bloom"
const CUR = "GHS"
const SHOPPER = process.env.YARD_LEDGER_SHOPPER ?? "u_t_c3"

let failed = 0
let passed = 0
let quiet = false
const results = []
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail !== "" && detail !== undefined && detail !== null ? (typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 500)) : ""
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

/** One request. 429s are waited out briefly (Retry-After ≤ 70 s) unless noRetry; a restarting server is retried for ~2 min. */
async function api(method, path, { who, body, headers, raw, noRetry, noOrigin } = {}) {
  const ck = who?.cookie
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
    if (res.status === 429 && !noRetry && attempt < 3) {
      const wait = Number(res.headers.get("retry-after") ?? 10) || 10
      if (wait <= 70) {
        await sleep((wait + 1) * 1000)
        continue
      }
    }
    if (who && res.headers.getSetCookie?.().length) who.cookie = mergeCookies(who.cookie, res)
    return { status: res.status, body: json, text, headers: res.headers, res }
  }
}
const get = (p, o) => api("GET", p, o)
const post = (p, body, o = {}) => api("POST", p, { ...o, body })
const put = (p, body, o = {}) => api("PUT", p, { ...o, body })
const del = (p, o) => api("DELETE", p, o)
const brief = (r) => (r ? `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message} ${r.body.error.fields ? JSON.stringify(r.body.error.fields) : ""}` : (r.text ?? "").slice(0, 300)}` : "no response")
const code = (r) => r?.body?.error?.code
const isReauth = (r) => r?.status === 403 && r.body?.error?.fields?.reauth === "required"

async function demo(actor, account, brandId) {
  const r = await post("/api/auth/demo", { actor, account, ...(brandId ? { brandId } : {}) })
  if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
  return { cookie: mergeCookies("", r.res), profile: r.body.profile, account }
}
const reauth = async (who, as) => {
  const r = await post(`/api/auth/reauth?as=${as}`, { demo: true }, { who })
  if (r.status !== 200) throw new Error(`reauth ${who.account}: ${brief(r)}`)
}
const ledgerDev = (b) => post("/api/admin/finance/dev", b)

/* ---------------- fixtures ---------------- */

function pngBytes() {
  const w = 64
  const hgt = 64
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
    for (let x = 0; x < w; x++) rows.push(Buffer.from([(x * 5) & 255, (y * 3) & 255, 120]))
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

const created = { productId: null, members: [], overrides: false }
const SHIP_TO = { name: "Ledger Kit", line1: "4 Kit Road", city: "Kumasi", country: "GH", phone: "+233 20 123 4567" }
let keyN = 0
const key = (label) => `${TAG}_${label}_${++keyN}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80)

/** Puts exactly `lines` in the shopper's cart, checks out in GHS, pays with the stub. */
async function buy(who, lines) {
  await del("/api/cart", { who })
  for (const l of lines) {
    const a = await post("/api/cart/lines", { variantId: l.variantId, qty: l.qty }, { who })
    if (a.status >= 300) throw new Error(`cart add: ${brief(a)}`)
  }
  const cart = await get(`/api/cart?currency=${CUR}&to=GH&city=Kumasi`, { who })
  if (cart.status !== 200) throw new Error(`cart: ${brief(cart)}`)
  const shipping = cart.body.groups.map((g) => {
    const opt = g.shipping?.options?.find((o) => o.available)
    if (!opt) throw new Error(`no delivery option for ${g.brandId}`)
    return { brandId: g.brandId, service: opt.service }
  })
  const co = await post("/api/checkout", { idempotencyKey: key("co"), currency: CUR, shipTo: SHIP_TO, shipping }, { who })
  if (co.status !== 201) throw new Error(`checkout: ${brief(co)}`)
  const checkout = co.body.checkout ?? co.body
  const sp = await post(`/api/checkout/${checkout.id}/stub-pay`, { outcome: "success" }, { who })
  if (sp.status !== 200) throw new Error(`stub-pay: ${brief(sp)}`)
  const view = (await get(`/api/checkout/${checkout.id}`, { who })).body
  const v = view?.checkout ?? view
  return { checkout: v, orderId: v.orderIds?.[0] }
}

/* ---------------- ledger helpers ---------------- */

const bps = (amount, b) => Math.max(0, Math.round((amount * b) / 10_000))
/** All journal lines (brand K + platform) for a filter, up to 200 newest of each. */
async function brandLines(admin, extra = "") {
  const r = await get(`/api/admin/finance/ledger?brandId=${K}&currency=${CUR}&limit=200${extra}`, { who: admin })
  return r.body?.entries ?? []
}
async function platformLines(admin, extra = "") {
  const r = await get(`/api/admin/finance/ledger?currency=${CUR}&limit=200${extra}`, { who: admin })
  return r.body?.entries ?? []
}
/** Every line of the transactions matching `pred` (brand + platform legs), grouped by transaction id. */
async function txLines(admin, pred) {
  const all = [...(await brandLines(admin)), ...(await platformLines(admin))].filter(pred)
  const by = new Map()
  for (const e of all) {
    if (!by.has(e.transactionId)) by.set(e.transactionId, [])
    by.get(e.transactionId).push(e)
  }
  return by
}
const sumDir = (lines, dir) => lines.filter((l) => l.direction === dir).reduce((s, l) => s + l.amountMinor, 0)
const leg = (lines, account, dir) => lines.filter((l) => l.account === account && l.direction === dir).reduce((s, l) => s + l.amountMinor, 0)
const balanced = (by) => [...by.values()].every((ls) => sumDir(ls, "debit") === sumDir(ls, "credit"))
async function balances(who) {
  const r = await get("/api/studio/payouts", { who })
  const b = r.body?.balances?.find((x) => x.currency === CUR) ?? { pendingMinor: 0, availableMinor: 0, reserveMinor: 0, inPayoutMinor: 0 }
  return { ...b, rules: r.body?.rules, account: r.body?.account, raw: r }
}
const delta = (a, b) => ({ pending: b.pendingMinor - a.pendingMinor, available: b.availableMinor - a.availableMinor, reserve: b.reserveMinor - a.reserveMinor, inPayout: b.inPayoutMinor - a.inPayoutMinor })
const transferRef = (payoutId) => `yt-${createHash("sha256").update(payoutId).digest("hex").slice(0, 40)}`
const devJob = (job, orderIds, at) => post("/api/orders/dev", { op: "run-job", job, orderIds, ...(at ? { at } : {}) })
const ageDelivery = (orderId, days) => post("/api/orders/dev", { op: "age-delivery", orderId, days })
async function ship(brand, orderId) {
  for (const status of ["shipped", "delivered"]) {
    const r = await post(`/api/studio/orders/${orderId}/shipment`, { status, ...(status === "shipped" ? { carrier: "GIG Logistics", trackingNumber: `LK${RUN}`.slice(0, 20) } : {}) }, { who: brand })
    if (r.status !== 201) throw new Error(`shipment ${status} on ${orderId}: ${brief(r)}`)
  }
}
async function complete(brand, orderId) {
  await ship(brand, orderId)
  const a = await ageDelivery(orderId, 8)
  if (a.status !== 200) throw new Error(`age delivery: ${brief(a)}`)
  // ORDERS' hourly job: fulfilment sync from shipment events, then completion (LEDGER postOrderCompleted).
  return devJob("hourly", [orderId])
}
const completedCount = (r) => r?.body?.result?.done?.completed ?? r?.body?.result?.completed
const orderTotal = async (who, id) => (await get(`/api/studio/orders/${id}`, { who })).body?.order?.totalMinor

/* ---------------- the kit ---------------- */

async function main() {
  if (!quiet) console.log(`# LEDGER v3 kit against ${base}, run ${TAG}`)

  /* ===== Sessions and kit memberships ===== */
  const OWNER = await demo("brand", "u_b_multi", K)
  const OWNER_SB = await demo("brand", "u_b_multi", SB)
  const MINJI = await demo("brand", "u_b_minji", "b_null_form")
  const ADM1 = await demo("admin", "adm_1") // owner
  const ADM2 = await demo("admin", "adm_2") // finance
  const ADM_TS = await demo("admin", "adm_3") // trust & safety: no finance role
  const SHOP = await demo("shopper", SHOPPER)
  check("setup: u_b_multi owns Kumasi Thread; adm_1 owner, adm_2 finance, adm_3 trust & safety", OWNER.profile.role === "owner" && OWNER.profile.brand?.id === K && ADM1.profile.role === "owner" && ADM2.profile.role === "finance" && ADM_TS.profile.role === "trust_safety", [OWNER.profile.role, ADM1.profile.role, ADM2.profile.role, ADM_TS.profile.role])
  const addMember = async (userId, role) => {
    const r = await ledgerDev({ op: "member", brandId: K, userId, role, on: true })
    if (r.status !== 200) throw new Error(`kit membership ${userId}: ${brief(r)}`)
    created.members.push(userId)
  }
  // Demo staff get kit roles in Kumasi Thread, rotated per run so back-to-back runs spread the
  // per-user hourly limits on payout requests and account changes.
  const POOL = ["u_b_kemi", "u_b_orun", "u_b_designer", "u_b_tobi", "u_b_viewer", "u_b_minji"]
  const ROLES = ["finance", "admin", "admin", "viewer", "fulfilment"]
  const shift = (process.env.YARD_LEDGER_SHIFT ? Number(process.env.YARD_LEDGER_SHIFT) : Math.floor(Date.now() / 60_000)) % POOL.length
  const as = Object.fromEntries(ROLES.map((r, i) => [i, POOL[(i + shift) % POOL.length]]))
  for (let i = 0; i < ROLES.length; i++) await addMember(as[i], ROLES[i])
  const FIN = await demo("brand", as[0], K)
  const BADM = await demo("brand", as[1], K)
  const BADM2 = await demo("brand", as[2], K)
  const VIEWER = await demo("brand", as[3], K)
  const FUL = await demo("brand", as[4], K)
  check("setup: kit members in Kumasi Thread (viewer, finance, two admins, fulfilment)", VIEWER.profile.role === "viewer" && FIN.profile.role === "finance" && BADM.profile.role === "admin" && BADM2.profile.role === "admin" && FUL.profile.role === "fulfilment", [VIEWER.profile.role, FIN.profile.role, BADM.profile.role, BADM2.profile.role, FUL.profile.role])

  /* ===== Auth required, wrong actor, wrong role ===== */
  {
    const x = "po_doesnotexist"
    const routes = [
      ["GET /studio/payouts", () => get("/api/studio/payouts")],
      ["POST /studio/payouts", () => post("/api/studio/payouts", { amountMinor: 5000, idempotencyKey: key("x") })],
      ["GET /studio/payouts/{id}", () => get(`/api/studio/payouts/${x}`)],
      ["POST cancel", () => post(`/api/studio/payouts/${x}/cancel`, {})],
      ["GET statement", () => get("/api/studio/payouts/statement")],
      ["GET account", () => get("/api/studio/payouts/account")],
      ["PUT account", () => put("/api/studio/payouts/account", {})],
      ["GET overview", () => get("/api/admin/finance/overview")],
      ["GET payouts", () => get("/api/admin/finance/payouts")],
      ["GET payout", () => get(`/api/admin/finance/payouts/${x}`)],
      ["POST approve", () => post(`/api/admin/finance/payouts/${x}/approve`, {})],
      ["POST reject", () => post(`/api/admin/finance/payouts/${x}/reject`, { reason: "nope nope" })],
      ["GET batches", () => get("/api/admin/finance/batches")],
      ["POST batches", () => post("/api/admin/finance/batches", { currency: CUR })],
      ["GET batch", () => get("/api/admin/finance/batches/pob_x")],
      ["POST batch run", () => post("/api/admin/finance/batches/pob_x/run", {})],
      ["GET reconciliation", () => get("/api/admin/finance/reconciliation")],
      ["POST reconciliation", () => post("/api/admin/finance/reconciliation", {})],
      ["GET run", () => get("/api/admin/finance/reconciliation/rec_x")],
      ["POST resolve", () => post("/api/admin/finance/reconciliation/items/rci_x/resolve", { note: "done here" })],
      ["GET brand settings", () => get(`/api/admin/finance/brands/${K}`)],
      ["PUT brand settings", () => put(`/api/admin/finance/brands/${K}`, {})],
      ["GET ledger", () => get("/api/admin/finance/ledger")],
      ["POST adjustments", () => post("/api/admin/finance/adjustments", {})],
    ]
    const res = []
    for (const [n, f] of routes) res.push([n, (await f()).status])
    check("auth: every LEDGER route answers 401 without a session", res.every(([, s]) => s === 401), res.filter(([, s]) => s !== 401))
    check("auth: a shopper session can't use Studio payouts (401)", (await get("/api/studio/payouts", { who: SHOP })).status === 401)
    check("auth: a brand session can't use Admin finance (401)", (await get("/api/admin/finance/overview", { who: OWNER })).status === 401 && (await get(`/api/admin/finance/brands/${K}`, { who: OWNER })).status === 401)
    check("auth: an admin session can't use Studio payouts (401)", (await get("/api/studio/payouts", { who: ADM1 })).status === 401)
    const ts = [
      await get("/api/admin/finance/overview", { who: ADM_TS }),
      await get("/api/admin/finance/payouts", { who: ADM_TS }),
      await get("/api/admin/finance/ledger", { who: ADM_TS }),
      await get("/api/admin/finance/batches", { who: ADM_TS }),
      await get("/api/admin/finance/reconciliation", { who: ADM_TS }),
      await get(`/api/admin/finance/brands/${K}`, { who: ADM_TS }),
    ]
    check("auth: an admin without the Finance role gets 403 on Admin finance reads", ts.every((r) => r.status === 403), ts.map((r) => r.status))
    const noOrigin = await api("POST", "/api/studio/payouts", { who: OWNER, body: { amountMinor: 5000, idempotencyKey: key("x") }, noOrigin: true })
    check("auth: a mutation without Origin / X-Yard-Client is refused (403)", noOrigin.status === 403, brief(noOrigin))
  }

  /* ===== Studio role limits (reads) ===== */
  {
    const v = [await get("/api/studio/payouts", { who: VIEWER }), await get("/api/studio/payouts/statement", { who: VIEWER }), await get("/api/studio/payouts/account", { who: VIEWER })]
    check("roles: viewer can't read payouts, statement or account (403)", v.every((r) => r.status === 403), v.map((r) => r.status))
    const f = [await get("/api/studio/payouts", { who: FUL }), await get("/api/studio/payouts/statement", { who: FUL })]
    check("roles: fulfilment member can't read payouts (403)", f.every((r) => r.status === 403), f.map((r) => r.status))
    const ok = [await get("/api/studio/payouts", { who: FIN }), await get("/api/studio/payouts", { who: BADM }), await get("/api/studio/payouts/statement", { who: FIN })]
    check("roles: finance and admin members can read payouts and the statement", ok.every((r) => r.status === 200), ok.map((r) => r.status))
    const s = (await get("/api/studio/payouts", { who: OWNER })).body
    check("payouts summary: balances per currency (integers), rules with commission 500 bps and tier", Array.isArray(s?.balances) && s.balances.every((b) => ["pendingMinor", "availableMinor", "reserveMinor", "inPayoutMinor"].every((k) => Number.isInteger(b[k]))) && s.rules?.commissionBps >= 0 && ["new", "standard", "trusted"].includes(s.rules?.tier) && Array.isArray(s.payouts), JSON.stringify(s).slice(0, 300))
  }

  /* ===== Product ===== */
  const up = await uploadBrandImage(OWNER)
  const mediaId = up.body?.media?.id
  const cp = await post(
    "/api/studio/catalog/products",
    {
      title: `${TAG} Kente Tote`,
      description: "LEDGER kit product.",
      categorySlug: "fashion",
      priceMinor: 12_345,
      options: [{ name: "Size", values: [{ value: "S" }, { value: "M" }] }],
      variants: [
        { sku: `${TAG}-S`, options: { Size: "S" }, initialStock: 40 },
        { sku: `${TAG}-M`, options: { Size: "M" }, initialStock: 40 },
      ],
      images: mediaId ? [{ mediaId, alt: "kit" }] : [],
    },
    { who: OWNER },
  )
  const P = cp.body?.product
  if (P) created.productId = P.id
  const pub = P ? await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: P.version }, { who: OWNER }) : null
  check("setup: kit product created and published in Kumasi Thread (GHS)", cp.status === 201 && pub?.status === 200, `${brief(cp).slice(0, 150)} / ${brief(pub).slice(0, 150)}`)
  if (!P || pub?.status !== 200) throw new Error("no product to sell")
  const vS = P.variants.find((v) => v.options?.Size === "S")?.id ?? P.variants[0].id
  const vM = P.variants.find((v) => v.options?.Size === "M")?.id ?? P.variants[1].id

  /* ===== Brand finance settings (admin) ===== */
  const SET = (b, who = ADM1) => put(`/api/admin/finance/brands/${K}`, b, { who })
  {
    check("brand settings: unknown field → 400", (await SET({ tier: "new" })).status === 400)
    check("brand settings: commission over 5000 bps → 400", (await SET({ commissionBpsOverride: 6000 })).status === 400)
    check("brand settings: admin without Finance role → 403", (await SET({ tierOverride: "new" }, ADM_TS)).status === 403)
    check("brand settings: unknown brand → 404", (await put(`/api/admin/finance/brands/b_${RUN}_none`, { tierOverride: "new" }, { who: ADM1 })).status === 404)
    const noRe = await SET({ commissionBpsOverride: 750 })
    check("brand settings: changing commission needs a recent re-auth (403 reauth)", isReauth(noRe), brief(noRe))
    check("brand settings: hold without a reason → 422", (await SET({ payoutsOnHold: true })).status === 422)
    const t = await SET({ tierOverride: "new" })
    created.overrides = true
    check("brand settings: tier override (no re-auth needed) → 200", t.status === 200 && t.body?.settings?.tierOverride === "new", brief(t))
    const g = await get(`/api/admin/finance/brands/${K}`, { who: ADM1 })
    check("brand settings: GET shows tier new, reserve 1000 bps / 30 days, commission 500", g.status === 200 && g.body.rules?.tier === "new" && g.body.rules.reserveBps === 1000 && g.body.rules.reserveDays === 30 && g.body.rules.commissionBps === 500 && g.body.brand?.id === K, JSON.stringify(g.body?.rules))
  }

  /* ===== Captures: commission 5% exact, pending/reserve split by tier ===== */
  const orders = {}
  const captureCase = async (label, tier, reserveBps, commissionBps) => {
    const before = await balances(OWNER)
    const O = await buy(SHOP, [{ variantId: vS, qty: 1 }])
    const after = await balances(OWNER)
    const gross = await orderTotal(OWNER, O.orderId)
    orders[label] = { id: O.orderId, gross, checkout: O.checkout }
    const by = await txLines(ADM1, (e) => e.orderId === O.orderId && e.kind === "payment_captured")
    const lines = [...by.values()].flat()
    const commission = bps(gross, commissionBps)
    const net = gross - commission
    const reserve = Math.min(net, bps(net, reserveBps))
    const pending = net - reserve
    check(`capture ${label}: paid order → exactly one payment_captured transaction`, O.checkout?.status === "paid" && by.size === 1, { status: O.checkout?.status, txs: by.size })
    check(`capture ${label}: provider clearing debited with the gross (${gross})`, leg(lines, "provider_clearing", "debit") === gross, lines)
    check(`capture ${label}: commission = ${commissionBps} bps of gross, rounded half up (${commission})`, leg(lines, "platform_commission", "credit") === commission, { gross, got: leg(lines, "platform_commission", "credit"), want: commission })
    check(`capture ${label}: tier ${tier} → reserve ${reserveBps} bps of net (${reserve}), pending the rest (${pending})`, leg(lines, "brand_reserve", "credit") === reserve && leg(lines, "brand_pending", "credit") === pending, { reserve: leg(lines, "brand_reserve", "credit"), pending: leg(lines, "brand_pending", "credit"), want: { reserve, pending } })
    check(`capture ${label}: the transaction balances (debits = credits)`, balanced(by) && sumDir(lines, "debit") === gross, { d: sumDir(lines, "debit"), c: sumDir(lines, "credit") })
    const d = delta(before, after)
    check(`capture ${label}: balances endpoint moved pending +${pending}, reserve +${reserve}, available 0`, d.pending === pending && d.reserve === reserve && d.available === 0 && d.inPayout === 0, d)
    return { gross, commission, reserve, pending }
  }
  const capNew = await captureCase("O1 (new)", "new", 1000, 500)
  check("brand settings: switch to standard tier", (await SET({ tierOverride: "standard" })).status === 200)
  const capStd = await captureCase("O2 (standard)", "standard", 500, 500)
  check("brand settings: switch to trusted tier", (await SET({ tierOverride: "trusted" })).status === 200)
  await reauth(ADM1, "admin")
  const ovr = await SET({ commissionBpsOverride: 750 })
  check("brand settings: commission override 750 bps after re-auth → 200", ovr.status === 200 && ovr.body?.settings?.commissionBpsOverride === 750, brief(ovr))
  const capTr = await captureCase("O3 (trusted, 7.5% override)", "trusted", 0, 750)
  check("brand settings: clear the commission override", (await SET({ commissionBpsOverride: null })).status === 200)

  /* ===== Capture idempotency ===== */
  {
    const O = orders["O2 (standard)"]
    const payRef = O.checkout?.payment?.reference
    const again = await post("/api/webhooks/paystack/simulate", { event: "charge.success", data: { reference: payRef, amount: O.checkout.totalMinor, currency: CUR, status: "success" } }, { who: ADM1 })
    const by = await txLines(ADM1, (e) => e.orderId === O.id && e.kind === "payment_captured")
    check("capture idempotency: a repeated charge.success posts nothing new", again.status === 200 && by.size === 1, `${brief(again).slice(0, 160)} txs=${by.size}`)
    const sp = await post(`/api/checkout/${O.checkout.id}/stub-pay`, { outcome: "success" }, { who: SHOP })
    const by2 = await txLines(ADM1, (e) => e.orderId === O.id && e.kind === "payment_captured")
    check("capture idempotency: paying the checkout again posts nothing new", by2.size === 1, `${brief(sp).slice(0, 120)} txs=${by2.size}`)
  }

  /* ===== Refunds ===== */
  {
    // Partial refund on O2 (standard): commission back pro rata, the brand's share from pending.
    const O = orders["O2 (standard)"]
    const amt = 5_000
    const before = await balances(OWNER)
    const r = await post(`/api/studio/orders/${O.id}/refunds`, { amountMinor: amt, reason: "kit partial refund", idempotencyKey: key("rf") }, { who: OWNER })
    const after = await balances(OWNER)
    const by = await txLines(ADM1, (e) => e.orderId === O.id && e.kind === "refund")
    const lines = [...by.values()].flat()
    const back = Math.round((amt * capStd.commission) / capStd.gross)
    check("refund partial: one refund transaction posted", r.status === 201 && by.size === 1, `${brief(r).slice(0, 160)} txs=${by.size}`)
    check(`refund partial: clearing credited ${amt}, commission back ${back}, pending debited ${amt - back}`, leg(lines, "provider_clearing", "credit") === amt && leg(lines, "platform_commission", "debit") === back && leg(lines, "brand_pending", "debit") === amt - back, lines.map((l) => [l.account, l.direction, l.amountMinor]))
    check("refund partial: balanced, and the balances endpoint shows pending −brand share", balanced(by) && delta(before, after).pending === -(amt - back) && delta(before, after).reserve === 0, delta(before, after))

    // Full refund of O1 (new): everything left comes back, pending and reserve both emptied.
    const O1 = orders["O1 (new)"]
    const b1 = await balances(OWNER)
    const full = await post(`/api/studio/orders/${O1.id}/refunds`, { amountMinor: O1.gross, reason: "kit full refund", idempotencyKey: key("rf") }, { who: OWNER })
    const a1 = await balances(OWNER)
    const by1 = await txLines(ADM1, (e) => e.orderId === O1.id && e.kind === "refund")
    const l1 = [...by1.values()].flat()
    check("refund full: commission fully returned, pending and reserve of the order reversed", full.status === 201 && leg(l1, "platform_commission", "debit") === capNew.commission && leg(l1, "brand_pending", "debit") === capNew.pending && leg(l1, "brand_reserve", "debit") === capNew.reserve && leg(l1, "provider_clearing", "credit") === O1.gross, { s: brief(full).slice(0, 120), lines: l1.map((l) => [l.account, l.direction, l.amountMinor]) })
    check("refund full: balanced; balances pending −" + capNew.pending + ", reserve −" + capNew.reserve, balanced(by1) && delta(b1, a1).pending === -capNew.pending && delta(b1, a1).reserve === -capNew.reserve && delta(b1, a1).available === 0, delta(b1, a1))
    const over = await post(`/api/studio/orders/${O1.id}/refunds`, { amountMinor: 1, reason: "kit over refund", idempotencyKey: key("rf") }, { who: OWNER })
    const by1b = await txLines(ADM1, (e) => e.orderId === O1.id && e.kind === "refund")
    check("refund: over-refund refused (422) and nothing posted", over.status === 422 && by1b.size === 1, `${brief(over)} txs=${by1b.size}`)
    const done = await devJob("complete", [O1.id], new Date(Date.now() + 60 * 86_400_000).toISOString())
    const c1 = await txLines(ADM1, (e) => e.orderId === O1.id && e.kind === "order_completed")
    check("completion: a fully refunded order moves nothing to available", done.status === 200 && c1.size === 0 && (await balances(OWNER)).availableMinor === a1.availableMinor, `${brief(done).slice(0, 160)} txs=${c1.size}`)
  }

  /* ===== Completion: pending → available; reserves released after their period ===== */
  {
    const O2 = orders["O2 (standard)"]
    const b = await balances(OWNER)
    const c = await complete(OWNER, O2.id)
    const a = await balances(OWNER)
    const by = await txLines(ADM1, (e) => e.orderId === O2.id && e.kind === "order_completed")
    const lines = [...by.values()].flat()
    const pendingLeft = capStd.pending - (5_000 - Math.round((5_000 * capStd.commission) / capStd.gross))
    check("completion O2: the completion job posted one order_completed transaction", c.status === 200 && completedCount(c) === 1 && by.size === 1, `${brief(c).slice(0, 200)} txs=${by.size}`)
    check(`completion O2: pending → available by what's left of the order (${pendingLeft}); reserve stays`, leg(lines, "brand_pending", "debit") === pendingLeft && leg(lines, "brand_available", "credit") === pendingLeft && delta(b, a).pending === -pendingLeft && delta(b, a).available === pendingLeft && delta(b, a).reserve === 0, { lines: lines.map((l) => [l.account, l.direction, l.amountMinor]), d: delta(b, a) })
    const again = await devJob("hourly", [O2.id])
    const by2 = await txLines(ADM1, (e) => e.orderId === O2.id && e.kind === "order_completed")
    check("completion O2: running the job again posts nothing", again.status === 200 && by2.size === 1, `txs=${by2.size}`)

    const early = await ledgerDev({ op: "release-reserves", orderIds: [O2.id], at: new Date(Date.now() + 13 * 86_400_000).toISOString() })
    check("reserve O2: not released before 14 days", early.status === 200 && early.body?.released === 0, brief(early))
    const b3 = await balances(OWNER)
    const late = await ledgerDev({ op: "release-reserves", orderIds: [O2.id], at: new Date(Date.now() + 15 * 86_400_000).toISOString() })
    const a3 = await balances(OWNER)
    const rel = [...(await txLines(ADM1, (e) => e.orderId === O2.id && e.kind === "reserve_released")).values()].flat()
    check(`reserve O2: released after 14 days: reserve → available ${capStd.reserve}`, late.status === 200 && late.body?.released === 1 && leg(rel, "brand_reserve", "debit") === capStd.reserve && delta(b3, a3).available === capStd.reserve && delta(b3, a3).reserve === -capStd.reserve, { s: brief(late), d: delta(b3, a3) })
    const twice = await ledgerDev({ op: "release-reserves", orderIds: [O2.id], at: new Date(Date.now() + 40 * 86_400_000).toISOString() })
    check("reserve O2: a second release run releases nothing", twice.status === 200 && twice.body?.released === 0, brief(twice))

    const O3 = orders["O3 (trusted, 7.5% override)"]
    const b4 = await balances(OWNER)
    const c3 = await complete(OWNER, O3.id)
    const a4 = await balances(OWNER)
    check(`completion O3 (trusted): the whole net (${capTr.pending}) becomes available, no reserve`, c3.status === 200 && delta(b4, a4).available === capTr.pending && delta(b4, a4).pending === -capTr.pending && delta(b4, a4).reserve === 0, delta(b4, a4))

    // A refund after completion comes out of available.
    const amt = 1_000
    const back = Math.round((amt * capTr.commission) / capTr.gross)
    const b5 = await balances(OWNER)
    const rf = await post(`/api/studio/orders/${O3.id}/refunds`, { amountMinor: amt, reason: "kit refund after completion", idempotencyKey: key("rf") }, { who: OWNER })
    const a5 = await balances(OWNER)
    const l5 = [...(await txLines(ADM1, (e) => e.orderId === O3.id && e.kind === "refund")).values()].flat()
    check(`refund after completion: brand share (${amt - back}) taken from available`, rf.status === 201 && leg(l5, "brand_available", "debit") === amt - back && delta(b5, a5).available === -(amt - back), { s: brief(rf).slice(0, 120), d: delta(b5, a5) })
  }

  /* ===== Statement (Studio) ===== */
  {
    const s = await get(`/api/studio/payouts/statement?currency=${CUR}&limit=200`, { who: OWNER })
    const all = s.body?.entries ?? []
    check("statement: owner reads lines newest first with signed amounts", s.status === 200 && all.length > 0 && all.every((e, i) => i === 0 || e.at <= all[i - 1].at) && all.every((e) => Number.isInteger(e.signedMinor) && Math.abs(e.signedMinor) === e.amountMinor), brief(s).slice(0, 160))
    check("statement: only this brand's accounts (no platform accounts)", all.every((e) => e.account.startsWith("brand_")), [...new Set(all.map((e) => e.account))])
    const av = await get(`/api/studio/payouts/statement?currency=${CUR}&account=brand_available&limit=200`, { who: OWNER })
    check("statement: account filter returns only brand_available lines", av.status === 200 && av.body.entries.length > 0 && av.body.entries.every((e) => e.account === "brand_available"))
    // Paging with limit=1 and the returned cursor visits the same lines as one big page, none skipped.
    const want = all.slice(0, 6).map((e) => e.id)
    const seen = []
    let cursor = null
    for (let i = 0; i < 6; i++) {
      const p = await get(`/api/studio/payouts/statement?currency=${CUR}&limit=1${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`, { who: OWNER })
      if (p.status !== 200 || !p.body.entries.length) break
      seen.push(p.body.entries[0].id)
      cursor = p.body.nextBefore
    }
    check("statement: paging limit=1 with nextBefore visits the same lines in order (none skipped)", JSON.stringify(seen) === JSON.stringify(want), { seen, want })
    const bad = [await get("/api/studio/payouts/statement?currency=ghs", { who: OWNER }), await get("/api/studio/payouts/statement?account=platform_commission", { who: OWNER }), await get("/api/studio/payouts/statement?limit=0", { who: OWNER }), await get("/api/studio/payouts/statement?before=yesterday", { who: OWNER }), await get("/api/studio/payouts/statement?bogus=1", { who: OWNER })]
    check("statement: bad currency / platform account / limit 0 / bad before / unknown param → 400", bad.every((r) => r.status === 400), bad.map((r) => r.status))
    const other = await get(`/api/studio/payouts/statement?currency=${CUR}&limit=200`, { who: OWNER_SB })
    const mine = new Set(all.map((e) => e.id))
    check("statement tenancy: the same user's other brand sees none of these lines", other.status === 200 && !other.body.entries.some((e) => mine.has(e.id)))
  }

  /* ===== Payout account (sealed) ===== */
  const acctNo = `${Date.now()}`.slice(-10).padStart(10, "7")
  const ACCT = { country: "GH", currency: CUR, bankCode: "GH190100", bankName: "Kit Bank Ghana", accountName: `${TAG} Ltd`, accountNumber: acctNo }
  {
    const fin400 = await put("/api/studio/payouts/account", { ...ACCT, accountNumber: "12ab45678" }, { who: FIN })
    check("account: letters in the account number → 400", fin400.status === 400, brief(fin400))
    check("account: unknown field → 400", (await put("/api/studio/payouts/account", { ...ACCT, iban: "x" }, { who: FIN })).status === 400)
    check("account: finance member can't change the payout account (403)", (await put("/api/studio/payouts/account", ACCT, { who: FIN })).status === 403)
    await reauth(OWNER, "brand")
    const pa = await put("/api/studio/payouts/account", ACCT, { who: OWNER })
    const a = pa.body?.account
    check("account: owner after re-auth saves it (stub recipient, not verified, cooldown set)", pa.status === 200 && a?.accountLast4 === acctNo.slice(-4) && a.recipientProvider === "stub" && a.verified === false && !!a.cooldownUntil && a.currency === CUR, brief(pa).slice(0, 300))
    const ownerFresh = await demo("brand", "u_b_multi", K)
    const nr = await put("/api/studio/payouts/account", ACCT, { who: ownerFresh })
    check("account: owner without a recent re-auth → 403 reauth", isReauth(nr), brief(nr))
    check("account: the response never contains the full account number", !pa.text.includes(acctNo) && !JSON.stringify(a ?? {}).includes(acctNo))
    const reads = [await get("/api/studio/payouts/account", { who: OWNER }), await get("/api/studio/payouts", { who: FIN }), await get(`/api/admin/finance/brands/${K}`, { who: ADM1 })]
    check("account: Studio and Admin reads show last 4 only, never the number", reads.every((r) => r.status === 200 && !r.text.includes(acctNo)) && reads[0].body.account?.accountLast4 === acctNo.slice(-4), reads.map((r) => r.status))
    const scan = await ledgerDev({ op: "scan-account", brandId: K, accountNumber: acctNo })
    check("account: no table in the database holds the plaintext number", scan.status === 200 && scan.body.tables > 10 && scan.body.hits.length === 0, brief(scan))
    check("account: stored sealed (v1 AES-GCM) and opens back to the number with the vault key", scan.body?.sealed?.format === "v1" && scan.body.sealed.opens === true && scan.body.sealed.last4 === acctNo.slice(-4), scan.body?.sealed)
    const cool = await post("/api/studio/payouts", { amountMinor: 5_000, idempotencyKey: key("cool") }, { who: BADM })
    check("payout request: refused during the 24 h bank-change cooldown (422)", cool.status === 422, brief(cool))
    const aged = await ledgerDev({ op: "age-account", brandId: K, hours: 25 })
    check("setup: kit account aged past the cooldown", aged.status === 200, brief(aged))
  }

  /* ===== Admin adjustment (funds the payouts below) ===== */
  const ADJ = 40_000
  {
    const adjKey = key("adj")
    const body = { brandId: K, currency: CUR, account: "brand_available", direction: "credit", amountMinor: ADJ, reason: `${TAG} goodwill credit`, idempotencyKey: adjKey }
    check("adjustment: admin without Finance role → 403", (await post("/api/admin/finance/adjustments", body, { who: ADM_TS })).status === 403)
    const fresh = await demo("admin", "adm_2")
    check("adjustment: needs a recent re-auth (403 reauth)", isReauth(await post("/api/admin/finance/adjustments", body, { who: fresh })))
    check("adjustment: bad bodies → 400 (fractional amount, platform account, short reason)", (await post("/api/admin/finance/adjustments", { ...body, amountMinor: 1.5 }, { who: ADM1 })).status === 400 && (await post("/api/admin/finance/adjustments", { ...body, account: "platform_commission" }, { who: ADM1 })).status === 400 && (await post("/api/admin/finance/adjustments", { ...body, reason: "x" }, { who: ADM1 })).status === 400)
    check("adjustment: unknown brand → 404", (await post("/api/admin/finance/adjustments", { ...body, brandId: `b_${RUN}_none`, idempotencyKey: key("adj") }, { who: ADM1 })).status === 404)
    const b = await balances(OWNER)
    const r1 = await post("/api/admin/finance/adjustments", body, { who: ADM1 })
    const r2 = await post("/api/admin/finance/adjustments", body, { who: ADM1 })
    const a = await balances(OWNER)
    check("adjustment: credit posts once (201), the replay is a duplicate (200, same transaction)", r1.status === 201 && r2.status === 200 && r2.body.duplicate === true && r2.body.transactionId === r1.body.transactionId, `${brief(r1).slice(0, 100)} | ${brief(r2).slice(0, 100)}`)
    check(`adjustment: available +${ADJ} exactly once`, delta(b, a).available === ADJ, delta(b, a))
    const by = await txLines(ADM1, (e) => e.transactionId === r1.body?.transactionId)
    const ls = [...by.values()].flat()
    check("adjustment: balanced against platform_adjustments", balanced(by) && leg(ls, "platform_adjustments", "debit") === ADJ && leg(ls, "brand_available", "credit") === ADJ, ls.map((l) => [l.account, l.direction, l.amountMinor]))
  }

  /* ===== Payout requests ===== */
  const R = (b, who = BADM) => post("/api/studio/payouts", b, { who })
  let P1, P2, P3, P4, P5, P6
  {
    const v = [
      ["amount 0", { amountMinor: 0, idempotencyKey: key("v") }],
      ["fractional", { amountMinor: 5000.5, idempotencyKey: key("v") }],
      ["no key", { amountMinor: 5000 }],
      ["extra field", { amountMinor: 5000, idempotencyKey: key("v"), brandId: SB }],
    ]
    const vr = []
    // Bodies are validated before the role check, so the viewer sees the 400s (spreads the per-user rate budget).
    for (const [n, b] of v) vr.push([n, (await R(b, VIEWER)).status])
    check("payout request: bad bodies → 400", vr.every(([, s]) => s === 400), vr)
    check("payout request: viewer → 403", (await R({ amountMinor: 5000, idempotencyKey: key("v") }, VIEWER)).status === 403)
    check("payout request: below the GHS minimum (5000) → 422", (await R({ amountMinor: 4_999, idempotencyKey: key("v") }, FIN)).status === 422)
    check("payout request: another currency than the account's → 422", (await R({ amountMinor: 5_000, currency: "NGN", idempotencyKey: key("v") }, FIN)).status === 422)
    const b0 = await balances(OWNER)
    const overR = await R({ amountMinor: b0.availableMinor + 1, idempotencyKey: key("v") }, BADM2)
    const b0a = await balances(OWNER)
    check("payout request: more than available → 422 and nothing moves", overR.status === 422 && b0a.availableMinor === b0.availableMinor && b0a.inPayoutMinor === b0.inPayoutMinor, `${brief(overR)} available=${b0.availableMinor}`)

    const k1 = key("p1")
    const r1 = await R({ amountMinor: 6_000, idempotencyKey: k1 })
    P1 = r1.body?.payout
    const b1 = await balances(OWNER)
    check("payout request: admin member → 201 requested, stub recipient flagged", r1.status === 201 && P1?.status === "requested" && P1.amountMinor === 6_000 && P1.currency === CUR && P1.stubRecipient === true, brief(r1).slice(0, 200))
    check("payout request: available → payout hold at once (−6000 / +6000)", delta(b0a, b1).available === -6_000 && delta(b0a, b1).inPayout === 6_000, delta(b0a, b1))
    const ptx = await txLines(ADM1, (e) => e.payoutId === P1?.id && e.kind === "payout_requested")
    check("payout request: one balanced payout_requested transaction", ptx.size === 1 && balanced(ptx), ptx.size)
    const rep = await R({ amountMinor: 6_000, idempotencyKey: k1 })
    check("payout request: replay with the same key → 200, same payout, nothing moves", rep.status === 200 && rep.body?.payout?.id === P1?.id && (await balances(OWNER)).availableMinor === b1.availableMinor, brief(rep).slice(0, 120))
    check("payout request: same key, different amount → 409", (await R({ amountMinor: 6_001, idempotencyKey: k1 })).status === 409)
    const r4 = await R({ amountMinor: 5_000, idempotencyKey: key("p4") }, FIN)
    P4 = r4.body?.payout
    check("payout request: finance member may request (201)", r4.status === 201 && P4?.status === "requested", brief(r4).slice(0, 120))
    const r2 = await R({ amountMinor: 5_500, idempotencyKey: key("p2") }, BADM2)
    P2 = r2.body?.payout
    const r3 = await R({ amountMinor: 5_000, idempotencyKey: key("p3") }, BADM2)
    P3 = r3.body?.payout
    check("payout request: second admin member requests two more (201)", r2.status === 201 && r3.status === 201, `${brief(r2).slice(0, 80)} | ${brief(r3).slice(0, 80)}`)

    // Two concurrent requests that together exceed available: exactly one goes through.
    const bp = await balances(OWNER)
    const part = Math.max(5_000, Math.ceil(bp.availableMinor * 0.6))
    const par = await Promise.all([R({ amountMinor: part, idempotencyKey: key("par") }, FIN), R({ amountMinor: part, idempotencyKey: key("par") }, BADM)])
    const ap = await balances(OWNER)
    const won = par.filter((r) => r.status === 201)
    check("payout request: two concurrent requests over the available balance → one 201, one 422", won.length === 1 && par.filter((r) => r.status === 422).length === 1 && ap.availableMinor === bp.availableMinor - part && ap.availableMinor >= 0, { s: par.map((r) => brief(r).slice(0, 80)), before: bp.availableMinor, after: ap.availableMinor, part })
    if (won[0]?.body?.payout?.id) await post(`/api/studio/payouts/${won[0].body.payout.id}/cancel`, {}, { who: OWNER })

    // Read / tenancy
    const g = await get(`/api/studio/payouts/${P1?.id}`, { who: OWNER })
    check("payout read: owner 200; another brand 404; same user's other brand 404; viewer 403", g.status === 200 && g.body.payout.id === P1.id && (await get(`/api/studio/payouts/${P1?.id}`, { who: MINJI })).status === 404 && (await get(`/api/studio/payouts/${P1?.id}`, { who: OWNER_SB })).status === 404 && (await get(`/api/studio/payouts/${P1?.id}`, { who: VIEWER })).status === 403)
    check("payout read: unknown id → 404", (await get(`/api/studio/payouts/po_${RUN}_none`, { who: OWNER })).status === 404)
    const sum = (await get("/api/studio/payouts", { who: OWNER })).body
    check("payouts summary: recent payouts list the new requests", [P1, P2, P3, P4].every((p) => sum?.payouts?.some((x) => x.id === p?.id)))

    // Cancel
    check("payout cancel: another brand → 404", (await post(`/api/studio/payouts/${P4?.id}/cancel`, {}, { who: MINJI })).status === 404)
    check("payout cancel: viewer → 403", (await post(`/api/studio/payouts/${P4?.id}/cancel`, {}, { who: VIEWER })).status === 403)
    const bc = await balances(OWNER)
    const c = await post(`/api/studio/payouts/${P4?.id}/cancel`, {}, { who: OWNER })
    const ac = await balances(OWNER)
    check("payout cancel: owner cancels → cancelled, hold → available (+5000)", c.status === 200 && c.body.payout.status === "cancelled" && delta(bc, ac).available === 5_000 && delta(bc, ac).inPayout === -5_000, { s: brief(c).slice(0, 100), d: delta(bc, ac) })
    const c2 = await post(`/api/studio/payouts/${P4?.id}/cancel`, {}, { who: OWNER })
    check("payout cancel: cancelling again → 409, nothing moves", c2.status === 409 && (await balances(OWNER)).availableMinor === ac.availableMinor, brief(c2))
  }

  /* ===== Approvals: two different admins, both re-authenticated ===== */
  {
    const A = (id, who, b = {}) => post(`/api/admin/finance/payouts/${id}/approve`, b, { who })
    check("approve: admin without Finance role → 403", (await A(P1.id, ADM_TS)).status === 403)
    const fresh1 = await demo("admin", "adm_1")
    check("approve: without a recent re-auth → 403 reauth", isReauth(await A(P1.id, fresh1)))
    check("approve: unknown field → 400", (await A(P1.id, ADM1, { amountMinor: 1 })).status === 400)
    check("approve: unknown payout → 404", (await A(`po_${RUN}_none`, ADM1)).status === 404)
    const a1 = await A(P1.id, ADM1, { note: `${TAG} first look` })
    check("approve: step 1 by adm_1 → awaiting_second_approval", a1.status === 200 && a1.body.payout.status === "awaiting_second_approval" && a1.body.payout.approvals.length === 1 && a1.body.payout.approvals[0].adminId === "adm_1", brief(a1).slice(0, 200))
    const same = await A(P1.id, ADM1)
    check("approve: the same admin can't give the second approval (422)", same.status === 422 && (await get(`/api/admin/finance/payouts/${P1.id}`, { who: ADM1 })).body.payout.status === "awaiting_second_approval", brief(same))
    const fresh2 = await demo("admin", "adm_2")
    check("approve: second admin without re-auth → 403 reauth", isReauth(await A(P1.id, fresh2)))
    await reauth(ADM2, "admin")
    const a2 = await A(P1.id, ADM2)
    check("approve: step 2 by adm_2 → approved, two approvals by different admins", a2.status === 200 && a2.body.payout.status === "approved" && a2.body.payout.approvals.length === 2 && new Set(a2.body.payout.approvals.map((x) => x.adminId)).size === 2 && !!a2.body.payout.approvedAt, brief(a2).slice(0, 200))
    check("approve: approving an approved payout → 409", (await A(P1.id, ADM2)).status === 409 || (await A(P1.id, ADM2)).status === 422)
    const bal = await balances(OWNER)
    check("approve: approval moves no money (still in payout hold)", bal.inPayoutMinor >= 6_000)

    // A brand-member admin can't approve.
    const mem = await ledgerDev({ op: "member", brandId: K, userId: "adm_2", role: "viewer", on: true })
    if (mem.status === 200) created.members.push("adm_2")
    const s1 = await A(P2.id, ADM1)
    const blocked = await A(P2.id, ADM2)
    await ledgerDev({ op: "member", brandId: K, userId: "adm_2", role: "viewer", on: false })
    created.members = created.members.filter((m) => m !== "adm_2")
    check("approve: an admin who belongs to the brand can't approve (422)", mem.status === 200 && s1.status === 200 && blocked.status === 422 && (await get(`/api/admin/finance/payouts/${P2.id}`, { who: ADM1 })).body.payout.status === "awaiting_second_approval", `${brief(mem).slice(0, 80)} | ${brief(s1).slice(0, 80)} | ${brief(blocked)}`)
    const ok2 = await A(P2.id, ADM2)
    check("approve: once no longer a member, the second approval goes through", ok2.status === 200 && ok2.body.payout.status === "approved", brief(ok2).slice(0, 120))
    check("payout cancel: an approved payout can't be cancelled by the brand (409)", (await post(`/api/studio/payouts/${P2.id}/cancel`, {}, { who: OWNER })).status === 409)

    // Hold blocks requests and approvals.
    const h = await SET({ payoutsOnHold: true, holdReason: `${TAG} review` })
    const hr = await R({ amountMinor: 5_000, idempotencyKey: key("hold") }, FIN)
    const ha = await A(P3.id, ADM1)
    const lift = await SET({ payoutsOnHold: false, holdReason: null })
    check("hold: payouts on hold refuse new requests (422) and approvals (422)", h.status === 200 && hr.status === 422 && ha.status === 422 && lift.status === 200, [h.status, hr.status, ha.status, lift.status])

    // Reject
    const J = (id, b, who = ADM1) => post(`/api/admin/finance/payouts/${id}/reject`, b, { who })
    check("reject: no reason → 400", (await J(P3.id, {})).status === 400)
    check("reject: admin without Finance role → 403", (await J(P3.id, { reason: "not today" }, ADM_TS)).status === 403)
    check("reject: without a recent re-auth → 403 reauth", isReauth(await J(P3.id, { reason: "not today" }, await demo("admin", "adm_1"))))
    const bj = await balances(OWNER)
    const j = await J(P3.id, { reason: `${TAG} bank details unclear` })
    const aj = await balances(OWNER)
    check("reject: → rejected with reason; hold → available (+5000)", j.status === 200 && j.body.payout.status === "rejected" && j.body.payout.rejectReason?.includes(TAG) && delta(bj, aj).available === 5_000 && delta(bj, aj).inPayout === -5_000, { s: brief(j).slice(0, 120), d: delta(bj, aj) })
    check("reject: rejecting again → 409", (await J(P3.id, { reason: "again again" })).status === 409)
    check("approve: a rejected payout can't be approved (409)", (await A(P3.id, ADM2)).status === 409)
  }

  /* ===== Admin payout reads ===== */
  {
    const l = await get(`/api/admin/finance/payouts?brandId=${K}&status=approved&status=rejected&limit=100`, { who: ADM2 })
    check("admin payouts: filter by brand and several statuses", l.status === 200 && l.body.payouts.some((p) => p.id === P1.id) && l.body.payouts.some((p) => p.id === P3.id) && l.body.payouts.every((p) => p.brandId === K && ["approved", "rejected"].includes(p.status)), brief(l).slice(0, 160))
    check("admin payouts: bad status → 400; limit 0 → 400", (await get("/api/admin/finance/payouts?status=done", { who: ADM2 })).status === 400 && (await get("/api/admin/finance/payouts?limit=0", { who: ADM2 })).status === 400)
    const d = await get(`/api/admin/finance/payouts/${P1.id}`, { who: ADM2 })
    check("admin payout detail: payout + the brand's recent lines", d.status === 200 && d.body.payout.id === P1.id && d.body.payout.brandName && Array.isArray(d.body.entries) && d.body.entries.length > 0, brief(d).slice(0, 160))
    check("admin payout detail: unknown → 404", (await get(`/api/admin/finance/payouts/po_${RUN}_none`, { who: ADM2 })).status === 404)
  }

  /* ===== Batches ===== */
  let batch
  {
    const B = (b, who = ADM1) => post("/api/admin/finance/batches", b, { who })
    check("batch create: admin without Finance role → 403", (await B({ currency: CUR, payoutIds: [P1.id] }, ADM_TS)).status === 403)
    check("batch create: a payout that isn't approved → 422", (await B({ currency: CUR, payoutIds: [P1.id, P3.id] })).status === 422)
    check("batch create: wrong currency for the payouts → 422", (await B({ currency: "NGN", payoutIds: [P1.id] })).status === 422)
    check("batch create: bad currency → 400", (await B({ currency: "ghs" })).status === 400)
    const c = await B({ currency: CUR, payoutIds: [P1.id, P2.id] })
    batch = c.body?.batch
    check("batch create: two approved payouts → 201 open batch with their total", c.status === 201 && batch?.status === "open" && batch.payoutCount === 2 && batch.totalMinor === 11_500, brief(c).slice(0, 200))
    check("batch create: the same payouts can't go in a second batch (422)", (await B({ currency: CUR, payoutIds: [P1.id] })).status === 422)
    const g = await get(`/api/admin/finance/batches/${batch?.id}`, { who: ADM2 })
    check("batch read: batch + its payouts", g.status === 200 && g.body.batch.id === batch.id && g.body.payouts.length === 2, brief(g).slice(0, 120))
    check("batch read: unknown → 404; list includes it", (await get("/api/admin/finance/batches/pob_none", { who: ADM2 })).status === 404 && (await get("/api/admin/finance/batches", { who: ADM2 })).body?.batches?.some((b) => b.id === batch.id))

    check("batch run: admin without Finance role → 403", (await post(`/api/admin/finance/batches/${batch.id}/run`, {}, { who: ADM_TS })).status === 403)
    check("batch run: without a recent re-auth → 403 reauth", isReauth(await post(`/api/admin/finance/batches/${batch.id}/run`, {}, { who: await demo("admin", "adm_2") })))
    check("batch run: unknown batch → 404", (await post(`/api/admin/finance/batches/pob_${RUN}_none/run`, {}, { who: ADM1 })).status === 404)
    const bb = await balances(OWNER)
    const run = await post(`/api/admin/finance/batches/${batch.id}/run`, {}, { who: ADM1 })
    const ab = await balances(OWNER)
    check("batch run: initiatePayout called for each payout; stub transfers stay pending → processing", run.status === 200 && run.body.results?.length === 2 && run.body.results.every((r) => r.status === "processing"), brief(run).slice(0, 240))
    const p1 = (await get(`/api/admin/finance/payouts/${P1.id}`, { who: ADM1 })).body?.payout
    check("batch run: payout processing with a provider ref and sentAt; money still in payout hold", p1?.status === "processing" && !!p1.providerRef && !!p1.sentAt && delta(bb, ab).inPayout === 0 && delta(bb, ab).available === 0, { p1, d: delta(bb, ab) })
    check("reject: a batched payout already sent (processing) can't be rejected (409)", (await post(`/api/admin/finance/payouts/${P1.id}/reject`, { reason: "too late now" }, { who: ADM1 })).status === 409)
    const g2 = await get(`/api/admin/finance/batches/${batch.id}`, { who: ADM1 })
    check("batch run: batch done once every payout is in flight", g2.body?.batch?.status === "done" && !!g2.body.batch.ranAt, g2.body?.batch)
    const rerun = await post(`/api/admin/finance/batches/${batch.id}/run`, {}, { who: ADM1 })
    const p1b = (await get(`/api/admin/finance/payouts/${P1.id}`, { who: ADM1 })).body?.payout
    check("batch run: running it again sends nothing twice (409, payouts unchanged)", rerun.status === 409 && p1b?.status === "processing" && p1b.providerRef === p1.providerRef, brief(rerun))
  }

  /* ===== Transfer outcomes (webhook via the dev simulate route) ===== */
  {
    const sim = (event, payoutId, extra = {}) => post("/api/webhooks/paystack/simulate", { event, data: { reference: transferRef(payoutId), ...extra } }, { who: ADM1 })
    const b = await balances(OWNER)
    const s = await sim("transfer.success", P1.id, { transfer_code: `TRF_${RUN}` })
    const a = await balances(OWNER)
    const p1 = (await get(`/api/admin/finance/payouts/${P1.id}`, { who: ADM1 })).body?.payout
    const paid = await txLines(ADM1, (e) => e.payoutId === P1.id && e.kind === "payout_paid")
    check("transfer.success: payout paid; hold → provider clearing (balanced)", s.status === 200 && p1?.status === "paid" && !!p1.paidAt && paid.size === 1 && balanced(paid) && delta(b, a).inPayout === -6_000 && delta(b, a).available === 0, { s: brief(s).slice(0, 160), p1: p1?.status, d: delta(b, a) })
    const s2 = await sim("transfer.success", P1.id)
    check("transfer.success: a repeated event changes nothing", s2.status === 200 && (await txLines(ADM1, (e) => e.payoutId === P1.id && e.kind === "payout_paid")).size === 1 && (await balances(OWNER)).inPayoutMinor === a.inPayoutMinor)

    const b2 = await balances(OWNER)
    const f = await sim("transfer.failed", P2.id, { reason: "Account closed" })
    const a2 = await balances(OWNER)
    const p2 = (await get(`/api/admin/finance/payouts/${P2.id}`, { who: ADM1 })).body?.payout
    check("transfer.failed: payout failed; hold → available (+5500)", f.status === 200 && p2?.status === "failed" && delta(b2, a2).available === 5_500 && delta(b2, a2).inPayout === -5_500, { s: brief(f).slice(0, 120), p2: p2?.status, err: p2?.lastError, d: delta(b2, a2) })
    const f2 = await sim("transfer.failed", P2.id, { reason: "Account closed" })
    check("transfer.failed: a repeated event changes nothing", f2.status === 200 && (await balances(OWNER)).availableMinor === a2.availableMinor)

    const b3 = await balances(OWNER)
    const rv = await sim("transfer.reversed", P1.id, { reason: "Returned by bank" })
    const a3 = await balances(OWNER)
    const p1r = (await get(`/api/admin/finance/payouts/${P1.id}`, { who: ADM1 })).body?.payout
    const rev = await txLines(ADM1, (e) => e.payoutId === P1.id && e.kind === "payout_reversed")
    check("transfer.reversed: a paid payout reversed → failed (provider_reversed); clearing → available (+6000)", rv.status === 200 && p1r?.status === "failed" && p1r.lastError === "provider_reversed" && rev.size === 1 && balanced(rev) && delta(b3, a3).available === 6_000, { s: brief(rv).slice(0, 160), p1: p1r?.status, err: p1r?.lastError, d: delta(b3, a3) })
    const rv2 = await sim("transfer.reversed", P1.id)
    check("transfer.reversed: a repeated reversal changes nothing", rv2.status === 200 && (await balances(OWNER)).availableMinor === a3.availableMinor && (await txLines(ADM1, (e) => e.payoutId === P1.id && e.kind === "payout_reversed")).size === 1)
    const unk = await post("/api/webhooks/paystack/simulate", { event: "transfer.success", data: { reference: `yt-${"0".repeat(40)}` } }, { who: ADM1 })
    check("transfer: an event for an unknown transfer is ignored (no posting)", unk.status === 200 && ["ignored", "processed"].includes(unk.body?.event?.status ?? unk.body?.result?.status), brief(unk).slice(0, 200))
  }

  /* ===== Separation of duties and payout holds after approval / batching ===== */
  {
    await reauth(ADM1, "admin")
    await reauth(ADM2, "admin")
    const FUND = 10_000
    const fund = await post("/api/admin/finance/adjustments", { brandId: K, currency: CUR, account: "brand_available", direction: "credit", amountMinor: FUND, reason: `${TAG} hold-flow funding`, idempotencyKey: key("adjhold") }, { who: ADM1 })
    check("hold flow: funding adjustment (201)", fund.status === 201, brief(fund))

    // A Finance admin who belongs to the brand can't move its money or change its finance settings.
    const rules0 = (await get(`/api/admin/finance/brands/${K}`, { who: ADM1 })).body?.rules
    const mem = await ledgerDev({ op: "member", brandId: K, userId: "adm_2", role: "viewer", on: true })
    if (mem.status === 200) created.members.push("adm_2")
    const b0 = await balances(OWNER)
    const adjM = await post("/api/admin/finance/adjustments", { brandId: K, currency: CUR, account: "brand_available", direction: "credit", amountMinor: 50_000, reason: `${TAG} self credit`, idempotencyKey: key("adjself") }, { who: ADM2 })
    const b1 = await balances(OWNER)
    const setLift = await SET({ payoutsOnHold: false, holdReason: null }, ADM2)
    const setTier = await SET({ tierOverride: "trusted" }, ADM2)
    const setComm = await SET({ commissionBpsOverride: 0 }, ADM2)
    await ledgerDev({ op: "member", brandId: K, userId: "adm_2", role: "viewer", on: false })
    created.members = created.members.filter((m) => m !== "adm_2")
    check("adjustment: an admin who belongs to the brand can't post one (422, nothing moves)", mem.status === 200 && adjM.status === 422 && b1.availableMinor === b0.availableMinor, `${brief(mem).slice(0, 80)} | ${brief(adjM)} | ${b0.availableMinor}→${b1.availableMinor}`)
    check("brand settings: an admin who belongs to the brand can't change them (hold, tier, commission → 422)", setLift.status === 422 && setTier.status === 422 && setComm.status === 422, [setLift.status, setTier.status, setComm.status])
    const gs = await get(`/api/admin/finance/brands/${K}`, { who: ADM1 })
    check("brand settings: unchanged after the refused member edits", gs.status === 200 && gs.body.rules?.tier === rules0?.tier && gs.body.rules.commissionBps === rules0?.commissionBps && gs.body.rules.onHold === rules0?.onHold, { before: rules0, after: gs.body?.rules })

    // Two payouts approved by two admins; one batched, then the brand is put on hold.
    const A = (id, who) => post(`/api/admin/finance/payouts/${id}/approve`, {}, { who })
    const q5 = await post("/api/studio/payouts", { amountMinor: 5_000, idempotencyKey: key("p5") }, { who: OWNER })
    const q6 = await post("/api/studio/payouts", { amountMinor: 5_000, idempotencyKey: key("p6") }, { who: OWNER })
    P5 = q5.body?.payout
    P6 = q6.body?.payout
    const ap = [await A(P5?.id, ADM1), await A(P5?.id, ADM2), await A(P6?.id, ADM1), await A(P6?.id, ADM2)]
    check("hold flow: two payouts requested and approved by two admins", q5.status === 201 && q6.status === 201 && ap.every((r) => r.status === 200) && ap[1].body.payout.status === "approved" && ap[3].body.payout.status === "approved", [brief(q5).slice(0, 80), brief(q6).slice(0, 80), ...ap.map((r) => r.status)])
    const B = (b) => post("/api/admin/finance/batches", b, { who: ADM2 })
    const cb = await B({ currency: CUR, payoutIds: [P5.id] })
    const hb = cb.body?.batch
    const h = await SET({ payoutsOnHold: true, holdReason: `${TAG} account takeover` })
    const cb6 = await B({ currency: CUR, payoutIds: [P6.id] })
    check("hold: an approved payout of a held brand can't be batched (422)", cb.status === 201 && h.status === 200 && cb6.status === 422, [brief(cb).slice(0, 80), h.status, brief(cb6)])
    const bh = await balances(OWNER)
    const rh = await post(`/api/admin/finance/batches/${hb?.id}/run`, {}, { who: ADM2 })
    const p5h = (await get(`/api/admin/finance/payouts/${P5.id}`, { who: ADM1 })).body?.payout
    const ah = await balances(OWNER)
    check("hold: running a batch doesn't send a held brand's payout (stays approved, no provider ref, money in hold)", rh.status === 200 && rh.body.results?.some((r) => r.payoutId === P5.id && r.status === "on_hold") && p5h?.status === "approved" && !p5h.providerRef && !p5h.sentAt && delta(bh, ah).inPayout === 0, { r: brief(rh).slice(0, 200), p5: p5h?.status, ref: p5h?.providerRef })
    const gb = await get(`/api/admin/finance/batches/${hb?.id}`, { who: ADM1 })
    check("hold: the batch is left partial, not done", gb.body?.batch?.status === "partial", gb.body?.batch)
    const bj = await balances(OWNER)
    const j5 = await post(`/api/admin/finance/payouts/${P5.id}/reject`, { reason: `${TAG} takeover, stop it` }, { who: ADM1 })
    const aj = await balances(OWNER)
    check("reject: a batched payout not yet sent can be rejected (200); hold → available (+5000)", j5.status === 200 && j5.body.payout.status === "rejected" && delta(bj, aj).available === 5_000 && delta(bj, aj).inPayout === -5_000, { s: brief(j5).slice(0, 160), d: delta(bj, aj) })
    const rr = await post(`/api/admin/finance/batches/${hb?.id}/run`, {}, { who: ADM2 })
    const gb2 = await get(`/api/admin/finance/batches/${hb?.id}`, { who: ADM1 })
    check("hold: re-running the batch after the reject sends nothing; batch done", rr.status === 200 && (rr.body.results ?? []).length === 0 && gb2.body?.batch?.status === "done" && (await get(`/api/admin/finance/payouts/${P5.id}`, { who: ADM1 })).body?.payout?.status === "rejected", { r: brief(rr).slice(0, 160), b: gb2.body?.batch?.status })

    // Lifting the hold lets the other payout go out.
    const lift = await SET({ payoutsOnHold: false, holdReason: null })
    const c6 = await B({ currency: CUR, payoutIds: [P6.id] })
    const r6 = await post(`/api/admin/finance/batches/${c6.body?.batch?.id}/run`, {}, { who: ADM2 })
    check("hold: once lifted, the payout batches (201) and is sent (processing)", lift.status === 200 && c6.status === 201 && r6.status === 200 && r6.body.results?.[0]?.payoutId === P6.id && r6.body.results[0].status === "processing", [lift.status, brief(c6).slice(0, 80), brief(r6).slice(0, 160)])
    const s6 = await post("/api/webhooks/paystack/simulate", { event: "transfer.success", data: { reference: transferRef(P6.id), transfer_code: `TRF6_${RUN}` } }, { who: ADM1 })
    check("hold flow: the sent payout settles paid", s6.status === 200 && (await get(`/api/admin/finance/payouts/${P6.id}`, { who: ADM1 })).body?.payout?.status === "paid", brief(s6).slice(0, 160))
  }

  /* ===== Every kit transaction balances; money is conserved ===== */
  {
    const mine = (e) => [Object.values(orders).map((o) => o.id), [P1, P2, P3, P4, P5, P6].map((p) => p?.id)].flat().includes(e.orderId ?? e.payoutId)
    const by = await txLines(ADM1, mine)
    check(`invariant: every one of this run's ${by.size} transactions has debits = credits`, by.size >= 15 && balanced(by), [...by.entries()].filter(([, ls]) => sumDir(ls, "debit") !== sumDir(ls, "credit")).map(([id]) => id))
    const s = (await get("/api/studio/payouts", { who: OWNER })).body
    check("invariant: no brand balance is fractional", s.balances.every((b) => Number.isSafeInteger(b.availableMinor) && Number.isSafeInteger(b.pendingMinor) && Number.isSafeInteger(b.reserveMinor) && Number.isSafeInteger(b.inPayoutMinor)))
    const ov = await get("/api/admin/finance/overview", { who: ADM2 })
    const g = ov.body?.currencies?.find((c) => c.currency === CUR)
    const lhs = g ? g.providerClearingMinor : NaN
    const rhs = g ? g.commissionMinor + g.adjustmentsMinor + g.brandPendingMinor + g.brandAvailableMinor + g.brandReserveMinor + g.brandInPayoutMinor : NaN
    check("invariant: overview — provider clearing (debit) = commission + adjustments + all brand balances (credit), per currency", ov.status === 200 && lhs === rhs, { g, lhs, rhs })
    check("overview: payout queue counts are integers", Array.isArray(ov.body?.payoutQueue) && ov.body.payoutQueue.every((q) => Number.isInteger(q.n) && Number.isInteger(q.total)))
  }

  /* ===== Admin ledger route ===== */
  {
    const l = await get(`/api/admin/finance/ledger?brandId=${K}&account=brand_available&limit=5`, { who: ADM2 })
    check("admin ledger: brand + account filter", l.status === 200 && l.body.entries.length > 0 && l.body.entries.length <= 5 && l.body.entries.every((e) => e.account === "brand_available"), brief(l).slice(0, 120))
    const p = await get(`/api/admin/finance/ledger?currency=${CUR}&account=platform_commission&limit=5`, { who: ADM2 })
    check("admin ledger: platform accounts without brandId", p.status === 200 && p.body.entries.every((e) => e.account === "platform_commission"))
    const bad = [await get("/api/admin/finance/ledger?account=nope", { who: ADM2 }), await get("/api/admin/finance/ledger?limit=500", { who: ADM2 }), await get("/api/admin/finance/ledger?brandId=a.b", { who: ADM2 })]
    check("admin ledger: bad account / limit 500 / unsafe brand id → 400", bad.every((r) => r.status === 400), bad.map((r) => r.status))
  }

  /* ===== Reconciliation ===== */
  {
    check("reconciliation: admin without Finance role → 403", (await post("/api/admin/finance/reconciliation", {}, { who: ADM_TS })).status === 403)
    let r = await post("/api/admin/finance/reconciliation", {}, { who: ADM1, noRetry: true })
    if (r.status === 429) r = await post("/api/admin/finance/reconciliation", {}, { who: ADM2, noRetry: true })
    check("reconciliation: run now → 201 with run id, provider compared, checks counted", r.status === 201 && !!r.body.runId && r.body.providerCompared === true && r.body.checked > 0 && Number.isInteger(r.body.mismatches), brief(r).slice(0, 200))
    const list = await get("/api/admin/finance/reconciliation", { who: ADM2 })
    check("reconciliation: listed among recent runs", list.status === 200 && list.body.runs.some((x) => x.id === r.body?.runId))
    const g = await get(`/api/admin/finance/reconciliation/${r.body?.runId}`, { who: ADM2 })
    const items = g.body?.items ?? []
    check("reconciliation: run finished (ok / mismatches) with its items", g.status === 200 && ["ok", "mismatches"].includes(g.body.run.status) && !!g.body.run.finishedAt && g.body.run.mismatches === items.length, brief(g).slice(0, 200))
    check("invariant: reconciliation finds no unbalanced transaction and no balance drift anywhere in the ledger", !items.some((i) => i.kind === "unbalanced_transaction" || i.kind === "balance_drift"), items.filter((i) => i.kind === "unbalanced_transaction" || i.kind === "balance_drift"))
    const kitRefs = new Set([...Object.values(orders).map((o) => o.id), ...[P1, P2, P3, P4].map((p) => p?.id)])
    check("reconciliation: none of this run's orders or payouts is reported", !items.some((i) => kitRefs.has(i.ref)), items.filter((i) => kitRefs.has(i.ref)))
    // As of two hours from now, this run's captures, refunds and payouts (paid, failed, reversed) fall inside the compared window.
    const ahead = await ledgerDev({ op: "reconcile-ahead", hoursAhead: 2 })
    const ga = ahead.status === 200 ? await get(`/api/admin/finance/reconciliation/${ahead.body.runId}`, { who: ADM2 }) : null
    const aheadItems = ga?.body?.items ?? []
    const orderIdSet = new Set(Object.values(orders).map((o) => o.id))
    const kitPayments = new Set([...Object.values(orders).map((o) => o.checkout?.payment?.id), ...(await brandLines(ADM1)).filter((e) => e.kind === "refund" && orderIdSet.has(e.orderId)).map((e) => e.refundId)].filter(Boolean))
    check("reconciliation vs provider: this run's charges, refunds and payouts (incl. the reversed one) all match", ahead.status === 200 && ahead.body.providerCompared === true && !aheadItems.some((i) => kitRefs.has(i.ref) || kitPayments.has(i.ref)), { s: brief(ahead).slice(0, 160), items: aheadItems.filter((i) => kitRefs.has(i.ref) || kitPayments.has(i.ref)) })
    check("invariant: the forward-dated run also finds no unbalanced transaction or drift", ahead.status === 200 && !aheadItems.some((i) => i.kind === "unbalanced_transaction" || i.kind === "balance_drift"))
    check("reconciliation: unknown run → 404", (await get("/api/admin/finance/reconciliation/rec_none", { who: ADM2 })).status === 404)
    const RS = (id, b, who = ADM2) => post(`/api/admin/finance/reconciliation/items/${id}/resolve`, b, { who })
    check("reconciliation resolve: unknown item → 404; short note → 400", (await RS("rci_none", { note: `${TAG} checked` })).status === 404 && (await RS("rci_none", { note: "x" })).status === 400)
    if (items.length) {
      const it = items[0]
      check("reconciliation resolve: admin without Finance role → 403", (await RS(it.id, { note: `${TAG} checked` }, ADM_TS)).status === 403)
      const rs = await RS(it.id, { note: `${TAG} checked by the ledger kit` })
      check("reconciliation resolve: → resolved with note and resolver", rs.status === 200 && rs.body.item.status === "resolved" && rs.body.item.resolvedBy === "adm_2", brief(rs).slice(0, 160))
      check("reconciliation resolve: resolving again → 409", (await RS(it.id, { note: `${TAG} again` })).status === 409)
    } else check("reconciliation resolve: (no items in this run to resolve)", true)
  }
}

async function cleanup() {
  try {
    const OWNER = await demo("brand", "u_b_multi", K)
    if (created.productId) {
      const cur = (await get(`/api/studio/catalog/products/${created.productId}`, { who: OWNER })).body?.product
      const r = cur ? await post(`/api/studio/catalog/products/${created.productId}/status`, { action: "archive", expectedVersion: cur.version }, { who: OWNER }) : null
      check("cleanup: the kit product is archived", r?.status === 200, brief(r).slice(0, 160))
    }
    if (created.overrides) {
      const ADM = await demo("admin", "adm_1")
      await reauth(ADM, "admin")
      const r = await put(`/api/admin/finance/brands/${K}`, { tierOverride: null, commissionBpsOverride: null, payoutsOnHold: false, holdReason: null }, { who: ADM })
      check("cleanup: Kumasi Thread finance overrides cleared", r.status === 200 && r.body.settings.tierOverride === null && r.body.settings.commissionBpsOverride === null && r.body.settings.payoutsOnHold === false, brief(r).slice(0, 160))
    }
    const gone = []
    for (const userId of created.members) gone.push((await ledgerDev({ op: "member", brandId: K, userId, role: "viewer", on: false })).body?.removed)
    check("cleanup: kit memberships removed", gone.every((n) => n === 1), gone)
    const SHOP = await demo("shopper", SHOPPER)
    check("cleanup: shopper cart emptied", [200, 204].includes((await del("/api/cart", { who: SHOP })).status))
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
export default async function v3ledger(opts = {}) {
  if (opts.base) base = String(opts.base).replace(/\/$/, "")
  quiet = true
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
  console.log(`# ${passed} passed, ${failed} failed (run ${TAG})`)
  process.exit(failed ? 1 : 0)
}
