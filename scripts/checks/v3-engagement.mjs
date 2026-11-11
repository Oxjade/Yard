#!/usr/bin/env node
// ENGAGEMENT v3 live acceptance kit: email outbox (enqueue, dedupe, stub delivery, suppression,
// preferences, unsubscribe tokens), drops (create / edit with expectedVersion / schedule / unschedule /
// cancel, reminders, early access), draws (committed seed hash, reproducible winners, entries,
// purchase windows), per-customer drop limits enforced in checkout (checkDropLimit claims, confirm on
// payment, release on failure), follows + counts, wishlist + merge + back-in-stock + price-drop watch,
// search (full text, facets, currency, filters, suggest), admin reindex, and signals ingest.
// Plain Node 22 (fetch, no deps). Prints one PASS/FAIL line per check; exits non-zero on any failure.
//
//   node scripts/checks/v3-engagement.mjs        (server at YARD_BASE, default http://localhost:3000)
//
// Needs a DEVELOPMENT server with the stub providers (no PAYSTACK_SECRET_KEY, no EMAIL_* keys) and the
// schedulers running (drops tick + email deliver every minute). Takes ~4-5 minutes: the kit schedules
// real drops a couple of minutes ahead and waits for releases, the draw and the scheduler's emails.
// Env:
//   YARD_BASE     server origin
//   YARD_DEV_LOG  the dev server's stdout (sign-up links and stub emails with unsubscribe links are read from it)
//
// Test data: every record carries this run's tag t_v3_engagement_<run> (product title/SKUs, drop names
// and slugs, idempotency keys). Shoppers are long-lived kit accounts whose emails contain
// t_v3_engagement_kit_. The kit's product (in seeded brand Lagos Static) is archived, its drops
// cancelled, and its wishlist / watches / reminders / follows / preferences reset at the end. Seeded
// rows are only read.
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { deflateSync, crc32 } from "node:zlib"

const base = (process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
const DEV_LOG = process.env.YARD_DEV_LOG ?? "/tmp/claude-0/-home-user/e300ec86-35a4-5f82-b2d8-95972eccde0c/scratchpad/dev.log"
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TAG = `t_v3_engagement_${RUN}`
const WORD = `kitengage${RUN}` // one search token unique to this run
const BRAND = "b_lagos_static"
const OTHER_BRAND_PRODUCT = "p_aso_oke_trim_suit_jacket" // Oyin Atelier (sample)
const SAMPLE_PRODUCT = "p_static_moto_jacket" // Lagos Static (sample catalogue: goes through signals ingest)
const FOLLOW_BRAND = "b_orun_studio"
// The dev server trusts one proxy hop: a per-run client address gives this kit its own per-IP rate-limit buckets
// (sign-up mail, sign-in) instead of sharing loopback with every other kit.
const IP = `10.${77 + Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`

let failed = 0
let passed = 0
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail !== "" && detail !== undefined && detail !== null ? (typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 500)) : ""
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${d && !ok ? ` — ${d}` : ""}`)
  return !!ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (s) => createHash("sha256").update(s).digest("hex")

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

async function api(method, path, { jar, body, raw, headers, noOrigin, noRetry429 } = {}) {
  const h = { "X-Forwarded-For": IP, ...(noOrigin ? {} : { Origin: base, "X-Yard-Client": "1" }), ...(headers ?? {}) }
  if (jar?.cookie) h.cookie = jar.cookie
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
      if (res.status === 429 && !noRetry429 && attempt < 3) {
        await sleep(Math.min(65, Number(res.headers.get("retry-after") ?? 10)) * 1000)
        continue
      }
      return { status: res.status, body: json, text, headers: res.headers }
    } catch (e) {
      if (attempt >= 12) throw e // the guard restarts a dead server within ~2 min
      await sleep(10_000)
    }
  }
}
const get = (p, o) => api("GET", p, o)
// Drop creates need an Idempotency-Key (one per action): the kit sends a fresh one unless a test sets its own.
const post = (p, body, o = {}) => api("POST", p, { ...o, body, headers: p === "/api/drops" ? { "Idempotency-Key": `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, ...(o.headers ?? {}) } : o.headers })
const patch = (p, body, o = {}) => api("PATCH", p, { ...o, body })
const del = (p, o = {}) => api("DELETE", p, o)
const brief = (r) => `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message} ${r.body.error.fields ? JSON.stringify(r.body.error.fields) : ""}` : (r.text ?? "").slice(0, 300)}`

async function demo(actor, account, brandId) {
  const jar = new Jar()
  const r = await post("/api/auth/demo", { actor, account, ...(brandId ? { brandId } : {}) }, { jar })
  if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
  return jar
}

const KIT_PW = "Kit-engagement-v3-pw!"
const kitEmail = (label) => `t_v3_engagement_kit_${label}@example.com`

/** Long-lived kit shoppers: sign in, or sign up once and verify through the stub email in the dev log. */
async function kitShopper(label) {
  const email = kitEmail(label)
  const jar = new Jar()
  const r = await post("/api/auth/sign-in", { email, password: KIT_PW, actor: "shopper" }, { jar })
  if (r.status === 200) return { jar, email }
  const s = await post("/api/auth/sign-up", { name: `Engagement Kit ${label}`, email, password: KIT_PW })
  if (s.status !== 200) throw new Error(`sign-up ${label}: ${brief(s)}`)
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
  return { jar, email }
}

/** Outbox rows for a kit address (AUTH's dev helper, t_v3_ addresses only), newest first. */
async function outbox(email) {
  const r = await get(`/api/auth/dev?op=outbox&email=${encodeURIComponent(email)}`)
  return r.status === 200 ? r.body.emails : []
}
/** Waits until `pred(rows)` holds for the address's outbox rows created since `since`. */
async function waitOutbox(email, since, pred, timeoutMs = 90_000) {
  const t0 = Date.now()
  let rows = []
  while (Date.now() - t0 < timeoutMs) {
    rows = (await outbox(email)).filter((e) => new Date(e.createdAt).getTime() >= since - 2000)
    if (pred(rows)) return rows
    await sleep(3000)
  }
  return rows
}

/** The unsubscribe token from the newest stub email to `email` printed in the dev log after `marker`. */
function unsubTokenFromLog(email, sinceOffset) {
  try {
    const buf = readFileSync(DEV_LOG)
    // Byte offsets (the log has multi-byte characters); a restarted server starts a fresh log.
    const log = buf.subarray(buf.length >= sinceOffset ? sinceOffset : 0).toString("utf8")
    const at = log.lastIndexOf(`to: ${email}`)
    if (at < 0) return null
    const m = /unsubscribe\?token=([^\s]+)/.exec(log.slice(at, at + 4000))
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}
const logSize = () => {
  try {
    return readFileSync(DEV_LOG).length
  } catch {
    return 0
  }
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
    for (let x = 0; x < w; x++) rows.push(Buffer.from([(x * 3) & 255, 120, (y * 4) & 255]))
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
}
async function uploadBrandImage(jar) {
  const boundary = `----yardkit${RUN}`
  const buf = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}.png"\r\nContent-Type: image/png\r\n\r\n`),
    pngBytes(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return api("POST", "/api/uploads?purpose=social_post&as=brand", { jar, raw: buf, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(buf.length) } })
}

const iso = (ms) => new Date(ms).toISOString()
async function waitUntil(ms, why) {
  const left = ms - Date.now()
  if (left > 0) {
    console.log(`# waiting ${Math.ceil(left / 1000)}s ${why}`)
    await sleep(left)
  }
}

/* ---------------- the kit ---------------- */

const shipTo = { name: "Engagement Kit", line1: "1 Kit Street", city: "Lagos", country: "NG", phone: "+234 800 000 0000" }
const cleanup = []

