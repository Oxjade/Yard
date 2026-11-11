#!/usr/bin/env node
// PRODUCTION CLEAN kit: no sample brand, storefront, product or drop is visible, linkable, searchable
// or purchasable on a production-mode server (the demo switch off). Plain Node 22 (fetch); the
// browser part uses Playwright when it resolves. One PASS/FAIL line per check; exits non-zero on any
// FAIL.
//
//   YARD_PROD_BASE=http://127.0.0.1:3100 node scripts/checks/v3-prod-clean.mjs
//
// Env:
//   YARD_PROD_BASE            REQUIRED. A production-mode server (next build + next start with
//                             NODE_ENV=production, no YARD_SEED_DEMO / YARD_DEMO_AUTH). There is no
//                             default, so this can never run against the demo dev server by mistake;
//                             it aborts unless GET /api/session says sampleData:false.
//   YARD_PROD_SHOPPER_COOKIE  optional "yard_session=…" of a signed-in shopper on that server: runs the
//                             signed-in refusals (wishlist, merge, back in stock, follow, reminder,
//                             checkout). Without it those SKIP and the anonymous 401s are asserted.
//   YARD_PROD_BROWSER=0       skip the browser checks (stored cart / saved lists, widths).
//
// Needles come from the bundled sample data (src/lib/data): brand ids, handles and names; product ids,
// slugs, variant ids and (multi-word) names; drop ids, slugs and names; story slugs and titles;
// collection and curated collection ids, slugs and names; and sample-only wording ("Includes sample
// activity", "sample order history"). Rendered pages are also checked for a sample handle as text. Nothing is written except what a shopper could write
// (an anonymous cart cookie); every refusal is expected to create nothing.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const base = (process.env.YARD_PROD_BASE ?? "").replace(/\/$/, "")
if (!base) {
  console.error("YARD_PROD_BASE is required (a production-mode server, never the demo dev server).")
  process.exit(2)
}
const COOKIE = process.env.YARD_PROD_SHOPPER_COOKIE?.trim() || ""
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