async function main() {
  console.log(`# ENGAGEMENT v3 kit against ${base}, run ${TAG}`)

  const OWNER = await demo("brand", "u_b_tobi", BRAND)
  const DESIGNER = await demo("brand", "u_b_designer", BRAND)
  const FULFIL = await demo("brand", "u_b_kemi", BRAND)
  const VIEWER = await demo("brand", "u_b_viewer", BRAND)
  const OTHER = await demo("brand", "u_b_minji", "b_null_form")
  const ADMIN = await demo("admin", "adm_1")
  const ANON = new Jar()

  const S1 = await kitShopper("s1")
  const S2 = await kitShopper("s2")
  const S3 = await kitShopper("s3")
  const shoppers = [S1, S2, S3]
  for (const s of shoppers) {
    const r = await get("/api/session", { jar: s.jar })
    s.id = r.body?.shopper?.id
  }
  check("setup: three kit shoppers signed in", shoppers.every((s) => !!s.id), shoppers.map((s) => s.id))

  // Reset state a previous run may have left: preferences all on (also lifts unsubscribes), S2 not following Lagos Static.
  const allOn = { drops: true, price_drops: true, back_in_stock: true, brand_news: true }
  for (const s of shoppers) await patch("/api/notifications/preferences?as=shopper", { email: allOn, inApp: allOn }, { jar: s.jar })
  await del(`/api/follows/${BRAND}`, { jar: S2.jar })
  await del(`/api/follows/${FOLLOW_BRAND}`, { jar: S1.jar })
  await post("/api/follows", { brandId: BRAND }, { jar: S1.jar }) // S1 is the early-access follower

  /* ===== Outbox keeps no raw auth token once a row is finished ===== */
  {
    // A 64-letter TLD passes sign-up validation but not the outbox's address check, so the verification
    // row is stored 'failed' at once: it must not keep the raw single-use token AUTH only stores hashed.
    const em = `${TAG}_tokscrub@example.${"a".repeat(64)}`
    const t0 = Date.now()
    const su = await post("/api/auth/sign-up", { name: "Engagement Kit Scrub", email: em, password: KIT_PW })
    const rows = await waitOutbox(em, t0, (r) => r.some((e) => e.template === "verification"), 20_000)
    const row = rows.find((e) => e.template === "verification")
    check(
      "outbox: a finished (failed) verification row keeps no raw token link",
      su.status === 200 && row?.status === "failed" && row.vars?.url === undefined && !/token=/i.test(JSON.stringify(row.vars ?? {})),
      `${brief(su)} ${JSON.stringify(row)}`,
    )
  }

  /* ===== Setup: a kit product in Lagos Static ===== */
  const up = await uploadBrandImage(OWNER)
  const mediaId = up.body?.media?.id
  check("setup: brand photo upload", up.status === 201 && !!mediaId, brief(up))
  const c1 = await post(
    "/api/studio/catalog/products",
    {
      images: mediaId ? [{ mediaId, alt: TAG }] : [],
      title: `${WORD} Jacket ${TAG}`,
      description: `Engagement kit jacket ${WORD}.`,
      categorySlug: "fashion",
      priceMinor: 20_000,
      options: [{ name: "Size", values: ["XS", "S", "M", "L", "XL", "XXL"].map((value) => ({ value })) }],
      variants: [
        { sku: `${TAG}-XS`, options: { Size: "XS" } },
        { sku: `${TAG}-S`, options: { Size: "S" }, initialStock: 30 },
        { sku: `${TAG}-M`, options: { Size: "M" }, initialStock: 30 },
        { sku: `${TAG}-L`, options: { Size: "L" }, initialStock: 10 },
        { sku: `${TAG}-XL`, options: { Size: "XL" }, initialStock: 10 },
        { sku: `${TAG}-XXL`, options: { Size: "XXL" }, initialStock: 10 },
      ],
    },
    { jar: OWNER },
  )
  const P = c1.body?.product
  if (!check("setup: kit product created", c1.status === 201 && !!P, brief(c1))) throw new Error("setup failed")
  cleanup.push(async () => {
    const v = (await get(`/api/studio/catalog/products/${P.id}`, { jar: OWNER })).body?.product?.version
    if (v) await del(`/api/studio/catalog/products/${P.id}?expectedVersion=${v}`, { jar: OWNER })
  })
  const pub = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: P.version }, { jar: OWNER })
  if (!check("setup: kit product published", pub.status === 200, brief(pub))) throw new Error("setup failed")
  const V = Object.fromEntries(P.variants.map((v) => [v.options.Size, v.id]))
  const productVersion = async () => (await get(`/api/studio/catalog/products/${P.id}`, { jar: OWNER })).body?.product?.version

  /* ===== Search (the product is indexed by CATALOG after commit) ===== */
  {
    let s
    for (let i = 0; i < 10; i++) {
      s = await get(`/api/search?q=${WORD}&currency=NGN`)
      if (s.body?.total >= 1) break
      await sleep(1000)
    }
    const it = s.body?.items?.[0]
    check("search: the new product is found by a word of its title", s.status === 200 && s.body.total === 1 && it?.productId === P.id, brief(s))
    check("search: item carries brand price and a display price in the shopper's currency", it?.price?.amount === 20_000 && it.price.currency === "NGN" && it.display?.currency === "NGN" && it.display.amount === 20_000 && it.available === 90, JSON.stringify(it))
    check("search: facets cover categories, brands and price buckets in NGN", s.body?.facets?.categories?.some((c) => c.value === "fashion" && c.count === 1) && s.body.facets.brands?.some((b) => b.value === BRAND && b.count === 1) && s.body.facets.price?.currency === "NGN" && s.body.facets.price.buckets?.reduce((n, b) => n + b.count, 0) === 1, JSON.stringify(s.body?.facets))
    const usd = await get(`/api/search?q=${WORD}&currency=USD`)
    const u = usd.body?.items?.[0]
    check("search: currency=USD converts the display price (smaller), keeps the brand price", usd.status === 200 && u?.display?.currency === "USD" && u.display.amount > 0 && u.display.amount < 20_000 && u.price.amount === 20_000, JSON.stringify(u))
    check("search: bucket edges are converted into the shopper's currency", usd.body?.facets?.price?.buckets?.[1]?.minMinor === 5000 && s.body?.facets?.price?.buckets?.[1]?.minMinor > 5000, JSON.stringify([usd.body?.facets?.price?.buckets?.[1], s.body?.facets?.price?.buckets?.[1]]))
    const inRange = await get(`/api/search?q=${WORD}&currency=NGN&minPrice=15000&maxPrice=25000`)
    const above = await get(`/api/search?q=${WORD}&currency=NGN&minPrice=25000`)
    const below = await get(`/api/search?q=${WORD}&currency=NGN&maxPrice=15000`)
    check("search: price bounds in the shopper's currency filter (in range / above / below)", inRange.body?.total === 1 && above.body?.total === 0 && below.body?.total === 0, [inRange.body?.total, above.body?.total, below.body?.total])
    const cat = await get(`/api/search?q=${WORD}&currency=NGN&category=streetwear`)
    const brandF = await get(`/api/search?q=${WORD}&currency=NGN&brandIds=b_null_form`)
    const brandOk = await get(`/api/search?q=${WORD}&currency=NGN&brandIds=b_null_form&brandIds=${BRAND}`)
    check("search: category and brand filters", cat.body?.total === 0 && brandF.body?.total === 0 && brandOk.body?.total === 1, [cat.body?.total, brandF.body?.total, brandOk.body?.total])
    check("search: the category facet ignores the category filter (still lists fashion)", cat.body?.facets?.categories?.some((c) => c.value === "fashion"), JSON.stringify(cat.body?.facets?.categories))
    const asc = await get("/api/search?q=jacket&currency=USD&sort=price_asc&limit=48")
    const prices = (asc.body?.items ?? []).map((x) => x.display.amount)
    check("search: sort=price_asc orders by converted price", asc.status === 200 && prices.length >= 2 && prices.every((p, i) => i === 0 || p >= prices[i - 1]), prices)
    const p1 = await get("/api/search?currency=USD&limit=2")
    const p2 = p1.body?.nextCursor ? await get(`/api/search?currency=USD&limit=2&cursor=${p1.body.nextCursor}`) : null
    check("search: pagination with nextCursor gives the next page", p1.status === 200 && p1.body.items.length === 2 && p2?.status === 200 && p2.body.items.length >= 1 && !p2.body.items.some((x) => p1.body.items.some((y) => y.productId === x.productId)), brief(p2 ?? p1))
    const brandHit = await get("/api/search?q=lagos%20static&currency=NGN")
    check("search: brand matches come back on page 1", brandHit.status === 200 && brandHit.body.brands?.some((b) => b.brandId === BRAND), JSON.stringify(brandHit.body?.brands))
    const weird = await get(`/api/search?q=${encodeURIComponent("'&|!:*() <-> \\ ;--")}&currency=NGN`)
    check("search: tsquery operators in q are harmless (200)", weird.status === 200, brief(weird))
    const instock = await get(`/api/search?q=${WORD}&currency=NGN&inStock=1`)
    check("search: inStock=1 keeps a product with stock", instock.body?.total === 1, brief(instock))
    check("search: unknown currency is 400", (await get("/api/search?q=a&currency=XYZ")).status === 400)
    check("search: unknown sort is 400", (await get("/api/search?q=a&sort=cheap")).status === 400)
    check("search: limit 49 is 400", (await get("/api/search?q=a&limit=49")).status === 400)
    check("search: non-numeric cursor is 400", (await get("/api/search?q=a&cursor=abc")).status === 400)
    check("search: negative minPrice is 400", (await get("/api/search?q=a&minPrice=-1")).status === 400)
    const sug = await get(`/api/search/suggest?q=${WORD.slice(0, -2)}`)
    check("suggest: a prefix suggests the product", sug.status === 200 && sug.body.products?.some((p) => p.productId === P.id), brief(sug))
    const sb = await get("/api/search/suggest?q=lagos")
    check("suggest: brands are suggested", sb.status === 200 && sb.body.brands?.some((b) => b.brandId === BRAND), brief(sb))
    const scoped = await get(`/api/search/suggest?q=${WORD.slice(0, -2)}&scoped=1&category=fashion&currency=NGN`)
    const scopedOut = await get(`/api/search/suggest?q=${WORD.slice(0, -2)}&scoped=1&category=streetwear&currency=NGN`)
    check("suggest: scoped=1 counts each completion within the listing's filters", scoped.status === 200 && scoped.body.terms?.some((t) => t.count === 1) && scopedOut.body?.terms?.every((t) => t.count === 0), JSON.stringify([scoped.body?.terms, scopedOut.body?.terms]))
    const empty = await get("/api/search/suggest?q=")
    check("suggest: empty q gives nothing", empty.status === 200 && empty.body.products.length === 0 && empty.body.brands.length === 0, brief(empty))
    check("suggest: q over 100 chars is 400", (await get(`/api/search/suggest?q=${"a".repeat(101)}`)).status === 400)
  }

  /* ===== Reindex (admin only) ===== */
  {
    check("reindex: anonymous is 401", (await post("/api/search/reindex", undefined, { jar: ANON })).status === 401)
    check("reindex: a shopper is 401", (await post("/api/search/reindex", undefined, { jar: S1.jar })).status === 401)
    check("reindex: a brand owner is 401", (await post("/api/search/reindex", undefined, { jar: OWNER })).status === 401)
    // 2 per 5 min per admin: use the first admin with budget left (re-runs inside 5 minutes).
    let r
    for (const acct of ["adm_5", "adm_4", "adm_3", "adm_1"]) {
      r = await post("/api/search/reindex", undefined, { jar: await demo("admin", acct), noRetry429: true })
      if (r.status !== 429) break
    }
    check("reindex: any admin rebuilds the index (brands + products counted)", r.status === 200 && r.body.brands > 0 && r.body.products > 0, brief(r))
    const after = await get(`/api/search?q=${WORD}&currency=NGN`)
    check("reindex: the kit product is still indexed afterwards", after.body?.total === 1, brief(after))
  }

  /* ===== Notification preferences ===== */
  {
    check("prefs: no session is 401", (await get("/api/notifications/preferences?as=shopper", { jar: ANON })).status === 401)
    check("prefs: missing ?as= is 400", (await get("/api/notifications/preferences", { jar: S1.jar })).status === 400)
    const g = await get("/api/notifications/preferences?as=shopper", { jar: S1.jar })
    check("prefs: GET shows every category on (after reset)", g.status === 200 && Object.values(g.body.preferences.email).every(Boolean) && Object.values(g.body.preferences.inApp).every(Boolean) && Object.keys(g.body.preferences.email).length === 4, brief(g))
    const p = await patch("/api/notifications/preferences?as=shopper", { email: { price_drops: false } }, { jar: S1.jar })
    check("prefs: PATCH merges one flag", p.status === 200 && p.body.preferences.email.price_drops === false && p.body.preferences.email.drops === true && p.body.preferences.inApp.price_drops === true, brief(p))
    const g2 = await get("/api/notifications/preferences?as=shopper", { jar: S1.jar })
    check("prefs: the change is stored", g2.body?.preferences?.email?.price_drops === false)
    await patch("/api/notifications/preferences?as=shopper", { email: { price_drops: true } }, { jar: S1.jar })
    check("prefs: unknown category is 400", (await patch("/api/notifications/preferences?as=shopper", { email: { orders: false } }, { jar: S1.jar })).status === 400)
    check("prefs: non-boolean is 400", (await patch("/api/notifications/preferences?as=shopper", { email: { drops: "no" } }, { jar: S1.jar })).status === 400)
    check("prefs: unknown top-level key is 400", (await patch("/api/notifications/preferences?as=shopper", { sms: {} }, { jar: S1.jar })).status === 400)
    check("prefs: a write without Origin is refused (403)", (await api("PATCH", "/api/notifications/preferences?as=shopper", { jar: S1.jar, body: { email: { drops: true } }, noOrigin: true })).status === 403)
    const b = await get("/api/notifications/preferences?as=brand", { jar: OWNER })
    check("prefs: a brand session reads its own (as=brand)", b.status === 200 && !!b.body.preferences, brief(b))
    const a = await get("/api/notifications/preferences?as=admin", { jar: ADMIN })
    check("prefs: an admin session reads its own (as=admin)", a.status === 200 && !!a.body.preferences, brief(a))
    check("prefs: as=admin with only a shopper session is 401", (await get("/api/notifications/preferences?as=admin", { jar: S1.jar })).status === 401)
    // S3 turns drop emails off: its drop emails must end up suppressed (checked later).
    const off = await patch("/api/notifications/preferences?as=shopper", { email: { drops: false } }, { jar: S3.jar })
    check("prefs: S3 turns drop emails off", off.status === 200 && off.body.preferences.email.drops === false, brief(off))
  }

  /* ===== Unsubscribe: validation (tokens come from real emails below) ===== */
  {
    check("unsubscribe: GET without token is 400", (await get("/api/notifications/preferences/unsubscribe")).status === 400)
    check("unsubscribe: GET with a forged token is 400", (await get(`/api/notifications/preferences/unsubscribe?token=${"eyJlIjoieEB5LnoiLCJjIjoiYWxsIn0"}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).status === 400)
    const forged = await api("POST", `/api/notifications/preferences/unsubscribe?token=${"eyJlIjoieEB5LnoiLCJjIjoiYWxsIn0"}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, { noOrigin: true })
    check("unsubscribe: POST with a forged token is 400", forged.status === 400, brief(forged))
  }

  /* ===== Follows ===== */
  {
    check("follows: list without a session is 401", (await get("/api/follows", { jar: ANON })).status === 401)
    check("follows: follow without a session is 401", (await post("/api/follows", { brandId: FOLLOW_BRAND }, { jar: ANON })).status === 401)
    check("follows: a brand session is not a shopper (401)", (await post("/api/follows", { brandId: FOLLOW_BRAND }, { jar: OWNER })).status === 401)
    check("follows: unknown brand is 404", (await post("/api/follows", { brandId: `b_${RUN}_nope` }, { jar: S1.jar })).status === 404)
    check("follows: malformed brandId is 400", (await post("/api/follows", { brandId: "a b/../c" }, { jar: S1.jar })).status === 400)
    check("follows: unknown field is 400", (await post("/api/follows", { brandId: FOLLOW_BRAND, at: 1 }, { jar: S1.jar })).status === 400)
    const f = await post("/api/follows", { brandId: FOLLOW_BRAND }, { jar: S1.jar })
    check("follows: follow → following with a follower count", f.status === 200 && f.body.following === true && Number.isInteger(f.body.followers), brief(f))
    const f2 = await post("/api/follows", { brandId: FOLLOW_BRAND }, { jar: S1.jar })
    check("follows: following again is idempotent (count unchanged)", f2.status === 200 && f2.body.followers === f.body.followers, `${f.body?.followers} → ${f2.body?.followers}`)
    const l = await get("/api/follows", { jar: S1.jar })
    check("follows: list shows the brand with its follower count", l.status === 200 && l.body.items.some((x) => x.brandId === FOLLOW_BRAND && x.followers === f.body.followers), brief(l))
    check("follows: another shopper's list doesn't", !(await get("/api/follows", { jar: S2.jar })).body?.items?.some((x) => x.brandId === FOLLOW_BRAND))
    const c = await get(`/api/follows/counts?brandIds=${FOLLOW_BRAND}&brandIds=${BRAND}&brandIds=b_${RUN}_nope`)
    check("follows: public counts for several brands (unknown ids left out)", c.status === 200 && Number.isInteger(c.body.counts[FOLLOW_BRAND]) && Number.isInteger(c.body.counts[BRAND]) && !(`b_${RUN}_nope` in c.body.counts), brief(c))
    const one = await get(`/api/follows/counts?brandIds=${FOLLOW_BRAND}`)
    check("follows: counts with a single brandIds param", one.status === 200 && Number.isInteger(one.body.counts[FOLLOW_BRAND]), brief(one))
    check("follows: counts without brandIds is 400", (await get("/api/follows/counts")).status === 400)
    const u = await del(`/api/follows/${FOLLOW_BRAND}`, { jar: S1.jar })
    check("follows: unfollow → count down by one", u.status === 200 && u.body.following === false && u.body.followers === f.body.followers - 1, brief(u))
    const u2 = await del(`/api/follows/${FOLLOW_BRAND}`, { jar: S1.jar })
    check("follows: unfollowing again is idempotent", u2.status === 200 && u2.body.followers === u.body.followers, brief(u2))
    check("follows: unfollow an unknown brand is 404", (await del(`/api/follows/b_${RUN}_nope`, { jar: S1.jar })).status === 404)
    check("follows: unfollow without a session is 401", (await del(`/api/follows/${FOLLOW_BRAND}`, { jar: ANON })).status === 401)
  }

  /* ===== Signals ingest still drives the same follow / wishlist state ===== */
  {
    const s = await post("/api/signals", { kind: "follow", brandId: FOLLOW_BRAND }, { jar: S1.jar })
    check("signals: POST /api/signals follow is accepted", s.status === 204 || s.status === 200, brief(s))
    check("signals: a follow via signals shows in /api/follows", (await get("/api/follows", { jar: S1.jar })).body?.items?.some((x) => x.brandId === FOLLOW_BRAND))
    await post("/api/signals", { kind: "unfollow", brandId: FOLLOW_BRAND }, { jar: S1.jar })
    check("signals: an unfollow via signals removes it", !(await get("/api/follows", { jar: S1.jar })).body?.items?.some((x) => x.brandId === FOLLOW_BRAND))
    check("signals: follow without a session is still 401", (await post("/api/signals", { kind: "follow", brandId: FOLLOW_BRAND }, { jar: ANON })).status === 401)
    const w = await post("/api/signals", { kind: "wishlist_add", productId: SAMPLE_PRODUCT }, { jar: S2.jar })
    check("signals: wishlist_add via signals shows in /api/wishlist", (w.status === 204 || w.status === 200) && (await get("/api/wishlist", { jar: S2.jar })).body?.items?.some((x) => x.productId === SAMPLE_PRODUCT), brief(w))
    await post("/api/signals", { kind: "wishlist_remove", productId: SAMPLE_PRODUCT }, { jar: S2.jar })
    check("signals: wishlist_remove via signals removes it", !(await get("/api/wishlist", { jar: S2.jar })).body?.items?.some((x) => x.productId === SAMPLE_PRODUCT))
  }

  /* ===== Wishlist, merge, back in stock ===== */
  {
    check("wishlist: list without a session is 401", (await get("/api/wishlist", { jar: ANON })).status === 401)
    check("wishlist: save without a session is 401", (await post("/api/wishlist", { productId: P.id }, { jar: ANON })).status === 401)
    check("wishlist: unknown product is 404", (await post("/api/wishlist", { productId: `p_${RUN}_nope` }, { jar: S1.jar })).status === 404)
    check("wishlist: malformed productId is 400", (await post("/api/wishlist", { productId: "../x" }, { jar: S1.jar })).status === 400)
    const a = await post("/api/wishlist", { productId: P.id }, { jar: S1.jar })
    check("wishlist: save a Studio product (direct write)", a.status === 200 && a.body.saved === true && a.body.verdict === "direct", brief(a))
    const a2 = await post("/api/wishlist", { productId: P.id }, { jar: S1.jar })
    check("wishlist: saving again is idempotent", a2.status === 200)
    const sp = await post("/api/wishlist", { productId: SAMPLE_PRODUCT }, { jar: S1.jar })
    check("wishlist: save a sample product (through signals ingest)", sp.status === 200 && sp.body.saved === true && sp.body.verdict !== "direct", brief(sp))
    const l = await get("/api/wishlist", { jar: S1.jar })
    const mine = l.body?.items?.find((x) => x.productId === P.id)
    check("wishlist: list carries live price, stock and title", l.status === 200 && mine?.price?.amount === 20_000 && mine.price.currency === "NGN" && mine.available === 90 && mine.listed === true && mine.title?.includes(WORD), JSON.stringify(mine))
    check("wishlist: each product is listed once", l.body?.items?.filter((x) => x.productId === P.id).length === 1)
    check("wishlist: another shopper doesn't see it", !(await get("/api/wishlist", { jar: S2.jar })).body?.items?.some((x) => x.productId === P.id))
    const d1 = await del(`/api/wishlist/${SAMPLE_PRODUCT}`, { jar: S1.jar })
    check("wishlist: remove", d1.status === 200 && d1.body.saved === false && !(await get("/api/wishlist", { jar: S1.jar })).body.items.some((x) => x.productId === SAMPLE_PRODUCT), brief(d1))
    check("wishlist: remove again is idempotent", (await del(`/api/wishlist/${SAMPLE_PRODUCT}`, { jar: S1.jar })).status === 200)
    check("wishlist: remove without a session is 401", (await del(`/api/wishlist/${P.id}`, { jar: ANON })).status === 401)

    // Merge (S2: nothing saved yet).
    await del(`/api/wishlist/${P.id}`, { jar: S2.jar })
    await del(`/api/wishlist/${SAMPLE_PRODUCT}`, { jar: S2.jar })
    await del(`/api/follows/${FOLLOW_BRAND}`, { jar: S2.jar })
    check("merge: without a session is 401", (await post("/api/wishlist/merge", { productIds: [], brandIds: [] }, { jar: ANON })).status === 401)
    check("merge: unknown field is 400", (await post("/api/wishlist/merge", { productIds: [], brandIds: [], reminders: [] }, { jar: S2.jar })).status === 400)
    check("merge: over 200 ids is 400", (await post("/api/wishlist/merge", { productIds: Array.from({ length: 201 }, (_, i) => `p_${i}`) }, { jar: S2.jar })).status === 400)
    const m = await post("/api/wishlist/merge", { productIds: [P.id, SAMPLE_PRODUCT, `p_${RUN}_nope`, P.id], brandIds: [FOLLOW_BRAND, `b_${RUN}_nope`] }, { jar: S2.jar })
    check("merge: adds new saves and follows, skips unknown ids", m.status === 200 && m.body.saved === 2 && m.body.followed === 1 && m.body.skipped?.length === 2 && m.body.skipped.includes(`p_${RUN}_nope`) && m.body.skipped.includes(`b_${RUN}_nope`), brief(m))
    const m2 = await post("/api/wishlist/merge", { productIds: [P.id, SAMPLE_PRODUCT], brandIds: [FOLLOW_BRAND] }, { jar: S2.jar })
    check("merge: merging again changes nothing (idempotent)", m2.status === 200 && m2.body.saved === 0 && m2.body.followed === 0 && m2.body.skipped.length === 0, brief(m2))
    const w2 = await get("/api/wishlist", { jar: S2.jar })
    check("merge: merged items are in the wishlist and follows", w2.body?.items?.some((x) => x.productId === P.id) && w2.body.items.some((x) => x.productId === SAMPLE_PRODUCT) && (await get("/api/follows", { jar: S2.jar })).body?.items?.some((x) => x.brandId === FOLLOW_BRAND))
    await del(`/api/wishlist/${SAMPLE_PRODUCT}`, { jar: S2.jar })
    await del(`/api/follows/${FOLLOW_BRAND}`, { jar: S2.jar })

    // Back in stock (XS has no stock).
    check("back-in-stock: without a session is 401", (await post("/api/wishlist/back-in-stock", { variantId: V.XS }, { jar: ANON })).status === 401)
    check("back-in-stock: unknown variant is 404", (await post("/api/wishlist/back-in-stock", { variantId: `pv_${RUN}_nope` }, { jar: S1.jar })).status === 404)
    check("back-in-stock: malformed variant id is 400", (await post("/api/wishlist/back-in-stock", { variantId: "a b" }, { jar: S1.jar })).status === 400)
    const inStock = await post("/api/wishlist/back-in-stock", { variantId: V.S }, { jar: S1.jar })
    check("back-in-stock: an in-stock variant is 409", inStock.status === 409, brief(inStock))
    const hidden = await post(`/api/admin/catalog/products/${P.id}/moderation`, { hidden: true, reason: `${TAG} back-in-stock visibility check` }, { jar: ADMIN })
    let hiddenWatch = null
    let restored = null
    if (hidden.status === 200) {
      try {
        hiddenWatch = await post("/api/wishlist/back-in-stock", { variantId: V.XL }, { jar: S1.jar })
      } finally {
        restored = await post(`/api/admin/catalog/products/${P.id}/moderation`, { hidden: false, reason: `${TAG} restore visibility check` }, { jar: ADMIN })
      }
    }
    check("back-in-stock: hidden product variants cannot be watched", hidden.status === 200 && hiddenWatch?.status === 404, `${brief(hidden)}; ${hiddenWatch ? brief(hiddenWatch) : "watch not attempted"}`)
    check("back-in-stock: restore product after hidden-variant check", restored?.status === 200, restored ? brief(restored) : "restore not attempted")
    const b = await post("/api/wishlist/back-in-stock", { variantId: V.XS }, { jar: S1.jar })
    check("back-in-stock: watch a sold-out variant → 201", b.status === 201 && b.body.watching === true && b.body.productId === P.id, brief(b))
    const b2 = await post("/api/wishlist/back-in-stock", { variantId: V.XS }, { jar: S1.jar })
    check("back-in-stock: watching again is idempotent (201)", b2.status === 201, brief(b2))
    const wl = await get("/api/wishlist", { jar: S1.jar })
    check("back-in-stock: the wishlist shows the watched variant", wl.body?.items?.find((x) => x.productId === P.id)?.backInStockVariantIds?.join() === V.XS, JSON.stringify(wl.body?.items?.find((x) => x.productId === P.id)))
    const c = await del(`/api/wishlist/back-in-stock/${V.XS}`, { jar: S1.jar })
    check("back-in-stock: stop watching", c.status === 200 && c.body.watching === false && (await get("/api/wishlist", { jar: S1.jar })).body.items.find((x) => x.productId === P.id)?.backInStockVariantIds?.length === 0, brief(c))
    check("back-in-stock: stop watching without a session is 401", (await del(`/api/wishlist/back-in-stock/${V.XS}`, { jar: ANON })).status === 401)
    await post("/api/wishlist/back-in-stock", { variantId: V.XS }, { jar: S1.jar })
    await post("/api/wishlist/back-in-stock", { variantId: V.XS }, { jar: S3.jar })
    await patch("/api/notifications/preferences?as=shopper", { email: { back_in_stock: false } }, { jar: S3.jar })
  }

  /* ===== Watch job: price drop + restock emails (dedupe, preferences) ===== */
  {
    check("watch(dev): non-admin is 401", (await post("/api/wishlist/dev/watch", undefined, { jar: S1.jar })).status === 401)
    const t0 = Date.now()
    const w1 = await post("/api/wishlist/dev/watch", undefined, { jar: ADMIN })
    check("watch(dev): runs the job (snapshot)", w1.status === 200 && typeof w1.body.priceDrops === "number", brief(w1))
    // Restock XS and lower the price by 10%.
    const st = await post(`/api/studio/catalog/variants/${V.XS}/stock`, { mode: "set", qty: 5, reason: "restock" }, { jar: OWNER })
    check("setup: brand restocks XS", st.status === 200, brief(st))
    const pr = await patch(`/api/studio/catalog/products/${P.id}`, { priceMinor: 18_000, expectedVersion: await productVersion() }, { jar: OWNER })
    check("setup: brand lowers the price to 18000", pr.status === 200, brief(pr))
    const w2 = await post("/api/wishlist/dev/watch", undefined, { jar: ADMIN })
    check("watch: a price drop and a variant restock are detected", w2.status === 200 && w2.body.priceDrops >= 1 && w2.body.variantRestocks >= 2, brief(w2))
    const w3 = await post("/api/wishlist/dev/watch", undefined, { jar: ADMIN })
    check("watch: running again detects nothing new for the kit product", w3.status === 200, brief(w3))
    const rows1 = await waitOutbox(S1.email, t0, (r) => r.some((e) => e.template === "price_drop" && e.status === "stub") && r.some((e) => e.template === "back_in_stock" && e.status === "stub"), 30_000)
    check("email: price_drop email queued and handled by the stub (status stub, never sent)", rows1.filter((e) => e.template === "price_drop").length === 1 && rows1.find((e) => e.template === "price_drop")?.status === "stub", JSON.stringify(rows1.map((e) => [e.template, e.status])))
    check("email: back_in_stock email to the watcher (status stub)", rows1.filter((e) => e.template === "back_in_stock").length === 1 && rows1.find((e) => e.template === "back_in_stock")?.status === "stub", JSON.stringify(rows1.map((e) => [e.template, e.status])))
    check("email: link vars are made absolute Yard URLs", typeof rows1.find((e) => e.template === "price_drop")?.vars?.url === "string", JSON.stringify(rows1.find((e) => e.template === "price_drop")?.vars))
    const rows3 = await waitOutbox(S3.email, t0, (r) => r.some((e) => e.template === "back_in_stock"), 20_000)
    check("email: back_in_stock to a shopper who turned it off is stored as suppressed", rows3.filter((e) => e.template === "back_in_stock").length === 1 && rows3.find((e) => e.template === "back_in_stock")?.status === "suppressed", JSON.stringify(rows3.map((e) => [e.template, e.status])))
    const n = await get("/api/notifications?as=shopper", { jar: S1.jar })
    check("in-app: price drop and back-in-stock notifications for the watcher", n.status === 200 && n.body.items.some((x) => x.category === "price_drop" && x.title.includes(WORD)) && n.body.items.some((x) => x.category === "back_in_stock" && x.title.includes(WORD)), JSON.stringify(n.body?.items?.slice(0, 4)))
    const wl = await get("/api/wishlist", { jar: S1.jar })
    check("back-in-stock: a served watch is no longer pending; wishlist shows the new price", wl.body?.items?.find((x) => x.productId === P.id)?.backInStockVariantIds?.length === 0 && wl.body.items.find((x) => x.productId === P.id)?.price?.amount === 18_000, JSON.stringify(wl.body?.items?.find((x) => x.productId === P.id)))
    // Dedupe: the price goes back up and drops to the same amount again → the same dedupe key, no second email.
    await patch(`/api/studio/catalog/products/${P.id}`, { priceMinor: 20_000, expectedVersion: await productVersion() }, { jar: OWNER })
    await post("/api/wishlist/dev/watch", undefined, { jar: ADMIN })
    await patch(`/api/studio/catalog/products/${P.id}`, { priceMinor: 18_000, expectedVersion: await productVersion() }, { jar: OWNER })
    const w4 = await post("/api/wishlist/dev/watch", undefined, { jar: ADMIN })
    await sleep(1500)
    const rows2 = (await outbox(S1.email)).filter((e) => new Date(e.createdAt).getTime() >= t0 - 2000)
    check("email: the same price drop again is deduplicated (one price_drop row)", w4.status === 200 && w4.body.priceDrops >= 1 && rows2.filter((e) => e.template === "price_drop").length === 1, JSON.stringify([w4.body, rows2.map((e) => [e.template, e.status])]))
    await patch("/api/notifications/preferences?as=shopper", { email: { back_in_stock: true } }, { jar: S3.jar })
  }

  /* ===== Drops: auth, validation, drafts ===== */
  const T0 = Date.now()
  const times = {
    fc: { startsAt: T0 + 170_000, endsAt: T0 + 2 * 3600_000 },
    dr: { entryClosesAt: T0 + 100_000, startsAt: T0 + 150_000, endsAt: T0 + 2 * 3600_000 },
    ea: { earlyAccessAt: T0 + 70_000, startsAt: T0 + 3600_000, endsAt: T0 + 3 * 3600_000 },
  }
  const dropBody = (name, extra = {}) => ({
    name: `${TAG} ${name}`,
    slug: `${TAG.replace(/_/g, "-")}-${name}`,
    description: "Engagement kit drop.",
    access: "first_come",
    startsAt: iso(T0 + 86_400_000),
    endsAt: iso(T0 + 86_400_000 + 3600_000),
    productIds: [P.id],
    variantIds: [V.XXL],
    ...extra,
  })
  const D = {}
  {
    check("drops: create without a session is 401", (await post("/api/drops", dropBody("x"), { jar: ANON })).status === 401)
    check("drops: a shopper can't create (401)", (await post("/api/drops", dropBody("x"), { jar: S1.jar })).status === 401)
    check("drops: a fulfilment member can't create (403)", (await post("/api/drops", dropBody("x"), { jar: FULFIL })).status === 403)
    check("drops: a viewer can't create (403)", (await post("/api/drops", dropBody("x"), { jar: VIEWER })).status === 403)
    check("drops: missing name is 400", (await post("/api/drops", { ...dropBody("x"), name: undefined }, { jar: OWNER })).status === 400)
    check("drops: bad slug is 400", (await post("/api/drops", dropBody("x", { slug: "Bad Slug!" }), { jar: OWNER })).status === 400)
    check("drops: a client-chosen brandId is 400 (strict body)", (await post("/api/drops", dropBody("x", { brandId: "b_null_form" }), { jar: OWNER })).status === 400)
    check("drops: limitPerCustomer 21 is 400", (await post("/api/drops", dropBody("x", { limitPerCustomer: 21 }), { jar: OWNER })).status === 400)
    check("drops: time without a zone is 400", (await post("/api/drops", dropBody("x", { startsAt: "2027-01-01T10:00:00" }), { jar: OWNER })).status === 400)
    const endBefore = await post("/api/drops", dropBody("x", { endsAt: iso(T0 + 86_400_000 - 60_000) }), { jar: OWNER })
    check("drops: ending before it starts is 400 (endsAt)", endBefore.status === 400 && !!endBefore.body?.error?.fields?.endsAt, brief(endBefore))
    const tooLong = await post("/api/drops", dropBody("x", { endsAt: iso(T0 + 86_400_000 + 31 * 86_400_000) }), { jar: OWNER })
    check("drops: longer than 30 days is 400", tooLong.status === 400, brief(tooLong))
    const foreign = await post("/api/drops", dropBody("x", { productIds: [OTHER_BRAND_PRODUCT], variantIds: undefined }), { jar: OWNER })
    check("drops: another brand's product is 400 (productIds.0)", foreign.status === 400 && !!foreign.body?.error?.fields?.["productIds.0"], brief(foreign))
    const badVariant = await post("/api/drops", dropBody("x", { variantIds: ["pv_not_mine"] }), { jar: OWNER })
    check("drops: a variant outside the chosen products is 400", badVariant.status === 400 && !!badVariant.body?.error?.fields?.["variantIds.0"], brief(badVariant))
    const drawNoUnits = await post("/api/drops", dropBody("x", { access: "draw" }), { jar: OWNER })
    check("drops: a draw without units or winners is 400", drawNoUnits.status === 400, brief(drawNoUnits))
    const eaLate = await post("/api/drops", dropBody("x", { access: "early_access", earlyAccessAt: iso(T0 + 86_400_000 + 60_000) }), { jar: OWNER })
    check("drops: early access after the release is 400", eaLate.status === 400 && !!eaLate.body?.error?.fields?.earlyAccessAt, brief(eaLate))

    const c = await post("/api/drops", dropBody("cx", { limitPerCustomer: 2 }), { jar: DESIGNER })
    check("drops: a designer (content.publish) creates a draft → 201, version 1", c.status === 201 && c.body.drop.status === "draft" && c.body.drop.version === 1 && c.body.drop.brand.id === BRAND && c.body.drop.slug === dropBody("cx").slug, brief(c))
    D.cx = c.body?.drop
    {
      const key = `kit-idem-${Date.now().toString(36)}`
      const noKey = await api("POST", "/api/drops", { body: dropBody("cxi"), jar: OWNER })
      check("drops: create without an Idempotency-Key is 400", noKey.status === 400, brief(noKey))
      const first = await post("/api/drops", dropBody("cxi"), { jar: OWNER, headers: { "Idempotency-Key": key } })
      const again = await post("/api/drops", dropBody("cxi"), { jar: OWNER, headers: { "Idempotency-Key": key } })
      check("drops: a retried create with the same key returns the same draft (201 then 200)", first.status === 201 && again.status === 200 && again.body?.drop?.id === first.body?.drop?.id, `${brief(first)} | ${brief(again)}`)
      const other = await post("/api/drops", dropBody("cxi", { name: "Different drop" }), { jar: OWNER, headers: { "Idempotency-Key": key } })
      check("drops: the same key with a different body is 409", other.status === 409, brief(other))
      if (first.body?.drop) await post(`/api/drops/${first.body.drop.id}/cancel`, { expectedVersion: first.body.drop.version }, { jar: OWNER })
    }
    const dupSlug = await post("/api/drops", dropBody("cx"), { jar: OWNER })
    check("drops: a taken slug gets a unique suffix", dupSlug.status === 201 && dupSlug.body.drop.slug !== D.cx.slug && dupSlug.body.drop.slug.startsWith(D.cx.slug), brief(dupSlug))
    D.cx2 = dupSlug.body?.drop
    check("drops: a draft isn't public (404 by id and slug)", (await get(`/api/drops/${D.cx.id}`)).status === 404 && (await get(`/api/drops/${D.cx.slug}`)).status === 404)
    check("drops: a draft isn't in the public list", !(await get(`/api/drops?brandId=${BRAND}&phase=all&limit=50`)).body?.items?.some((x) => x.id === D.cx.id))
    const studio = await get("/api/drops/studio", { jar: VIEWER })
    check("drops: any member (viewer) sees drafts in Studio with counts", studio.status === 200 && studio.body.items.some((x) => x.id === D.cx.id && x.reminders === 0), brief(studio))
    check("drops: Studio list filters by status", (await get("/api/drops/studio?status=scheduled", { jar: OWNER })).body?.items?.every((x) => x.status === "scheduled"))
    check("drops: Studio list with a bad status is 400", (await get("/api/drops/studio?status=open", { jar: OWNER })).status === 400)
    check("drops: Studio list without a brand session is 401", (await get("/api/drops/studio", { jar: S1.jar })).status === 401)
    check("drops: another brand doesn't see it in its Studio", !(await get("/api/drops/studio", { jar: OTHER })).body?.items?.some((x) => x.id === D.cx.id))
    check("drops: another brand can't edit it (404)", (await patch(`/api/drops/${D.cx.id}`, { name: "x", expectedVersion: 1 }, { jar: OTHER })).status === 404)
    check("drops: another brand can't schedule it (404)", (await post(`/api/drops/${D.cx.id}/schedule`, { expectedVersion: 1 }, { jar: OTHER })).status === 404)
    check("drops: another brand can't cancel it (404)", (await post(`/api/drops/${D.cx.id}/cancel`, { expectedVersion: 1 }, { jar: OTHER })).status === 404)
    check("drops: a viewer can't edit (403)", (await patch(`/api/drops/${D.cx.id}`, { name: "x", expectedVersion: 1 }, { jar: VIEWER })).status === 403)

    // Edit with expectedVersion.
    check("drops: edit without expectedVersion is 400", (await patch(`/api/drops/${D.cx.id}`, { name: `${TAG} renamed` }, { jar: OWNER })).status === 400)
    const stale = await patch(`/api/drops/${D.cx.id}`, { name: `${TAG} renamed`, expectedVersion: 7 }, { jar: OWNER })
    check("drops: edit with a stale version is 409", stale.status === 409, brief(stale))
    const e1 = await patch(`/api/drops/${D.cx.id}`, { name: `${TAG} renamed`, limitPerCustomer: 3, expectedVersion: 1 }, { jar: OWNER })
    check("drops: edit → 200, version 2, fields changed", e1.status === 200 && e1.body.drop.version === 2 && e1.body.drop.name === `${TAG} renamed` && e1.body.drop.limitPerCustomer === 3, brief(e1))
    const replay = await patch(`/api/drops/${D.cx.id}`, { name: `${TAG} again`, expectedVersion: 1 }, { jar: OWNER })
    check("drops: replaying the old version is 409", replay.status === 409, brief(replay))
    const e2 = await patch(`/api/drops/${D.cx.id}`, { access: "draw", winnersCount: 3, expectedVersion: 2 }, { jar: OWNER })
    check("drops: a draft can change access (version 3)", e2.status === 200 && e2.body.drop.access === "draw" && e2.body.drop.winners === 3 && e2.body.drop.version === 3, brief(e2))
    const e3 = await patch(`/api/drops/${D.cx.id}`, { endsAt: iso(T0 + 3600_000), expectedVersion: 3 }, { jar: OWNER })
    check("drops: an edit that breaks the time rules is 400", e3.status === 400, brief(e3))

    // Schedule / unschedule / cancel on the far-future drop.
    check("drops: schedule with a stale version is 409", (await post(`/api/drops/${D.cx.id}/schedule`, { expectedVersion: 2 }, { jar: OWNER })).status === 409)
    check("drops: schedule without a body is 400", (await post(`/api/drops/${D.cx.id}/schedule`, undefined, { jar: OWNER })).status === 400)
    const s1 = await post(`/api/drops/${D.cx.id}/schedule`, { expectedVersion: 3 }, { jar: OWNER })
    check("drops: schedule a draw → scheduled, version 4, entries open", s1.status === 200 && s1.body.drop.status === "scheduled" && s1.body.drop.version === 4 && s1.body.drop.phase === "entries_open", brief(s1))
    const di = await get(`/api/drops/${D.cx.id}/draw`)
    check("draw: scheduling commits a seed hash; the seed stays secret", di.status === 200 && /^[0-9a-f]{64}$/.test(di.body.seedHash ?? "") && di.body.seed === null && di.body.drawnAt === null, brief(di))
    const hash1 = di.body?.seedHash
    check("drops: a scheduled drop is public now", (await get(`/api/drops/${D.cx.slug}`)).status === 200 && (await get(`/api/drops?brandId=${BRAND}&phase=upcoming&limit=50`)).body?.items?.some((x) => x.id === D.cx.id))
    check("drops: scheduling twice is 422", (await post(`/api/drops/${D.cx.id}/schedule`, { expectedVersion: 4 }, { jar: OWNER })).status === 422)
    const accessChange = await patch(`/api/drops/${D.cx.id}`, { access: "first_come", expectedVersion: 4 }, { jar: OWNER })
    check("drops: a scheduled drop can't change access (422)", accessChange.status === 422, brief(accessChange))
    const e4 = await patch(`/api/drops/${D.cx.id}`, { description: "Edited while scheduled.", expectedVersion: 4 }, { jar: OWNER })
    check("drops: a scheduled drop that hasn't started can be edited (version 5)", e4.status === 200 && e4.body.drop.version === 5, brief(e4))
    const un = await api("DELETE", `/api/drops/${D.cx.id}/schedule`, { jar: OWNER, body: { expectedVersion: 5 } })
    check("drops: unschedule → back to draft (version 6)", un.status === 200 && un.body.drop.status === "draft" && un.body.drop.version === 6, brief(un))
    check("drops: unscheduled draw has no hash any more", (await get("/api/drops/studio?status=draft", { jar: OWNER })).body?.items?.find((x) => x.id === D.cx.id)?.drawSeedHash === null)
    const s2 = await post(`/api/drops/${D.cx.id}/schedule`, { expectedVersion: 6 }, { jar: OWNER })
    const hash2 = (await get(`/api/drops/${D.cx.id}/draw`)).body?.seedHash
    check("draw: rescheduling commits a fresh seed hash", s2.status === 200 && /^[0-9a-f]{64}$/.test(hash2 ?? "") && hash2 !== hash1, `${hash1} → ${hash2}`)
    const early = await post(`/api/drops/${D.cx.id}/draw`, undefined, { jar: OWNER })
    check("draw: running the draw while entries are open is 422", early.status === 422, brief(early))
    // Overlap: XXL is in D.cx (scheduled, tomorrow); D.cx2 has the same variant in the same window.
    const ov = await post(`/api/drops/${D.cx2.id}/schedule`, { expectedVersion: D.cx2.version }, { jar: OWNER })
    check("drops: a variant can't be in two overlapping scheduled drops (409)", ov.status === 409, brief(ov))
    const cs = await post(`/api/drops/${D.cx.id}/cancel`, { expectedVersion: 6 }, { jar: OWNER })
    check("drops: cancel with a stale version is 409", cs.status === 409, brief(cs))
    const cn = await post(`/api/drops/${D.cx.id}/cancel`, { expectedVersion: 7 }, { jar: OWNER })
    check("drops: cancel → cancelled", cn.status === 200 && cn.body.drop.status === "cancelled" && cn.body.drop.phase === "cancelled", brief(cn))
    check("drops: cancelling again is 422", (await post(`/api/drops/${D.cx.id}/cancel`, { expectedVersion: 8 }, { jar: OWNER })).status === 422)
    check("drops: a cancelled drop can't be edited (422)", (await patch(`/api/drops/${D.cx.id}`, { name: "x", expectedVersion: 8 }, { jar: OWNER })).status === 422)
    check("drops: a cancelled drop is not in the public list", !(await get(`/api/drops?brandId=${BRAND}&phase=all&limit=50`)).body?.items?.some((x) => x.id === D.cx.id))
    check("drops: reminder on a cancelled drop is 422", (await post(`/api/drops/${D.cx.id}/reminder`, undefined, { jar: S1.jar })).status === 422)
    const ov2 = await post(`/api/drops/${D.cx2.id}/schedule`, { expectedVersion: D.cx2.version }, { jar: OWNER })
    check("drops: after the cancel, the other drop with that variant can be scheduled", ov2.status === 200, brief(ov2))
    cleanup.push(async () => post(`/api/drops/${D.cx2.id}/cancel`, { expectedVersion: ov2.body?.drop?.version }, { jar: OWNER }))
    check("drops: list query validation (phase, limit)", (await get("/api/drops?phase=soon")).status === 400 && (await get("/api/drops?limit=51")).status === 400)
    check("drops: unknown drop is 404", (await get(`/api/drops/drp_${RUN}_nope`)).status === 404)
    check("draw: transparency for a non-draw drop is 404", (await get(`/api/drops/${D.cx2.id}/draw`)).status === 404)
  }

  /* ===== Timed drops: first-come, draw, early access ===== */
  {
    const mk = async (key, body) => {
      const r = await post("/api/drops", dropBody(key, body), { jar: OWNER })
      if (r.status !== 201) {
        check(`setup: create timed drop ${key}`, false, brief(r))
        throw new Error("setup failed")
      }
      const s = await post(`/api/drops/${r.body.drop.id}/schedule`, { expectedVersion: r.body.drop.version }, { jar: OWNER })
      check(`setup: timed drop ${key} scheduled`, s.status === 200, brief(s))
      D[key] = s.body.drop
      cleanup.push(async () => {
        const cur = (await get("/api/drops/studio", { jar: OWNER })).body?.items?.find((x) => x.id === D[key].id)
        if (cur && cur.status !== "cancelled" && cur.status !== "ended") await post(`/api/drops/${cur.id}/cancel`, { expectedVersion: cur.version }, { jar: OWNER })
      })
    }
    await mk("dr", { access: "draw", entryClosesAt: iso(times.dr.entryClosesAt), startsAt: iso(times.dr.startsAt), endsAt: iso(times.dr.endsAt), variantIds: [V.L], winnersCount: 2, limitPerCustomer: 1, purchaseWindowMinutes: 60 })
    await mk("ea", { access: "early_access", earlyAccessAt: iso(times.ea.earlyAccessAt), startsAt: iso(times.ea.startsAt), endsAt: iso(times.ea.endsAt), variantIds: [V.XL], limitPerCustomer: 1 })
    // Scheduled last, right before the reminders: the reminder is due at once (3 min lead), so the next scheduler tick sends it.
    await mk("fc", { access: "first_come", startsAt: iso(times.fc.startsAt), endsAt: iso(times.fc.endsAt), variantIds: [V.S, V.M], limitPerCustomer: 2, reminderLeadMinutes: 3 })
    // Reminders right away (the scheduler sends them 2 minutes before release).
    for (const s of shoppers) {
      const r = await post(`/api/drops/${D.fc.id}/reminder`, undefined, { jar: s.jar })
      if (s === S1) check("reminder: set → 200", r.status === 200 && r.body.reminder === true, brief(r))
    }
    check("reminder: without a session is 401", (await post(`/api/drops/${D.fc.id}/reminder`, undefined, { jar: ANON })).status === 401)
    check("reminder: a brand session is 401", (await post(`/api/drops/${D.fc.id}/reminder`, undefined, { jar: OWNER })).status === 401)
    check("reminder: setting it again is idempotent", (await post(`/api/drops/${D.fc.id}/reminder`, undefined, { jar: S1.jar })).status === 200)
    check("reminder: on an unknown drop is 404", (await post(`/api/drops/drp_${RUN}_nope/reminder`, undefined, { jar: S1.jar })).status === 404)
    const det = await get(`/api/drops/${D.fc.slug}`, { jar: S1.jar })
    check("drops: detail shows the viewer's reminder, following, allowance and why they can't buy yet", det.status === 200 && det.body.me?.reminder === true && det.body.me.following === true && det.body.me.canBuy === false && /releases at/.test(det.body.me.reason ?? "") && det.body.me.remainingAllowance === 2 && det.body.drop.unitsAvailable === 60, JSON.stringify(det.body?.me) + JSON.stringify(det.body?.drop?.unitsAvailable))
    check("drops: anonymous detail has no `me`", (await get(`/api/drops/${D.fc.id}`)).body?.me === null)
    const studio = await get("/api/drops/studio?status=scheduled", { jar: OWNER })
    check("drops: Studio counts reminders", studio.body?.items?.find((x) => x.id === D.fc.id)?.reminders === 3, JSON.stringify(studio.body?.items?.find((x) => x.id === D.fc.id)))
    const me = await get("/api/drops/me", { jar: S1.jar })
    check("drops/me: lists the reminder", me.status === 200 && me.body.reminders.some((r) => r.dropId === D.fc.id && r.drop?.id === D.fc.id), brief(me))
    check("drops/me: without a session is 401", (await get("/api/drops/me", { jar: ANON })).status === 401)
    const off = await del(`/api/drops/${D.fc.id}/reminder`, { jar: S3.jar })
    check("reminder: clear → reminder false", off.status === 200 && off.body.reminder === false && (await get(`/api/drops/${D.fc.id}`, { jar: S3.jar })).body?.me?.reminder === false, brief(off))
    await post(`/api/drops/${D.fc.id}/reminder`, undefined, { jar: S3.jar })

    // Draw entries.
    check("entry: without a session is 401", (await post(`/api/drops/${D.dr.id}/entry`, undefined, { jar: ANON })).status === 401)
    check("entry: a first-come drop isn't a draw (422)", (await post(`/api/drops/${D.fc.id}/entry`, undefined, { jar: S1.jar })).status === 422)
    for (const s of shoppers) {
      const r = await post(`/api/drops/${D.dr.id}/entry`, undefined, { jar: s.jar })
      check(`entry: ${s === S1 ? "S1" : s === S2 ? "S2" : "S3"} enters the draw`, r.status === 200 && r.body.entered === true && r.body.status === "entered", brief(r))
    }
    check("entry: entering twice is idempotent", (await post(`/api/drops/${D.dr.id}/entry`, undefined, { jar: S1.jar })).body?.status === "entered")
    const wd = await del(`/api/drops/${D.dr.id}/entry`, { jar: S3.jar })
    check("entry: withdraw before the draw", wd.status === 200 && wd.body.entered === false && (await get(`/api/drops/${D.dr.id}/draw`, { jar: S3.jar })).body?.me?.status === "withdrawn", brief(wd))
    const re = await post(`/api/drops/${D.dr.id}/entry`, undefined, { jar: S3.jar })
    check("entry: re-enter after withdrawing", re.status === 200 && re.body.status === "entered", brief(re))
    const dd = await get(`/api/drops/${D.dr.id}`)
    check("drops: a draw in its entry window is phase entries_open with 3 entries", dd.body?.drop?.phase === "entries_open" && dd.body.drop.entries === 3 && dd.body.drop.winners === 2, JSON.stringify(dd.body?.drop))
    const unsch = await api("DELETE", `/api/drops/${D.dr.id}/schedule`, { jar: OWNER, body: { expectedVersion: D.dr.version } })
    check("drops: a draw with entries can't go back to draft (422)", unsch.status === 422, brief(unsch))
    check("drops/me: lists the entry", (await get("/api/drops/me", { jar: S2.jar })).body?.entries?.some((e) => e.drop.id === D.dr.id && e.status === "entered"))
    check("draw: brand can't run it before entries close (422)", (await post(`/api/drops/${D.dr.id}/draw`, undefined, { jar: OWNER })).status === 422)
    check("draw: another brand can't run it (404)", (await post(`/api/drops/${D.dr.id}/draw`, undefined, { jar: OTHER })).status === 404)
    check("draw: a shopper can't run it (401)", (await post(`/api/drops/${D.dr.id}/draw`, undefined, { jar: S1.jar })).status === 401)
    const editLive = await patch(`/api/drops/${D.dr.id}`, { startsAt: iso(T0 + 10_000), expectedVersion: D.dr.version }, { jar: OWNER })
    check("drops: a scheduled edit must keep its times in the future (400)", editLive.status === 400, brief(editLive))
  }

  /* ===== Checkout gate before release (checkDropLimit) ===== */
  const pickService = async (jar) => {
    const v = await get("/api/cart?currency=NGN&to=NG&city=Lagos", { jar })
    const g = v.body?.groups?.find((x) => x.brandId === BRAND)
    return g?.shipping?.options?.find((o) => o.available)?.service ?? "standard"
  }
  let coN = 0
  const checkout = async (s, lines) => {
    await del("/api/cart", { jar: s.jar })
    for (const [variantId, qty] of lines) {
      const a = await post("/api/cart/lines", { variantId, qty }, { jar: s.jar })
      if (a.status !== 201 && a.status !== 200) return a
    }
    const service = await pickService(s.jar)
    const r = await post("/api/checkout", { idempotencyKey: `${TAG}_co${++coN}`, currency: "NGN", shipTo, shipping: [{ brandId: BRAND, service }] }, { jar: s.jar })
    // Any checkout left unpaid at the end is failed, so its stock hold and drop claim are released at once.
    if (r.status === 201 && r.body?.id) cleanup.push(async () => post(`/api/checkout/${r.body.id}/stub-pay`, { outcome: "failed" }, { jar: s.jar }))
    return r
  }
  {
    const fcEarly = await checkout(S1, [[V.S, 1]])
    check("limits: buying a first-come drop piece before release is 422", fcEarly.status === 422 && /releases at/.test(fcEarly.body?.error?.message ?? ""), brief(fcEarly))
    const eaEarly = await checkout(S1, [[V.XL, 1]])
    check("limits: early access isn't open yet for the follower (422)", eaEarly.status === 422, brief(eaEarly))
    const drEarly = await checkout(S1, [[V.L, 1]])
    check("limits: a draw piece before the draw is 422 (only winners)", drEarly.status === 422 && /winners/.test(drEarly.body?.error?.message ?? ""), brief(drEarly))
    const free = await checkout(S1, [[V.XS, 1]])
    check("limits: a piece in no running drop still checks out (201)", free.status === 201, brief(free))
    if (free.body?.id) await post(`/api/checkout/${free.body.id}/stub-pay`, { outcome: "failed" }, { jar: S1.jar })
  }

  /* ===== The draw ===== */
  let logMark = logSize()
  const drawStart = Date.now()
  {
    await waitUntil(times.dr.entryClosesAt + 1500, "for draw entries to close")
    check("entry: entering after entries closed is 422", (await post(`/api/drops/${D.dr.id}/entry`, undefined, { jar: (await demo("shopper", "u_ada")) })).status === 422)
    logMark = logSize()
    const run = await post(`/api/drops/${D.dr.id}/draw`, undefined, { jar: OWNER })
    // The scheduler may have run it within the same second: either way it happens once.
    check("draw: the brand runs the draw once entries closed (or the scheduler already did)", run.status === 200 || (run.status === 422 && /already/.test(run.body?.error?.message ?? "")), brief(run))
    const again = await post(`/api/drops/${D.dr.id}/draw`, undefined, { jar: OWNER })
    check("draw: running it again is 422", again.status === 422, brief(again))
    const info = await get(`/api/drops/${D.dr.id}/draw`)
    const b = info.body ?? {}
    check("draw: the seed is revealed and matches the committed hash", info.status === 200 && typeof b.seed === "string" && sha256(b.seed) === b.seedHash && !!b.drawnAt, brief(info))
    check("draw: counts (3 entries, 2 won, 1 waitlisted)", b.counts?.entries === 3 && b.counts.won === 2 && b.counts.waitlisted === 1, JSON.stringify(b.counts))
    // Recompute the order from the seed: sha256(seed:dropId:userId) ascending.
    const order = shoppers.map((s) => ({ s, key: sha256(`${b.seed}:${D.dr.id}:${s.id}`) })).sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))
    const mine = []
    for (const s of shoppers) mine.push({ s, me: (await get(`/api/drops/${D.dr.id}/draw`, { jar: s.jar })).body?.me })
    const okOrder = order.every((o, i) => {
      const m = mine.find((x) => x.s === o.s)?.me
      return m?.rank === i + 1 && m.status === (i < 2 ? "won" : "waitlisted")
    })
    check("draw: winners and ranks are reproducible from the revealed seed", okOrder, JSON.stringify(mine.map((m) => m.me)))
    D.winner = order[0].s
    D.winner2 = order[1].s
    D.waitlisted = order[2].s
    const wme = mine.find((x) => x.s === D.winner).me
    check("draw: a winner's purchase window opens at release, for 60 minutes", wme?.windowOpensAt === iso(times.dr.startsAt) && new Date(wme.windowEndsAt).getTime() - times.dr.startsAt === 3600_000, JSON.stringify(wme))
    check("draw: withdrawing after the draw is 422", (await del(`/api/drops/${D.dr.id}/entry`, { jar: D.winner.jar })).status === 422)
    check("draw: entering after the draw is 422", (await post(`/api/drops/${D.dr.id}/entry`, undefined, { jar: D.waitlisted.jar })).status === 422)
    check("draw: the anonymous transparency view has no `me`", (await get(`/api/drops/${D.dr.id}/draw`)).body?.me === null)
    const early = await checkout(D.winner, [[V.L, 1]])
    check("limits: a winner can't buy before their window opens (422)", early.status === 422 && /opens at/.test(early.body?.error?.message ?? ""), brief(early))
    const dm = await get(`/api/drops/${D.dr.id}`, { jar: D.winner.jar })
    check("drops: the winner's detail shows the won entry and the window reason", dm.body?.me?.entry?.status === "won" && dm.body.me.canBuy === false && /opens at/.test(dm.body.me.reason ?? ""), JSON.stringify(dm.body?.me))

    // Draw emails: won / lost per shopper, S3 suppressed by preference.
    for (const s of shoppers) {
      const want = s === D.waitlisted ? "drop_draw_lost" : "drop_draw_won"
      const rows = await waitOutbox(s.email, drawStart, (r) => r.some((e) => e.template === want && e.status !== "pending" && e.status !== "sending"), 60_000)
      const row = rows.filter((e) => e.template === want)
      const label = s === S1 ? "S1" : s === S2 ? "S2" : "S3"
      if (s === S3) check(`email: ${label}'s ${want} is suppressed (drop emails off in preferences)`, row.length === 1 && row[0].status === "suppressed", JSON.stringify(rows.map((e) => [e.template, e.status])))
      else check(`email: ${label} gets exactly one ${want} (stub)`, row.length === 1 && row[0].status === "stub", JSON.stringify(rows.map((e) => [e.template, e.status])))
    }
    const n = await get("/api/notifications?as=shopper", { jar: D.winner.jar })
    check("in-app: the winner has a 'You won' notification", n.body?.items?.some((x) => /You won/.test(x.title) && x.title.includes(TAG)), JSON.stringify(n.body?.items?.slice(0, 3)))
  }

  /* ===== Unsubscribe with a real token (S2's drop email) ===== */
  {
    // The reminder (sent by the first tick after scheduling) must be out before S2 unsubscribes.
    await waitOutbox(S2.email, T0, (r) => r.some((e) => e.template === "drop_reminder" && e.status !== "pending" && e.status !== "sending"), 60_000)
    let token = null
    for (let i = 0; i < 20 && !token; i++) {
      token = unsubTokenFromLog(S2.email, logMark)
      if (!token) await sleep(1500)
    }
    check("unsubscribe: optional emails carry an unsubscribe link (dev log)", !!token, `no unsubscribe link for ${S2.email}`)
    if (token) {
      const q = `/api/notifications/preferences/unsubscribe?token=${encodeURIComponent(token)}`
      const g1 = await get(q)
      check("unsubscribe: GET shows what would change (drops)", g1.status === 200 && g1.body.category === "drops" && /drop/.test(g1.body.label), brief(g1))
      check("unsubscribe: GET is read-only (S2's drop emails are still on)", (await get(q)).status === 200 && (await get("/api/notifications/preferences?as=shopper", { jar: S2.jar })).body?.preferences?.email?.drops === true)
      const tampered = token.replace(/.$/, (c) => (c === "A" ? "B" : "A"))
      check("unsubscribe: a tampered token is 400", (await api("POST", `/api/notifications/preferences/unsubscribe?token=${encodeURIComponent(tampered)}`, { noOrigin: true })).status === 400)
      const p1 = await api("POST", q, { noOrigin: true })
      check("unsubscribe: one-click POST without session or CSRF headers works", p1.status === 200 && p1.body.unsubscribed === true && p1.body.category === "drops", brief(p1))
      const p2 = await api("POST", q, { noOrigin: true })
      check("unsubscribe: POST again is idempotent", p2.status === 200, brief(p2))
    }
  }

  /* ===== Early access opens (S1 follows, S2 doesn't) ===== */
  {
    await waitUntil(times.ea.earlyAccessAt + 1000, "for early access")
    const s2 = await checkout(S2, [[V.XL, 1]])
    check("limits: early access refuses a non-follower (422)", s2.status === 422 && /early access/.test(s2.body?.error?.message ?? ""), brief(s2))
    const s1 = await checkout(S1, [[V.XL, 1]])
    check("limits: early access lets a follower (from before it opened) check out (201)", s1.status === 201, brief(s1))
    const det = await get(`/api/drops/${D.ea.id}`, { jar: S1.jar })
    check("drops: early-access detail: phase early_access, me.earlyAccess, allowance used by the open checkout", det.body?.drop?.phase === "early_access" && det.body.me?.earlyAccess === true && det.body.me.claimed === 1 && det.body.me.canBuy === false, JSON.stringify(det.body?.me))
    // One live checkout per shopper (CHECKOUT): a second checkout replaces the open one, releasing
    // its claim first, so the allowance is never counted twice across unpaid checkouts.
    const second = await checkout(S1, [[V.XL, 1]])
    const firstAfter = s1.body?.id ? await get(`/api/checkout/${s1.body.id}`, { jar: S1.jar }) : null
    const detAfter = await get(`/api/drops/${D.ea.id}`, { jar: S1.jar })
    check("limits: a second checkout replaces the open one (201; first expired; still 1 claimed)", second.status === 201 && firstAfter?.body?.status === "expired" && detAfter.body?.me?.claimed === 1, { second: brief(second), first: firstAfter?.body?.status, me: detAfter.body?.me })
    if (second.body?.id) {
      const f = await post(`/api/checkout/${second.body.id}/stub-pay`, { outcome: "failed" }, { jar: S1.jar })
      check("limits: a failed payment releases the claim (allowance back)", f.status === 200 && (await get(`/api/drops/${D.ea.id}`, { jar: S1.jar })).body?.me?.claimed === 0, brief(f))
    }
  }

  /* ===== Draw winners buy in their window ===== */
  {
    await waitUntil(times.dr.startsAt + 1000, "for the draw's release (winners' windows)")
    const lost = await checkout(D.waitlisted, [[V.L, 1]])
    check("limits: a waitlisted entrant can't buy (422)", lost.status === 422 && /winners/.test(lost.body?.error?.message ?? ""), brief(lost))
    const two = await checkout(D.winner, [[V.L, 2]])
    check("limits: a winner can't buy more than the limit (422, field on the line)", two.status === 422 && !!two.body?.error?.fields?.[`lines.${V.L}`], brief(two))
    const co = await checkout(D.winner, [[V.L, 1]])
    check("limits: the winner checks out in their window (201)", co.status === 201, brief(co))
    const retry = co.body?.id ? await post("/api/checkout", { idempotencyKey: `${TAG}_co${coN}`, currency: "NGN", shipTo, shipping: [{ brandId: BRAND, service: await pickService(D.winner.jar) }] }, { jar: D.winner.jar }) : null
    check("limits: retrying the same checkout (same key) isn't counted twice (200)", retry?.status === 200 && retry.body.id === co.body.id, retry ? brief(retry) : "no checkout")
    if (co.body?.id) {
      const pay = await post(`/api/checkout/${co.body.id}/stub-pay`, { outcome: "success" }, { jar: D.winner.jar })
      check("limits: stub payment succeeds", pay.status === 200 && pay.body.status === "paid", brief(pay))
      const me = (await get(`/api/drops/${D.dr.id}/draw`, { jar: D.winner.jar })).body?.me
      check("draw: a paid winner's entry becomes purchased", me?.status === "purchased", JSON.stringify(me))
      const info = (await get(`/api/drops/${D.dr.id}/draw`)).body
      check("draw: counts show the purchase", info?.counts?.purchased === 1 && info.counts.won === 2, JSON.stringify(info?.counts))
      const more = await checkout(D.winner, [[V.L, 1]])
      check("limits: after buying the limit, another checkout is 422", more.status === 422, brief(more))
    }
  }

  /* ===== First-come drop: limits across checkouts, reminder + live emails ===== */
  {
    await waitUntil(times.fc.startsAt + 1000, "for the first-come release")
    const over = await checkout(S1, [[V.S, 2], [V.M, 1]])
    check("limits: 3 units across two variants of a limit-2 drop is 422", over.status === 422 && /limited to 2/.test(over.body?.error?.message ?? ""), brief(over))
    const c1 = await checkout(S1, [[V.S, 1]])
    check("limits: 1 unit checks out (201)", c1.status === 201, brief(c1))
    // Paid first: an open checkout would be replaced by the next one (one live checkout per shopper).
    if (c1.body?.id) await post(`/api/checkout/${c1.body.id}/stub-pay`, { outcome: "success" }, { jar: S1.jar })
    const c2 = await checkout(S1, [[V.M, 2]])
    check("limits: 2 more after 1 paid is 422 ('you can add 1 more')", c2.status === 422 && /add 1 more/.test(c2.body?.error?.message ?? ""), brief(c2))
    const c3 = await checkout(S1, [[V.M, 1]])
    check("limits: exactly up to the limit with a second checkout (201)", c3.status === 201, brief(c3))
    if (c3.body?.id) await post(`/api/checkout/${c3.body.id}/stub-pay`, { outcome: "success" }, { jar: S1.jar })
    const det = await get(`/api/drops/${D.fc.id}`, { jar: S1.jar })
    check("drops: after two paid checkouts the shopper has used the allowance", det.body?.me?.claimed === 2 && det.body.me.remainingAllowance === 0 && det.body.me.canBuy === false && /limit of 2/.test(det.body.me.reason ?? ""), JSON.stringify(det.body?.me))
    const c4 = await checkout(S1, [[V.S, 1]])
    check("limits: paid claims keep counting (422)", c4.status === 422, brief(c4))
    const tPaid = Date.now()
    const other = await checkout(S2, [[V.S, 2]])
    check("limits: the limit is per customer (S2 can still buy 2)", other.status === 201, brief(other))
    if (other.body?.id) await post(`/api/checkout/${other.body.id}/stub-pay`, { outcome: "success" }, { jar: S2.jar })
    // Service mail is never stopped by an unsubscribe (S2 unsubscribed from drop emails above).
    const oc = await waitOutbox(S2.email, tPaid, (r) => r.some((e) => e.template === "order_confirmation" && e.status !== "pending" && e.status !== "sending"), 30_000)
    check("email: order mail still goes to an address unsubscribed from drops (stub)", oc.find((e) => e.template === "order_confirmation")?.status === "stub", JSON.stringify(oc.map((e) => [e.template, e.status])))
    const live = await get(`/api/drops?brandId=${BRAND}&phase=live&limit=50`)
    check("drops: the released drop is in the live list", live.body?.items?.some((x) => x.id === D.fc.id && x.phase === "live"), brief(live))
    check("drops: a live drop can't be edited (422)", (await patch(`/api/drops/${D.fc.id}`, { name: "x", expectedVersion: (await get(`/api/drops/${D.fc.id}`)).body?.drop?.version }, { jar: OWNER })).status === 422)

    // Scheduler emails: reminder (2 min before) then live, to reminder holders, per preferences and unsubscribes.
    const rs1 = await waitOutbox(S1.email, T0, (r) => r.some((e) => e.template === "drop_live" && e.status === "stub"), 90_000)
    check("email: S1 got one drop_reminder before release (stub)", rs1.filter((e) => e.template === "drop_reminder" && e.vars?.drop?.includes(TAG)).length === 1 && rs1.find((e) => e.template === "drop_reminder")?.status === "stub", JSON.stringify(rs1.map((e) => [e.template, e.status])))
    check("email: S1 got one drop_live at release (stub)", rs1.filter((e) => e.template === "drop_live" && e.vars?.drop?.includes(TAG)).length === 1, JSON.stringify(rs1.map((e) => [e.template, e.status])))
    const rs2 = await waitOutbox(S2.email, T0, (r) => r.some((e) => e.template === "drop_live"), 30_000)
    check("email: S2's drop_reminder went out before the unsubscribe (stub)", rs2.find((e) => e.template === "drop_reminder")?.status === "stub", JSON.stringify(rs2.map((e) => [e.template, e.status])))
    check("email: S2's drop_live after the unsubscribe is suppressed", rs2.filter((e) => e.template === "drop_live").length === 1 && rs2.find((e) => e.template === "drop_live")?.status === "suppressed", JSON.stringify(rs2.map((e) => [e.template, e.status])))
    const rs3 = await waitOutbox(S3.email, T0, (r) => r.some((e) => e.template === "drop_live"), 30_000)
    check("email: S3 (drop emails off) gets reminder and live stored as suppressed", rs3.find((e) => e.template === "drop_live")?.status === "suppressed" && rs3.find((e) => e.template === "drop_reminder")?.status === "suppressed", JSON.stringify(rs3.map((e) => [e.template, e.status])))
    // Turning drops back on lifts the unsubscribe.
    const on = await patch("/api/notifications/preferences?as=shopper", { email: { drops: true } }, { jar: S2.jar })
    check("prefs: turning drop emails back on (lifts the unsubscribe)", on.status === 200 && on.body.preferences.email.drops === true, brief(on))
    const n = await get("/api/notifications?as=shopper", { jar: S3.jar })
    check("in-app: reminder holders see the drop as live", n.body?.items?.some((x) => /is live/.test(x.title) && x.title.includes(TAG)), JSON.stringify(n.body?.items?.slice(0, 3)))
  }

  /* ===== Archive: the product leaves search ===== */
  {
    const v = await productVersion()
    const un = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "unpublish", expectedVersion: v }, { jar: OWNER })
    let s
    for (let i = 0; i < 10; i++) {
      s = await get(`/api/search?q=${WORD}&currency=NGN`)
      if (s.body?.total === 0) break
      await sleep(1000)
    }
    check("search: an unpublished product no longer matches", un.status === 200 && s.body?.total === 0, brief(s))
    check("suggest: nor in type-ahead", !(await get(`/api/search/suggest?q=${WORD}`)).body?.products?.some((p) => p.productId === P.id))
    const wl = await get("/api/wishlist", { jar: S1.jar })
    check("wishlist: a saved product that was unpublished shows listed=false", wl.body?.items?.find((x) => x.productId === P.id)?.listed === false, JSON.stringify(wl.body?.items?.find((x) => x.productId === P.id)))
  }

  // Tidy the kit shoppers' state.
  for (const s of shoppers) {
    await del(`/api/wishlist/${P.id}`, { jar: s.jar })
    await del(`/api/wishlist/back-in-stock/${V.XS}`, { jar: s.jar })
    await del(`/api/drops/${D.fc.id}/reminder`, { jar: s.jar })
    await del("/api/cart", { jar: s.jar })
    await patch("/api/notifications/preferences?as=shopper", { email: allOn, inApp: allOn }, { jar: s.jar })
  }
}

let crashed = null
try {
  await main()
} catch (e) {
  crashed = e
  check("kit ran to the end", false, e?.stack ?? String(e))
} finally {
  for (const f of cleanup.reverse()) {
    try {
      await f()
    } catch {}
  }
}
console.log(`# ${passed} passed, ${failed} failed${crashed ? " (stopped early)" : ""}`)
process.exit(failed ? 1 : 0)