let failed = 0
let passed = 0
let skipped = 0
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail === "" || detail === undefined || detail === null ? "" : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${d && !ok ? ` — ${d}` : ""}`)
  return !!ok
}
function skip(name, why) {
  skipped++
  console.log(`SKIP ${name} — ${why}`)
}

/* ---------------- Needles (the sample catalogue) ---------------- */

const src = (f) => readFileSync(path.join(root, "src/lib/data", f), "utf8")
const brandsTs = src("brands.ts")
const productsTs = src("products.ts")
const catalogTs = src("catalog.ts")

const brandIds = [...new Set([...brandsTs.matchAll(/\bid: "(b_[a-z0-9_]+)"/g)].map((m) => m[1]))]
const brandHandles = [...new Set([...brandsTs.matchAll(/\bhandle: "([a-z0-9-]+)"/g)].map((m) => m[1]))]
const brandNames = [...new Set([...brandsTs.matchAll(/^\s{4}name: "([^"]+)"/gm)].map((m) => m[1]))]
const productSlugs = [...new Set([...productsTs.matchAll(/\bslug: "([a-z0-9-]+)"/g)].map((m) => m[1]))]
const productIds = productSlugs.map((s) => `p_${s.replace(/-/g, "_")}`)
const variantIds = productIds.map((id) => `${id}_v0`)
const productNames = [...new Set([...productsTs.matchAll(/\bslug: "[a-z0-9-]+",\s*name: "([^"]+)"/g)].map((m) => m[1]))]
const dropRows = [...catalogTs.matchAll(/\{ id: "(d_[a-z0-9_]+)", slug: "([a-z0-9-]+)", brandId: "(b_[a-z0-9_]+)"/g)].map((m) => ({ id: m[1], slug: m[2], brandId: m[3] }))
const collectionRows = [...catalogTs.matchAll(/\{ id: "(c_[a-z0-9_]+)", brandId: "(b_[a-z0-9_]+)", handle: "([a-z0-9-]+)"/g)].map((m) => ({ id: m[1], brandId: m[2], handle: m[3] }))
const dropNames = [...new Set([...catalogTs.matchAll(/\{ id: "d_[a-z0-9_]+", slug: "[a-z0-9-]+", brandId: "b_[a-z0-9_]+", name: "([^"]+)"/g)].map((m) => m[1]))]
const collectionNames = [...new Set([...catalogTs.matchAll(/\{ id: "c_[a-z0-9_]+", brandId: "b_[a-z0-9_]+", handle: "[a-z0-9-]+", name: "([^"]+)"/g)].map((m) => m[1]))]
const curatedRows = [...catalogTs.matchAll(/\{ id: "(cc_[a-z0-9_]+)", slug: "([a-z0-9-]+)", name: "([^"]+)"/g)].map((m) => ({ id: m[1], slug: m[2], name: m[3] }))
const storiesTs = catalogTs.slice(catalogTs.indexOf("export const stories"))
const storySlugs = [...new Set([...storiesTs.matchAll(/^\s{4}slug: "([a-z0-9-]+)"/gm)].map((m) => m[1]))]
const storyTitles = [...new Set([...storiesTs.matchAll(/^\s{4}title: "([^"]+)"/gm)].map((m) => m[1]))]
// Names as whole words: only those of two words or more, so a one-word name ("Core", "Prints") can
// never match ordinary copy. Sample-only wording (the demo's chart and order labels) is a needle too.
const multiWord = (n) => /\S\s+\S/.test(n)
const SAMPLE_WORDING = [/sample activity/i, /sample order history/i, /preview catalogue(?! were removed)/i]

check("needles: sample brands parsed", brandIds.length >= 10 && brandHandles.length === brandIds.length && brandNames.length >= brandIds.length, { ids: brandIds.length, handles: brandHandles.length, names: brandNames.length })
check("needles: sample products parsed", productSlugs.length >= 50, { slugs: productSlugs.length, names: productNames.length })
check("needles: sample drops parsed", dropRows.length >= 5 && dropNames.length === dropRows.length, { drops: dropRows.length, names: dropNames.length })
check("needles: sample stories, collections and curated collections parsed", storySlugs.length >= 3 && storyTitles.length === storySlugs.length && curatedRows.length >= 3 && collectionNames.length >= 5, { stories: storySlugs.length, titles: storyTitles.length, curated: curatedRows.length, collections: collectionNames.length })

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
// Handles and slugs as links (/brands/<h>, /products/<s>, /drops/<s>); ids as whole tokens; names
// case-sensitively as whole words. Generic collection handles (core, bags) are never bare-word needles.
const needles = [
  ...brandHandles.map((h) => ({ kind: "brand link", re: new RegExp(`/brands/${esc(h)}(?![a-z0-9-])`) })),
  ...productSlugs.map((s) => ({ kind: "product link", re: new RegExp(`/products/${esc(s)}(?![a-z0-9-])`) })),
  ...dropRows.map((d) => ({ kind: "drop link", re: new RegExp(`/drops/${esc(d.slug)}(?![a-z0-9-])`) })),
  ...[...brandIds, ...productIds, ...dropRows.map((d) => d.id), ...collectionRows.map((c) => c.id)].map((id) => ({ kind: "sample id", re: new RegExp(`(?<![A-Za-z0-9_])${esc(id)}(?![A-Za-z0-9_])`) })),
  ...storySlugs.map((s) => ({ kind: "story link", re: new RegExp(`/stories/${esc(s)}(?![a-z0-9-])`) })),
  ...curatedRows.map((c) => ({ kind: "collection link", re: new RegExp(`/collections/${esc(c.slug)}(?![a-z0-9-])`) })),
  ...curatedRows.map((c) => ({ kind: "sample id", re: new RegExp(`(?<![A-Za-z0-9_])${esc(c.id)}(?![A-Za-z0-9_])`) })),
  ...brandNames.map((n) => ({ kind: "brand name", re: new RegExp(`(?<![A-Za-z])${esc(n)}(?![A-Za-z])`) })),
  ...productNames.filter(multiWord).map((n) => ({ kind: "piece name", re: new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`) })),
  ...dropNames.filter(multiWord).map((n) => ({ kind: "drop name", re: new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`) })),
  ...storyTitles.filter(multiWord).map((n) => ({ kind: "story title", re: new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`) })),
  ...[...curatedRows.map((c) => c.name), ...collectionNames].filter(multiWord).map((n) => ({ kind: "collection name", re: new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`) })),
  ...SAMPLE_WORDING.map((re) => ({ kind: "sample wording", re })),
]
/** A sample brand handle as a bare word (the visible text of a page, never its own URL). */
const handleWords = brandHandles.map((h) => ({ kind: "brand handle", re: new RegExp(`(?<![A-Za-z0-9-])${esc(h)}(?![A-Za-z0-9-])`) }))
function textHits(text) {
  const out = hits(text)
  for (const n of handleWords) {
    if (out.length >= 5) break
    const m = n.re.exec(text)
    if (m) out.push(`${n.kind}: ${m[0]}`)
  }
  return out
}
/** The needles found in a body (at most 5, with their kind). */
function hits(text) {
  const out = []
  for (const n of needles) {
    const m = n.re.exec(text)
    if (m) out.push(`${n.kind}: ${m[0]}`)
    if (out.length >= 5) break
  }
  return out
}

/* ---------------- HTTP ---------------- */

let anonJar = ""
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

async function request(method, p, { body, cookie, headers, rsc } = {}) {
  const h = { ...(headers ?? {}) }
  if (method !== "GET") Object.assign(h, { Origin: base, "X-Yard-Client": "1" })
  if (body !== undefined) h["Content-Type"] = "application/json"
  const jar = cookie ?? anonJar
  if (jar) h.Cookie = jar
  if (rsc) Object.assign(h, { RSC: "1" })
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${base}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" })
    if (cookie === undefined) anonJar = mergeCookies(anonJar, res)
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, Math.min(30, Number(res.headers.get("retry-after") ?? 5)) * 1000))
      continue
    }
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    return { status: res.status, text, json, headers: res.headers }
  }
}
const get = (p, o) => request("GET", p, o)

/* ---------------- 0. The target is production ---------------- */

const session = await get("/api/session")
if (!check("target: /api/session answers", session.status === 200, session.status)) process.exit(1)
if (!check("target: sample data is OFF (production mode)", session.json?.sampleData === false, session.json?.sampleData)) {
  console.error(`Aborting: ${base} serves sample data (demo mode). Point YARD_PROD_BASE at a production-mode server.`)
  process.exit(1)
}

/* ---------------- 1. Pages carry no sample needle ---------------- */

const { categories = [] } = (await get("/api/catalog/categories")).json ?? {}
const pages = ["/", "/brands", "/shop", "/categories", ...categories.map((c) => `/categories/${c.slug}`), "/drops", "/charts", "/around", "/following", "/wishlist", "/welcome", "/sign-in", "/bag", "/you", "/notifications"]
const linked = new Set()
for (const p of pages) {
  const r = await get(p)
  const found = hits(r.text)
  check(`page ${p}: ${r.status < 400 || r.status === 404 ? "renders" : "renders (status)"} without sample brands, pieces or drops`, r.status < 500 && !found.length, found.length ? found : r.status)
  for (const m of r.text.matchAll(/href="(\/(?:brands|products)\/[^"?#/]+)"/g)) linked.add(m[1])
}
for (const p of ["/shop", "/brands"]) {
  const r = await get(p, { rsc: true })
  check(`client navigation payload ${p} (RSC) has no sample needle`, r.status < 500 && !hits(r.text).length, hits(r.text))
}
for (const p of [...linked].slice(0, 60)) {
  const r = await get(p)
  check(`linked ${p} (real) has no sample needle`, r.status === 200 && !hits(r.text).length, hits(r.text).length ? hits(r.text) : r.status)
}

/* ---------------- 2. API lists carry no sample needle ---------------- */

{
  let offset = 0
  let pagesRead = 0
  let bad = []
  for (;;) {
    const r = await get(`/api/catalog/products?limit=60&offset=${offset}`)
    if (r.status !== 200) {
      bad = [`status ${r.status}`]
      break
    }
    bad.push(...hits(r.text))
    pagesRead++
    if (r.json.nextOffset === null || pagesRead > 50) break
    offset = r.json.nextOffset
  }
  check("api /api/catalog/products (every page) lists no sample piece", !bad.length, bad)
}
{
  let offset = 0
  let bad = []
  let total = null
  for (let i = 0; i < 50; i++) {
    const r = await get(`/api/catalog/brands?limit=60&offset=${offset}`)
    if (r.status !== 200) {
      bad = [`status ${r.status}`]
      break
    }
    total ??= r.json.total
    bad.push(...hits(r.text))
    if (r.json.nextOffset === null) break
    offset = r.json.nextOffset
  }
  check("api /api/catalog/brands (every page) lists no sample brand", !bad.length, bad)
}
for (const p of ["/api/catalog/categories", "/api/drops?phase=all&limit=50", "/api/drops?phase=upcoming", "/api/charts", "/api/charts/brands", "/api/around/places", "/api/around/online-brands?city=lagos", "/api/around/online-brands?city=accra"]) {
  const r = await get(p)
  check(`api ${p} has no sample needle`, r.status < 500 && !hits(r.text).length, hits(r.text).length ? hits(r.text) : r.status)
}
{
  const bad = []
  for (const name of [...brandNames, ...productNames.slice(0, 30)]) {
    const s = await get(`/api/search?q=${encodeURIComponent(name)}`)
    const g = await get(`/api/search/suggest?q=${encodeURIComponent(name.slice(0, Math.max(3, Math.min(8, name.length))))}`)
    for (const r of [s, g]) {
      if (r.status >= 500) bad.push(`${name}: status ${r.status}`)
      const h = hits(r.text)
      if (h.length) bad.push(`${name}: ${h[0]}`)
    }
  }
  check(`search and suggest for ${brandNames.length} sample brand and ${Math.min(30, productNames.length)} piece names find nothing sample`, !bad.length, bad.slice(0, 5))
}
{
  // A shopper filtering on a sample brand's handle (an old link): the facet names no sample brand.
  const r = await get(`/api/search?brandHandles=${brandHandles.join(",")}`)
  const sel = r.json?.facets?.selectedBrands ?? []
  const bad = sel.filter((b) => brandIds.includes(b.value) || brandNames.includes(b.label) || brandHandles.includes(b.handle))
  check(`api /api/search?brandHandles=<all ${brandHandles.length} sample handles>: selectedBrands names no sample brand`, r.status === 200 && !bad.length && !hits(JSON.stringify(r.json?.facets ?? {})).length, r.status !== 200 ? r.status : bad.length ? bad.slice(0, 3) : hits(JSON.stringify(r.json?.facets ?? {})))
  for (const h of brandHandles.slice(0, 3)) {
    const one = await get(`/api/search?brandHandles=${h}`)
    check(`api /api/search?brandHandles=${h}: no sample id or name in the facets`, one.status === 200 && !hits(JSON.stringify(one.json?.facets ?? {})).length, one.status === 200 ? hits(JSON.stringify(one.json?.facets ?? {})) : one.status)
  }
}

/* ---------------- 3. Sample addresses are 404 ---------------- */

{
  const bad = []
  for (const h of brandHandles) {
    const r = await get(`/brands/${h}`)
    if (r.status !== 404) bad.push(`/brands/${h} ${r.status}`)
  }
  for (const c of collectionRows) {
    const h = brandHandles[brandIds.indexOf(c.brandId)]
    if (!h) continue
    const r = await get(`/brands/${h}/collections/${c.handle}`)
    if (r.status !== 404) bad.push(`/brands/${h}/collections/${c.handle} ${r.status}`)
  }
  check(`every sample storefront and collection address (${brandHandles.length} + ${collectionRows.length}) answers 404`, !bad.length, bad.slice(0, 5))
}
{
  const bad = []
  for (const s of productSlugs) {
    const r = await get(`/products/${s}`)
    if (r.status !== 404) bad.push(`/products/${s} ${r.status}`)
  }
  check(`every sample product page (${productSlugs.length}) answers 404`, !bad.length, bad.slice(0, 5))
}
{
  const bad = []
  for (const d of dropRows) {
    const r = await get(`/drops/${d.slug}`)
    if (r.status !== 404) bad.push(`/drops/${d.slug} ${r.status}`)
  }
  check(`every sample drop page (${dropRows.length}) answers 404`, !bad.length, bad.slice(0, 5))
}
{
  const bad = []
  for (const [kind, key] of [...brandHandles.map((h) => ["brand", h]), ...brandIds.map((id) => ["brand", id]), ...productSlugs.slice(0, 20).map((s) => ["product", s]), ...productIds.slice(0, 20).map((id) => ["product", id]), ...dropRows.map((d) => ["drop", d.slug])]) {
    const r = await get(`/api/pages/exists?kind=${kind}&key=${encodeURIComponent(key)}`)
    if (r.json?.exists !== false) bad.push(`${kind} ${key}: ${r.status} ${r.text.slice(0, 60)}`)
  }
  check("/api/pages/exists says no for sample brands, pieces and drops", !bad.length, bad.slice(0, 5))
}
{
  const bad = []
  for (const h of [...brandHandles.slice(0, 5), ...brandIds.slice(0, 5)]) {
    const r = await get(`/api/catalog/storefronts/${h}`)
    if (r.status !== 404) bad.push(`storefront ${h} ${r.status}`)
  }
  for (const s of [...productSlugs.slice(0, 5), ...productIds.slice(0, 5)]) {
    const r = await get(`/api/catalog/products/${s}`)
    if (r.status !== 404) bad.push(`product ${s} ${r.status}`)
  }
  const v = await get(`/api/catalog/variants?${variantIds.slice(0, 5).map((id) => `ids=${id}`).join("&")}`)
  if (v.status >= 500 || hits(v.text).length) bad.push(`variants ${v.status} ${hits(v.text)[0] ?? ""}`)
  check("catalogue API answers 404 for sample storefronts and pieces, and prices no sample variant", !bad.length, bad.slice(0, 5))
}
for (const p of ["/stories", "/collections"]) {
  const r = await get(p)
  check(`${p} redirects to coming soon (307)`, r.status === 307 && /coming-soon/.test(r.headers.get("location") ?? ""), `${r.status} ${r.headers.get("location")}`)
}

{
  // The demo shopper's sample checkouts: not on the server, so not found (the leak was client-only;
  // the browser part below renders these pages too).
  const bad = []
  for (const g of ["cg_ada_1", "cg_ada_2", "cg_ada_3"]) {
    const r = await get(`/api/checkout/${g}`)
    if (![401, 404].includes(r.status) || hits(r.text).length) bad.push(`${g}: ${r.status} ${hits(r.text)[0] ?? ""}`)
    const page = await get(`/checkout/confirmation?group=${g}`)
    if (page.status >= 500 || hits(page.text).length) bad.push(`page ${g}: ${page.status} ${hits(page.text)[0] ?? ""}`)
  }
  check("sample checkouts cg_ada_1..3: the API doesn't know them and the page HTML has no sample needle", !bad.length, bad)
}

/* ---------------- 4. The API refuses sample ids (anonymous) ---------------- */

const V0 = variantIds[0]
const P0 = productIds[0]
const B0 = brandIds[0]
const D0 = dropRows[0]
{
  const add = await get("/api/cart") // an anonymous cart cookie, as a shopper's browser would get one
  void add
  const r = await request("POST", "/api/cart/lines", { body: { variantId: V0, qty: 1 } })
  check(`POST /api/cart/lines with a sample variant (${V0}) → 404`, r.status === 404, `${r.status} ${r.text.slice(0, 120)}`)
  const p = await request("PATCH", `/api/cart/lines/${V0}`, { body: { qty: 2 } })
  check("PATCH /api/cart/lines/<sample variant> → 404", p.status === 404, `${p.status} ${p.text.slice(0, 120)}`)
  const c = await get("/api/cart?currency=USD")
  check("GET /api/cart lists no sample line", c.status === 200 && !(c.json?.lines ?? []).some((l) => variantIds.includes(l.variantId) || productIds.includes(l.productId)), c.text.slice(0, 200))
}
{
  const r = await request("POST", "/api/shipping/quote", { body: { to: "NG", currency: "NGN", groups: [{ brandId: B0, lines: [{ productId: P0, variantId: V0, qty: 1 }] }] } })
  check("POST /api/shipping/quote with a sample piece → 400 (never 503)", r.status === 400, `${r.status} ${r.text.slice(0, 160)}`)
  const e = await get(`/api/shipping/estimate?product=${P0}&to=NG`)
  check("GET /api/shipping/estimate for a sample piece → 404", e.status === 404, `${e.status} ${e.text.slice(0, 160)}`)
}
{
  const bad = []
  for (const body of [{ kind: "product_view", productId: P0 }, { kind: "storefront_view", brandId: B0 }, { kind: "post_open", brandId: B0 }, { kind: "follow", brandId: B0 }, { kind: "wishlist_add", productId: P0 }, { kind: "reminder_set", dropId: D0.id }]) {
    const r = await request("POST", "/api/signals", { body })
    if (![400, 401, 404].includes(r.status)) bad.push(`${body.kind}: ${r.status} ${r.text.slice(0, 80)}`)
  }
  check("POST /api/signals with sample ids → 400/401 (never 2xx or 500)", !bad.length, bad)
}
{
  const r = await get(`/api/brands/${B0}/social-posts`)
  check("GET /api/brands/<sample brand>/social-posts → 404", r.status === 404, r.status)
}
if (!COOKIE) {
  const bad = []
  for (const [m, p, body] of [
    ["POST", "/api/wishlist", { productId: P0 }],
    ["POST", "/api/wishlist/merge", { productIds: [P0], brandIds: [B0] }],
    ["POST", "/api/wishlist/back-in-stock", { variantId: V0 }],
    ["POST", "/api/follows", { brandId: B0 }],
    ["POST", `/api/drops/${D0.id}/reminder`, {}],
  ]) {
    const r = await request(m, p, { body })
    if (r.status !== 401 && r.status !== 404) bad.push(`${p}: ${r.status}`)
  }
  check("signed-out wishlist / merge / back in stock / follow / reminder → 401 (or 404), never a write", !bad.length, bad)
  skip("signed-in refusals (wishlist, merge, back in stock, follow, reminder, checkout)", "set YARD_PROD_SHOPPER_COOKIE to run them")
}

/* ---------------- 5. The API refuses sample ids (signed in) ---------------- */

if (COOKIE) {
  const as = { cookie: COOKIE }
  const w = await request("POST", "/api/wishlist", { ...as, body: { productId: P0 } })
  check("signed in: POST /api/wishlist with a sample piece → 404", w.status === 404, `${w.status} ${w.text.slice(0, 120)}`)
  const m = await request("POST", "/api/wishlist/merge", { ...as, body: { productIds: [P0], brandIds: [B0] } })
  check("signed in: /api/wishlist/merge reports sample ids as skipped", m.status === 200 && m.json?.skipped?.includes(P0) && m.json?.skipped?.includes(B0) && m.json.saved === 0 && m.json.followed === 0, m.text.slice(0, 200))
  const b = await request("POST", "/api/wishlist/back-in-stock", { ...as, body: { variantId: V0 } })
  check("signed in: back in stock for a sample variant → 404", b.status === 404, `${b.status} ${b.text.slice(0, 120)}`)
  const f = await request("POST", "/api/follows", { ...as, body: { brandId: B0 } })
  check("signed in: follow a sample brand → 404", f.status === 404, `${f.status} ${f.text.slice(0, 120)}`)
  const rm = await request("POST", `/api/drops/${D0.id}/reminder`, { ...as, body: {} })
  check("signed in: reminder for a sample drop → 404", rm.status === 404, `${rm.status} ${rm.text.slice(0, 120)}`)
  const ca = await request("POST", "/api/cart/lines", { ...as, body: { variantId: V0, qty: 1 } })
  check("signed in: cart add of a sample variant → 404", ca.status === 404, ca.status)
  const co = await request("POST", "/api/checkout", { ...as, body: { currency: "NGN", shipTo: { name: "Kit", line1: "1 Kit Street", city: "Lagos", country: "NG", phone: "+2348000000000" }, shipping: [{ brandId: B0, service: "standard" }] }, headers: { "Idempotency-Key": `prod-clean-${Date.now()}` } })
  check("signed in: checkout never starts with sample pieces (4xx)", co.status >= 400 && co.status < 500, `${co.status} ${co.text.slice(0, 160)}`)
  const wl = await get("/api/wishlist", as)
  const fl = await get("/api/follows", as)
  check("signed in: wishlist and follows list no sample id", wl.status === 200 && fl.status === 200 && !hits(wl.text + fl.text).length, hits(wl.text + fl.text))
}

/* ---------------- 6. A returning browser with old sample lines (Playwright) ---------------- */

let playwright = null
if (process.env.YARD_PROD_BROWSER !== "0") {
  try {
    playwright = createRequire(import.meta.url)("playwright")
  } catch {
    try {
      playwright = createRequire(path.join(root, "package.json"))("playwright")
    } catch {}
  }
}
if (!playwright) skip("browser: stored sample cart / saved lists / widths", "Playwright not available (or YARD_PROD_BROWSER=0)")
else {
  const browser = await playwright.chromium.launch()
  try {
    const now = Date.now()
    const cart = { state: { lines: [{ productId: P0, variantId: V0, quantity: 2, addedAt: now }], unavailable: [{ productId: productIds[1], variantId: variantIds[1], quantity: 1, addedAt: now, reason: "No longer available" }] }, version: 0 }
    const saved = { state: { wishlist: [P0, productIds[2]], following: [B0, brandIds[1]], notify: [D0.id], recentlyViewed: [P0], owner: null, unmerged: false }, version: 0 }
    const notes = { state: { items: [{ id: "n_kit", eventKey: "c:shipped:o_kit", audience: "customer", category: "order_shipped", title: `${brandNames[0]} shipped your order`, body: "Kit", href: "/you/orders/o_kit", at: new Date().toISOString(), sample: true, read: false }], seeded: { customer: true, merchant: true, admin: true } }, version: 0 }
    const orders = { state: { groups: [{ id: "cg_ada_1", reference: "YRD-8F2K-91", customerId: "u_ada", placedAt: new Date().toISOString(), currency: "NGN", orderIds: ["mo_kit"], total: 100 }], orders: [], processedKeys: {} }, version: 2 }
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(
      ([c, s, n, o]) => {
        if (sessionStorage.getItem("kit-seeded")) return
        sessionStorage.setItem("kit-seeded", "1")
        localStorage.setItem("nocturne-cart", c)
        localStorage.setItem("yard:cart:server-v1", "")
        localStorage.setItem("nocturne-saved", s)
        localStorage.setItem("nocturne-notifications", n)
        localStorage.setItem("nocturne-orders", o)
      },
      [JSON.stringify(cart), JSON.stringify(saved), JSON.stringify(notes), JSON.stringify(orders)],
    )
    const page = await ctx.newPage()
    const posted = []
    page.on("request", (r) => {
      if (r.method() !== "GET" && /\/api\/(cart|wishlist|follows)/.test(r.url()) && /p_|b_|d_/.test(r.postData() ?? "")) {
        const body = r.postData() ?? ""
        if (needles.some((n) => n.kind === "sample id" && n.re.test(body))) posted.push(`${r.method()} ${new URL(r.url()).pathname}`)
      }
    })
    await page.goto(`${base}/`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1200)
    const toast = await page.getByText("removed from your cart", { exact: false }).count()
    check("browser: one notice says preview pieces left the cart", toast >= 1, toast)
    const stored = await page.evaluate(() => ({ cart: localStorage.getItem("nocturne-cart"), saved: localStorage.getItem("nocturne-saved"), notes: localStorage.getItem("nocturne-notifications"), orders: localStorage.getItem("nocturne-orders") }))
    const storedHits = hits(JSON.stringify(stored))
    if (/cg_ada_/.test(stored.orders ?? "")) storedHits.push("orders: cg_ada_1")
    check("browser: the stored cart, saved lists, notifications and sample checkouts hold no sample id any more", !storedHits.length, storedHits)
    await page.goto(`${base}/checkout/confirmation?group=cg_ada_1`, { waitUntil: "networkidle" })
    await page.waitForTimeout(1500)
    const kept = await page.evaluate(() => document.body.innerText)
    check("browser: a sample checkout this browser kept doesn't render (cg_ada_1)", !/order confirmed|YRD-8F2K-91/i.test(kept) && !textHits(kept).length, textHits(kept).length ? textHits(kept) : kept.slice(0, 200))
    check("browser: no sample id was sent to the cart, wishlist or follows API", !posted.length, posted)
    const labels = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Cart, "]')].map((b) => b.getAttribute("aria-label")))
    check("browser: the cart button counts no purged line (Cart, 0 items)", labels.length > 0 && labels.every((l) => l === "Cart, 0 items"), labels)
    for (const p of ["/bag", "/wishlist", "/following", "/you", "/notifications"]) {
      await page.goto(`${base}${p}`, { waitUntil: "networkidle" })
      await page.waitForTimeout(600)
      const text = await page.evaluate(() => document.body.innerText)
      check(`browser: ${p} shows nothing from the sample catalogue`, !hits(text).length, hits(text))
    }
    await page.goto(`${base}/`, { waitUntil: "networkidle" })
    await page.waitForTimeout(800)
    const again = await page.getByText("removed from your cart", { exact: false }).count()
    check("browser: the notice doesn't come back on the next page load", again === 0, again)
    await ctx.close()

    // Rendered text (client components included): what the HTML can't show.
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const pg = await c.newPage()
      const textOf = async (url, wait = 900) => {
        const res = await pg.goto(`${base}${url}`, { waitUntil: "networkidle" })
        await pg.waitForTimeout(wait)
        return { status: res?.status() ?? 0, text: await pg.evaluate(() => document.body.innerText) }
      }
      for (const g of ["cg_ada_1", "cg_ada_2", "cg_ada_3"]) {
        const { text } = await textOf(`/checkout/confirmation?group=${g}`, 1500)
        const leaked = textHits(text)
        const confirmed = /order confirmed|YRD-[0-9A-Z]{4}-[0-9]{2}/i.test(text)
        check(`browser: /checkout/confirmation?group=${g} shows no sample checkout (not found / sign in)`, !leaked.length && !confirmed && /can.t find that checkout|sign in to see this checkout/i.test(text), leaked.length ? leaked : text.slice(0, 200))
      }
      const catSlug = categories[0]?.slug ?? "streetwear"
      for (const h of brandHandles) {
        for (const url of [`/shop?brands=${h}`, ...(h === brandHandles[0] ? [`/categories/${catSlug}?brands=${h}`] : [])]) {
          const { text } = await textOf(url, 600)
          check(`browser: ${url} names no sample brand (chip, facet or mark)`, !textHits(text).length, textHits(text))
        }
      }
      for (const url of ["/", "/charts"]) {
        const { text } = await textOf(url, 1500)
        check(`browser: ${url} says nothing about sample activity (no "Sample" chip)`, !textHits(text).length && !/(^|\n)\s*Sample\s*($|\n)/.test(text), textHits(text).length ? textHits(text) : "a bare Sample chip")
      }
      // The search overlay's "Try" chips: never a search only the sample catalogue answers.
      await pg.goto(`${base}/`, { waitUntil: "networkidle" })
      await pg.getByRole("button", { name: /^Search brands and products/ }).first().click()
      await pg.waitForTimeout(900)
      const overlay = await pg.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "")
      check("browser: the search overlay's suggestions hold no sample-only word (kente) or sample name", overlay.length > 0 && !/\bkente\b/i.test(overlay) && !textHits(overlay).length, textHits(overlay).length ? textHits(overlay) : overlay.slice(0, 200))
      await pg.getByRole("dialog").getByRole("textbox").first().fill("zzqxnothing")
      await pg.waitForTimeout(1200)
      const none = await pg.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "")
      check("browser: a search with no results says so, with no sample suggestion", /Nothing matches/.test(none) && !textHits(none).length, none.slice(0, 200))
      // Pages the nav and footer reach, rendered.
      const navLinks = await (async () => {
        await pg.goto(`${base}/`, { waitUntil: "networkidle" })
        return pg.evaluate(() => [...new Set([...document.querySelectorAll("header a[href^='/'], footer a[href^='/'], nav a[href^='/']")].map((a) => a.getAttribute("href").split("#")[0]).filter((h) => h && !h.startsWith("/api")))])
      })()
      const badNav = []
      for (const url of navLinks.slice(0, 60)) {
        const { text } = await textOf(url, 500)
        const h = textHits(text)
        if (h.length) badNav.push(`${url}: ${h[0]}`)
      }
      check(`browser: ${navLinks.length} pages linked from the header, nav and footer render no sample name, handle or wording`, navLinks.length > 3 && !badNav.length, badNav.length ? badNav.slice(0, 5) : navLinks.length)
      await c.close()
    }

    for (const width of [1440, 390, 320]) {
      const c = await browser.newContext({ viewport: { width, height: 900 } })
      const pg = await c.newPage()
      for (const p of ["/brands", "/following", "/wishlist", "/bag", "/categories", "/shop", ...(categories[0] ? [`/categories/${categories[0].slug}`] : [])]) {
        await pg.goto(`${base}${p}`, { waitUntil: "networkidle" })
        await pg.waitForTimeout(400)
        const o = await pg.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
        check(`browser ${width}: ${p} has no sideways scroll`, o.sw <= o.iw, o)
      }
      await c.close()
    }
  } finally {
    await browser.close()
  }
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`)
process.exit(failed ? 1 : 0)
