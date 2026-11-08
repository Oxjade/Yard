#!/usr/bin/env node
// CATALOG v3 live acceptance kit. Plain Node 22 (fetch, no deps). Prints one PASS/FAIL line per check
// and exits non-zero when any check fails.
//
//   node scripts/checks/v3-catalog.mjs            (server at YARD_BASE, default http://localhost:3000)
//
// Needs a DEVELOPMENT server (demo sign-in on, the dev-only routes under /api/studio/catalog/dev,
// the stub email provider printing to the dev log). Env:
//   YARD_BASE     server origin
//   YARD_DEV_LOG  the dev server's stdout log (sign-up verification links are read from it)
//
// Test data: every record carries this run's tag (t_v3_catalog_<run> in titles / hold keys / emails,
// t-v3-<run> in handles). Products created in the seeded brand are archived and collections deleted at
// the end; the brand created through onboarding belongs to the run's own signed-up account. Seeded
// rows are only read, never changed.
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { deflateSync, crc32 } from "node:zlib"

let base = (process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
const DEV_LOG = process.env.YARD_DEV_LOG ?? "/tmp/claude-0/-home-user/e300ec86-35a4-5f82-b2d8-95972eccde0c/scratchpad/dev.log"
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const TAG = `t_v3_catalog_${RUN}`
const HTAG = `t-v3-${RUN}`

let failed = 0
let passed = 0
let quiet = false
const results = []
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail !== "" && detail !== undefined && detail !== null ? (typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)) : ""
  results.push({ status: ok ? "PASS" : "FAIL", name, detail: d })
  if (!quiet) console.log(`${ok ? "PASS" : "FAIL"} ${name}${d ? ` — ${d}` : ""}`)
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

async function api(method, path, { cookie, body, headers, raw } = {}) {
  const h = { Origin: base, "X-Yard-Client": "1", ...(cookie ? { cookie } : {}), ...(headers ?? {}) }
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
const put = (p, body, o = {}) => api("PUT", p, { ...o, body })
const patch = (p, body, o = {}) => api("PATCH", p, { ...o, body })
const del = (p, o) => api("DELETE", p, o)
const brief = (r) => `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message} ${r.body.error.fields ? JSON.stringify(r.body.error.fields) : ""}` : r.text.slice(0, 200)}`

async function demo(actor, account, brandId) {
  const r = await post("/api/auth/demo", { actor, account, ...(brandId ? { brandId } : {}) })
  if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
  return { cookie: mergeCookies("", r.res), profile: r.body.profile }
}

/* ---------------- fixtures ---------------- */

/** A valid 96x96 RGB PNG, built here so the kit has no file dependencies. */
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
    for (let x = 0; x < w; x++) rows.push(Buffer.from([(x * 2) & 255, (y * 2) & 255, 128]))
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
}

async function uploadBrandImage(cookie) {
  const boundary = `----yardkit${RUN}`
  const file = pngBytes()
  const bodyBuf = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}.png"\r\nContent-Type: image/png\r\n\r\n`),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return api("POST", `/api/uploads?purpose=social_post&as=brand`, { cookie, raw: bodyBuf, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(bodyBuf.length) } })
}

/** Signs up a new account and confirms it through the link the stub email provider prints to the dev log. */
async function signUpShopper(email, password) {
  const r = await post("/api/auth/sign-up", { name: "Catalog Kit", email, password })
  if (r.status !== 200) throw new Error(`sign-up: ${brief(r)}`)
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
  const v = await post("/api/auth/verify-email/confirm", { token })
  if (v.status !== 200) throw new Error(`verify-email: ${brief(v)}`)
  return mergeCookies("", v.res)
}

/* ---------------- the kit ---------------- */

const created = { products: [], collections: [] }

async function main() {
  if (!quiet) console.log(`# CATALOG v3 kit against ${base}, run ${TAG}`)

  /* ===== Public reads ===== */
  {
    const cats = await get("/api/catalog/categories")
    check("public: GET categories 200 with seeded categories", cats.status === 200 && cats.body?.categories?.some((c) => c.slug === "fashion" && Array.isArray(c.subcategories)), brief(cats).slice(0, 120))
    check("public: categories are cacheable", /public/.test(cats.headers.get("cache-control") ?? ""), cats.headers.get("cache-control"))

    const list = await get("/api/catalog/products?limit=60")
    const products = list.body?.products ?? []
    check("public: GET products 200 with seeded products", list.status === 200 && products.length > 0 && list.body.total >= products.length, `${products.length} of ${list.body?.total}`)
    check("public: products are cacheable (max-age=30)", /public.*max-age=30/.test(list.headers.get("cache-control") ?? ""), list.headers.get("cache-control"))
    check(
      "public: product DTOs carry integer minor prices and no internal fields",
      products.every((p) => Number.isInteger(p.priceMinor) && typeof p.currency === "string" && p.brand?.id === p.brandId && !("version" in p) && !("moderationStatus" in p) && p.variants.every((v) => !("onHand" in v) && !("held" in v) && Number.isInteger(v.available))),
    )
    check("public: no unpublished or test-hidden product leaks into the list", products.every((p) => p.publishedAt !== undefined))

    const byBrand = await get("/api/catalog/products?brand=b_lagos_static&limit=60")
    check("public: brand filter (id) returns only that brand", byBrand.status === 200 && byBrand.body.products.length > 0 && byBrand.body.products.every((p) => p.brandId === "b_lagos_static"), `${byBrand.body?.total}`)
    const handle = byBrand.body?.products?.[0]?.brand?.handle
    const byHandle = await get(`/api/catalog/products?brand=${handle}&limit=60`)
    check("public: brand filter by handle matches the id filter", byHandle.status === 200 && byHandle.body.total === byBrand.body.total, `${handle}: ${byHandle.body?.total} vs ${byBrand.body?.total}`)

    const cat = await get("/api/catalog/products?category=fashion&limit=60")
    check("public: category filter", cat.status === 200 && cat.body.products.length > 0 && cat.body.products.every((p) => p.category === "fashion"))

    const asc = await get("/api/catalog/products?sort=price_asc&limit=60")
    const ap = asc.body?.products?.map((p) => p.priceMinor) ?? []
    check("public: sort=price_asc is ascending", asc.status === 200 && ap.every((x, i) => i === 0 || ap[i - 1] <= x))
    const desc = await get("/api/catalog/products?sort=price_desc&limit=60")
    const dp = desc.body?.products?.map((p) => p.priceMinor) ?? []
    check("public: sort=price_desc is descending", desc.status === 200 && dp.every((x, i) => i === 0 || dp[i - 1] >= x))

    const p1 = await get("/api/catalog/products?limit=2&offset=0&sort=title")
    const p2 = await get("/api/catalog/products?limit=2&offset=2&sort=title")
    check(
      "public: paging (limit/offset/nextOffset) has no overlap",
      p1.status === 200 && p2.status === 200 && p1.body.nextOffset === 2 && p1.body.products.length === 2 && !p2.body.products.some((x) => p1.body.products.some((y) => y.id === x.id)),
    )
    check("public: limit over 60 is 400", (await get("/api/catalog/products?limit=61")).status === 400)
    check("public: unknown sort is 400", (await get("/api/catalog/products?sort=cheapest")).status === 400)
    check("public: malformed brand id is 400", (await get("/api/catalog/products?brand=a%20b")).status === 400)

    const ids = products.slice(0, 2).map((p) => p.id)
    const byIds = await get(`/api/catalog/products?${ids.map((i) => `ids=${i}`).join("&")}`)
    check("public: ids filter returns exactly those products", byIds.status === 200 && byIds.body.total === ids.length && byIds.body.products.every((p) => ids.includes(p.id)), `${byIds.body?.total}`)

    const instock = await get("/api/catalog/products?inStock=1&limit=60")
    check("public: inStock=1 only returns products with available stock", instock.status === 200 && instock.body.products.every((p) => p.available > 0))

    const sample = products[0]
    const bySlug = await get(`/api/catalog/products/${sample.slug}`)
    const byId = await get(`/api/catalog/products/${sample.id}`)
    check("public: product by slug and by id", bySlug.status === 200 && byId.status === 200 && bySlug.body.product.id === sample.id && byId.body.product.slug === sample.slug)
    check("public: unknown product is 404", (await get(`/api/catalog/products/${TAG}-nope`)).status === 404)
    check("public: product path with unsafe characters is 404", (await get(`/api/catalog/products/a.b%00`)).status === 404)

    const vids = sample.variants.slice(0, 2).map((v) => v.id)
    const vars = await get(`/api/catalog/variants?${[...vids, `pv_${TAG}_missing`].map((i) => `ids=${i}`).join("&")}`)
    check(
      "public: variants returns live availability and leaves unknown ids out",
      vars.status === 200 && vars.body.variants.length === vids.length && vars.body.variants.every((v) => vids.includes(v.variantId) && Number.isInteger(v.priceMinor) && Number.isInteger(v.available)),
      brief(vars).slice(0, 160),
    )
    check("public: variants are never cached", !/public/.test(vars.headers.get("cache-control") ?? "") && /no-store/.test(vars.headers.get("cache-control") ?? ""), vars.headers.get("cache-control"))
    check("public: variants without ids is 400", (await get("/api/catalog/variants")).status === 400)

    const sf = await get(`/api/catalog/storefronts/${handle}`)
    check("public: seeded storefront by handle has a live version", sf.status === 200 && sf.body.storefront?.version >= 1 && sf.body.brand?.id === "b_lagos_static", brief(sf).slice(0, 160))
    const sfId = await get("/api/catalog/storefronts/b_lagos_static")
    check("public: storefront by brand id", sfId.status === 200 && sfId.body.brand?.handle === handle)
    check("public: unknown storefront is 404", (await get(`/api/catalog/storefronts/${HTAG}-nobody`)).status === 404)
    const col = sf.body?.collections?.[0]
    if (col) {
      const c = await get(`/api/catalog/storefronts/${handle}/collections/${col.handle}`)
      check("public: seeded collection by handle", c.status === 200 && c.body.collection.id === col.id && Array.isArray(c.body.collection.productIds), brief(c).slice(0, 120))
    } else check("public: seeded storefront lists published collections", false, "no collections")
    check("public: unknown collection is 404", (await get(`/api/catalog/storefronts/${handle}/collections/${HTAG}-none`)).status === 404)
  }

  /* ===== Sessions ===== */
  const A = await demo("brand", "u_b_tobi", "b_lagos_static")
  const VIEWER = await demo("brand", "u_b_viewer", "b_lagos_static")
  const DESIGNER = await demo("brand", "u_b_designer", "b_lagos_static")
  const B = await demo("brand", "u_b_minji", "b_null_form")
  const ADMIN = await demo("admin", "adm_1")
  const ADA = await demo("shopper", "u_ada")
  const brandA = A.profile.brand
  check("setup: brand sessions for two brands", brandA.id === "b_lagos_static" && B.profile.brand.id === "b_null_form")

  /* ===== Studio products: auth ===== */
  check("studio: list products without a session is 401", (await get("/api/studio/catalog/products")).status === 401)
  check("studio: create without a session is 401", (await post("/api/studio/catalog/products", {})).status === 401)
  check("studio: a shopper session is not a brand session (401)", (await get("/api/studio/catalog/products", { cookie: ADA.cookie })).status === 401)
  check("studio: a viewer may list products", (await get("/api/studio/catalog/products", { cookie: VIEWER.cookie })).status === 200)
  const minimal = { title: `${TAG} Viewer`, categorySlug: "fashion", priceMinor: 1000, variants: [{ sku: `${TAG}-V` }] }
  check("studio: a viewer can't create products (403)", (await post("/api/studio/catalog/products", minimal, { cookie: VIEWER.cookie })).status === 403)
  {
    const noOrigin = await fetch(`${base}/api/studio/catalog/products`, { method: "POST", headers: { cookie: A.cookie, "Content-Type": "application/json" }, body: JSON.stringify(minimal) })
    check("studio: a write without Origin / X-Yard-Client is refused (403)", noOrigin.status === 403, String(noOrigin.status))
  }

  /* ===== Studio products: validation ===== */
  const up = await uploadBrandImage(A.cookie)
  const mediaId = up.body?.media?.id
  check("setup: brand image upload", up.status === 201 && !!mediaId, brief(up).slice(0, 160))

  const v400 = async (name, body) => {
    const r = await post("/api/studio/catalog/products", body, { cookie: A.cookie })
    check(`studio: create rejects ${name} (400)`, r.status === 400, brief(r).slice(0, 200))
  }
  await v400("no variants", { title: `${TAG} X`, categorySlug: "fashion", priceMinor: 1000, variants: [] })
  await v400("an unknown field (brandId)", { ...minimal, brandId: "b_null_form" })
  await v400("a fractional price", { ...minimal, priceMinor: 10.5 })
  await v400("a zero price", { ...minimal, priceMinor: 0 })
  await v400("an unknown category", { ...minimal, categorySlug: `${TAG}cat` })
  await v400("compare-at not above price", { ...minimal, compareAtMinor: 1000 })
  await v400("duplicate SKUs", { ...minimal, options: [{ name: "Size", values: [{ value: "S" }, { value: "M" }] }], variants: [{ sku: `${TAG}-D`, options: { Size: "S" } }, { sku: `${TAG}-D`, options: { Size: "M" } }] })
  await v400("variant options that aren't the product's", { ...minimal, options: [{ name: "Size", values: [{ value: "S" }] }], variants: [{ sku: `${TAG}-O`, options: { Size: "XL" } }] })
  await v400("another brand's photo", { ...minimal, images: [{ mediaId: "m_does_not_exist_" + RUN }] })
  await v400("negative opening stock", { ...minimal, variants: [{ sku: `${TAG}-N`, initialStock: -1 }] })

  {
    const bCols = (await get("/api/studio/catalog/collections", { cookie: B.cookie })).body?.collections ?? []
    if (bCols[0]) await v400("another brand's collection", { ...minimal, collectionIds: [bCols[0].id] })
    else check("studio: create rejects another brand's collection (400)", false, "brand B has no collection to test with")
  }

  /* ===== Studio products: create ===== */
  const createBody = {
    title: `${TAG} Tee`,
    description: "A kit tee.",
    categorySlug: "fashion",
    priceMinor: 25_000,
    compareAtMinor: 30_000,
    tags: ["Kit", "kit", " Test "],
    options: [{ name: "Size", values: [{ value: "S" }, { value: "M" }] }],
    variants: [
      { sku: `${TAG}-S`, options: { Size: "S" }, initialStock: 5 },
      { sku: `${TAG}-M`, options: { Size: "M" }, priceMinor: 27_000 },
    ],
    images: mediaId ? [{ mediaId, alt: "kit" }] : [],
  }
  const c1 = await post("/api/studio/catalog/products", createBody, { cookie: A.cookie })
  const P = c1.body?.product
  if (P) created.products.push(P.id)
  check(
    "studio: create → 201 draft v1 in the brand's currency",
    c1.status === 201 && P?.status === "draft" && P.version === 1 && P.currency === "NGN" && P.brandId === brandA.id,
    brief(c1).slice(0, 200),
  )
  if (!P) throw new Error("product create failed; later checks depend on it")
  const vS = P.variants.find((v) => v.sku === `${TAG}-S`)
  const vM = P.variants.find((v) => v.sku === `${TAG}-M`)
  check("studio: opening stock lands on on_hand; variant price override kept", vS?.onHand === 5 && vS.held === 0 && vM?.onHand === 0 && vM.priceMinor === 27_000 && vS.priceMinor === 25_000)
  check("studio: tags are normalised and de-duplicated", JSON.stringify(P.tags) === JSON.stringify(["kit", "test"]), JSON.stringify(P.tags))
  check("studio: a generated slug from the title", /^t-v3-catalog-/.test(P.slug), P.slug)
  {
    // Drops: a product may only join one of its own brand's drops (security fix: dropId was stored unchecked).
    const foreignDrop = await post("/api/studio/catalog/products", { ...minimal, title: `${TAG} Drop B`, variants: [{ sku: `${TAG}-DB` }], dropId: "d_ls_third_mainland" }, { cookie: B.cookie })
    if (foreignDrop.body?.product) created.products.push(foreignDrop.body.product.id)
    check("studio: create rejects another brand's drop (400)", foreignDrop.status === 400 && !!foreignDrop.body?.error?.fields?.dropId, brief(foreignDrop).slice(0, 160))
    const ghostDrop = await post("/api/studio/catalog/products", { ...minimal, title: `${TAG} Drop X`, variants: [{ sku: `${TAG}-DX` }], dropId: `d_${TAG}_none` }, { cookie: A.cookie })
    if (ghostDrop.body?.product) created.products.push(ghostDrop.body.product.id)
    check("studio: create rejects a drop that doesn't exist (400)", ghostDrop.status === 400, brief(ghostDrop).slice(0, 160))
    const ownDrop = await post("/api/studio/catalog/products", { ...minimal, title: `${TAG} Drop A`, variants: [{ sku: `${TAG}-DA` }], dropId: "d_ls_third_mainland" }, { cookie: A.cookie })
    if (ownDrop.body?.product) created.products.push(ownDrop.body.product.id)
    check("studio: create accepts the brand's own drop (201)", ownDrop.status === 201 && ownDrop.body.product.dropId === "d_ls_third_mainland", brief(ownDrop).slice(0, 160))
    if (ownDrop.body?.product) {
      const bProd = await post("/api/studio/catalog/products", { ...minimal, title: `${TAG} Drop B2`, variants: [{ sku: `${TAG}-DB2` }] }, { cookie: B.cookie })
      if (bProd.body?.product) created.products.push(bProd.body.product.id)
      const pb = bProd.body?.product
      const steal = pb ? await patch(`/api/studio/catalog/products/${pb.id}`, { dropId: "d_ls_third_mainland", expectedVersion: pb.version }, { cookie: B.cookie }) : bProd
      check("studio: update rejects another brand's drop (400)", steal.status === 400 && !!steal.body?.error?.fields?.dropId, brief(steal).slice(0, 160))
      const clear = pb ? await patch(`/api/studio/catalog/products/${pb.id}`, { dropId: null, expectedVersion: pb.version }, { cookie: B.cookie }) : bProd
      check("studio: update may clear dropId", clear.status === 200, brief(clear).slice(0, 160))
    }
  }
  const dupSku = await post("/api/studio/catalog/products", { ...minimal, variants: [{ sku: `${TAG}-S` }] }, { cookie: A.cookie })
  check("studio: a SKU already used in the brand is 400", dupSku.status === 400 && /sku/.test(JSON.stringify(dupSku.body?.error?.fields ?? {})), brief(dupSku).slice(0, 160))
  const takenSlug = await post("/api/studio/catalog/products", { ...minimal, title: `${TAG} Slug`, slug: P.slug, variants: [{ sku: `${TAG}-SL` }] }, { cookie: A.cookie })
  check("studio: an explicit slug that is taken is 400", takenSlug.status === 400 && !!takenSlug.body?.error?.fields?.slug, brief(takenSlug).slice(0, 160))

  // Draft is not public.
  check("public: a draft product is 404", (await get(`/api/catalog/products/${P.id}`)).status === 404)
  check("public: a draft product is not listed", (await get(`/api/catalog/products?ids=${P.id}`)).body?.total === 0)
  check("public: a draft product's variants are not sellable", (await get(`/api/catalog/variants?ids=${vS.id}`)).body?.variants?.length === 0)

  /* ===== Cross-brand tenancy ===== */
  check("tenancy: brand B GET of brand A's product is 404", (await get(`/api/studio/catalog/products/${P.id}`, { cookie: B.cookie })).status === 404)
  check("tenancy: brand B PATCH of brand A's product is 404", (await patch(`/api/studio/catalog/products/${P.id}`, { title: `${TAG} hijack`, expectedVersion: 1 }, { cookie: B.cookie })).status === 404)
  check("tenancy: brand B status change on brand A's product is 404", (await post(`/api/studio/catalog/products/${P.id}/status`, { action: "archive", expectedVersion: 1 }, { cookie: B.cookie })).status === 404)
  check("tenancy: brand B DELETE of brand A's product is 404", (await del(`/api/studio/catalog/products/${P.id}?expectedVersion=1`, { cookie: B.cookie })).status === 404)
  check("tenancy: brand B stock change on brand A's variant is 404", (await post(`/api/studio/catalog/variants/${vS.id}/stock`, { mode: "adjust", qty: 100 }, { cookie: B.cookie })).status === 404)
  check("tenancy: brand B can't read brand A's movements (404)", (await get(`/api/studio/catalog/variants/${vS.id}/movements`, { cookie: B.cookie })).status === 404)
  check("tenancy: brand B's list never contains brand A's product", !(await get(`/api/studio/catalog/products?q=${TAG}`, { cookie: B.cookie })).body?.products?.some((p) => p.id === P.id))
  {
    const bUp = await post("/api/studio/catalog/products", { ...minimal, title: `${TAG} B steals photo`, images: mediaId ? [{ mediaId }] : [], variants: [{ sku: `${TAG}-B1` }] }, { cookie: B.cookie })
    if (bUp.body?.product) created.products.push(bUp.body.product.id)
    check("tenancy: brand B can't attach brand A's upload as a photo (400)", bUp.status === 400, brief(bUp).slice(0, 160))
  }
  check("studio: unsafe product id in the path is 404", (await get(`/api/studio/catalog/products/a.b`, { cookie: A.cookie })).status === 404)
  check("studio: tenancy check runs after the body is accepted (unchanged v1)", (await get(`/api/studio/catalog/products/${P.id}`, { cookie: A.cookie })).body?.product?.version === 1)

  /* ===== Update + version conflicts ===== */
  {
    const stale = await patch(`/api/studio/catalog/products/${P.id}`, { title: `${TAG} Tee 2`, expectedVersion: 99 }, { cookie: A.cookie })
    check("studio: PATCH with a stale expectedVersion is 409", stale.status === 409, brief(stale))
    const noVer = await patch(`/api/studio/catalog/products/${P.id}`, { title: `${TAG} Tee 2` }, { cookie: A.cookie })
    check("studio: PATCH without expectedVersion is 400", noVer.status === 400)
    const ok = await patch(`/api/studio/catalog/products/${P.id}`, { title: `${TAG} Tee 2`, priceMinor: 26_000, expectedVersion: 1 }, { cookie: A.cookie })
    check("studio: PATCH bumps the version", ok.status === 200 && ok.body.product.version === 2 && ok.body.product.priceMinor === 26_000 && ok.body.product.title === `${TAG} Tee 2`, brief(ok).slice(0, 160))
    const badCmp = await patch(`/api/studio/catalog/products/${P.id}`, { priceMinor: 40_000, expectedVersion: 2 }, { cookie: A.cookie })
    check("studio: PATCH price above the compare-at price is 400", badCmp.status === 400, brief(badCmp).slice(0, 160))
    // Two editors save from the same version: exactly one wins.
    const [r1, r2] = await Promise.all([
      patch(`/api/studio/catalog/products/${P.id}`, { description: "editor one", expectedVersion: 2 }, { cookie: A.cookie }),
      patch(`/api/studio/catalog/products/${P.id}`, { description: "editor two", expectedVersion: 2 }, { cookie: DESIGNER.cookie }),
    ])
    const sts = [r1.status, r2.status].sort()
    check("studio: concurrent PATCHes from one version → one 200, one 409", sts[0] === 200 && sts[1] === 409, `${r1.status}/${r2.status}`)
    const kept = await patch(`/api/studio/catalog/products/${P.id}`, { variants: [{ id: vS.id, sku: `${TAG}-S`, options: { Size: "S" }, initialStock: 9 }, { id: vM.id, sku: `${TAG}-M`, options: { Size: "M" } }], expectedVersion: 3 }, { cookie: A.cookie })
    check("studio: PATCH can't set initialStock on an existing variant (400)", kept.status === 400, brief(kept).slice(0, 160))
    const foreignVariant = await patch(`/api/studio/catalog/products/${P.id}`, { variants: [{ id: "pv_" + RUN, sku: `${TAG}-S`, options: { Size: "S" } }], expectedVersion: 3 }, { cookie: A.cookie })
    check("studio: PATCH naming a variant that isn't on the product is 400", foreignVariant.status === 400, brief(foreignVariant).slice(0, 160))
  }
  const cur = async () => (await get(`/api/studio/catalog/products/${P.id}`, { cookie: A.cookie })).body?.product
  let pv = await cur()
  check("studio: GET returns the current version", pv?.version === 3, String(pv?.version))

  /* ===== Publish rules ===== */
  {
    const noPhoto = await post("/api/studio/catalog/products", { ...minimal, title: `${TAG} No photo`, variants: [{ sku: `${TAG}-NP`, initialStock: 2 }] }, { cookie: A.cookie })
    const NP = noPhoto.body?.product
    if (NP) created.products.push(NP.id)
    const r = NP ? await post(`/api/studio/catalog/products/${NP.id}/status`, { action: "publish", expectedVersion: NP.version }, { cookie: A.cookie }) : { status: 0 }
    check("studio: publishing without a photo is 422", r.status === 422, brief(r).slice(0, 160))
    if (NP) {
      const hold = await post("/api/studio/catalog/dev/stock", { action: "hold", holdKey: `${TAG}_draft`, lines: [{ variantId: NP.variants[0].id, qty: 1 }] }, { cookie: A.cookie })
      check("stock: holding a variant of an unpublished product → shortage, available 0", hold.status === 200 && hold.body.ok === false && hold.body.shortages?.[0]?.available === 0, brief(hold).slice(0, 160))
    }
    check("studio: viewer can't publish (403)", (await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: pv.version }, { cookie: VIEWER.cookie })).status === 403)
    const staleP = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: 1 }, { cookie: A.cookie })
    check("studio: publish with a stale version is 409", staleP.status === 409)
    const badAction = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "launch", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: unknown status action is 400", badAction.status === 400)
    const pub = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: publish → published", pub.status === 200 && pub.body.product.status === "published" && !!pub.body.product.publishedAt, brief(pub).slice(0, 160))
  }
  {
    const pubGet = await get(`/api/catalog/products/${P.id}`)
    const pp = pubGet.body?.product
    check("public: published product is visible with live availability", pubGet.status === 200 && pp.available === 5 && pp.variants.find((v) => v.id === vS.id)?.available === 5 && pp.variants.find((v) => v.id === vM.id)?.inStock === false, brief(pubGet).slice(0, 160))
    const imgSrc = pp?.images?.[0]?.src
    const img = imgSrc ? await fetch(`${base}${imgSrc}`) : null
    check("public: a published product's uploaded photo is viewable by anyone", img?.status === 200 && /^image\//.test(img.headers.get("content-type") ?? ""), `${imgSrc} → ${img?.status}`)
    check("public: published product appears in brand + ids lists", (await get(`/api/catalog/products?brand=b_lagos_static&ids=${P.id}`)).body?.total === 1)
    const vv = await get(`/api/catalog/variants?ids=${vS.id}&ids=${vM.id}`)
    const sv = vv.body?.variants ?? []
    check(
      "public: variants of a published product — price override, sold-out variant included at 0",
      sv.length === 2 && sv.find((v) => v.variantId === vS.id)?.priceMinor === 26_000 && sv.find((v) => v.variantId === vM.id)?.priceMinor === 27_000 && sv.find((v) => v.variantId === vM.id)?.available === 0 && sv[0].brandId === brandA.id,
      JSON.stringify(sv).slice(0, 200),
    )
    const instock = await get(`/api/catalog/products?ids=${P.id}&inStock=1`)
    check("public: inStock=1 keeps a product with one in-stock variant", instock.body?.total === 1)
  }
  pv = await cur()
  {
    const un = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "unpublish", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: unpublish → draft", un.status === 200 && un.body.product.status === "draft")
    check("public: unpublished product is 404 straight away", (await get(`/api/catalog/products/${P.slug}`)).status === 404)
    pv = un.body.product
    const soon = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "schedule", publishAt: new Date(Date.now() + 20_000).toISOString(), expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: schedule less than a minute ahead is 400", soon.status === 400, brief(soon).slice(0, 120))
    const far = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "schedule", publishAt: new Date(Date.now() + 2 * 366 * 864e5).toISOString(), expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: schedule more than a year ahead is 400", far.status === 400)
    const noAt = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "schedule", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: schedule without publishAt is 400", noAt.status === 400)
    const sch = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "schedule", publishAt: new Date(Date.now() + 10 * 60_000).toISOString(), expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: schedule 10 minutes ahead → scheduled", sch.status === 200 && sch.body.product.status === "scheduled" && !!sch.body.product.publishAt, brief(sch).slice(0, 160))
    check("public: a scheduled product isn't visible before its time", (await get(`/api/catalog/products/${P.id}`)).status === 404)
    const back = await post("/api/studio/catalog/dev/admin", { action: "backdateSchedule", productId: P.id }, { cookie: ADMIN.cookie })
    check("setup: dev admin backdates the schedule", back.status === 200, brief(back))
    check("public: a scheduled product whose time has come is visible (before the job runs)", (await get(`/api/catalog/products/${P.id}`)).status === 200)
    const job = await post("/api/studio/catalog/dev/admin", { action: "publishScheduled" }, { cookie: ADMIN.cookie })
    pv = await cur()
    check("job: publishScheduled flips a due product to published", job.status === 200 && pv.status === "published" && pv.publishAt === null && pv.version > sch.body.product.version, `${brief(job)} → ${pv?.status}`)
  }

  /* ===== Moderation ===== */
  {
    const hide = await post("/api/studio/catalog/dev/admin", { action: "moderate", productId: P.id, hidden: true, reason: `${TAG} test hide` }, { cookie: ADMIN.cookie })
    check("setup: dev admin hides the product", hide.status === 200 && hide.body.moderationStatus === "hidden", brief(hide))
    check("public: a moderation-hidden product is 404", (await get(`/api/catalog/products/${P.id}`)).status === 404)
    check("public: a moderation-hidden product isn't listed", (await get(`/api/catalog/products?ids=${P.id}`)).body?.total === 0)
    check("public: a moderation-hidden product's variants aren't sellable", (await get(`/api/catalog/variants?ids=${vS.id}`)).body?.variants?.length === 0)
    const h = await post("/api/studio/catalog/dev/stock", { action: "hold", holdKey: `${TAG}_hidden`, lines: [{ variantId: vS.id, qty: 1 }] }, { cookie: A.cookie })
    check("stock: holding a hidden product's variant → shortage", h.body?.ok === false, brief(h).slice(0, 160))
    pv = await cur()
    check("studio: the brand sees the hidden status and reason", pv.moderationStatus === "hidden" && pv.moderationReason === `${TAG} test hide`)
    const un = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "unpublish", expectedVersion: pv.version }, { cookie: A.cookie })
    pv = un.body?.product ?? (await cur())
    const rep = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: a hidden product can't be (re)published (422)", rep.status === 422, brief(rep).slice(0, 160))
    const unhide = await post("/api/studio/catalog/dev/admin", { action: "moderate", productId: P.id, hidden: false, reason: "restored" }, { cookie: ADMIN.cookie })
    pv = await cur()
    const rep2 = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: once un-hidden it publishes again", unhide.status === 200 && rep2.status === 200 && rep2.body.product.status === "published", brief(rep2).slice(0, 160))
    check("public: visible again", (await get(`/api/catalog/products/${P.id}`)).status === 200)
  }

  /* ===== Studio list ===== */
  {
    const l = await get(`/api/studio/catalog/products?q=${TAG}&status=published`, { cookie: A.cookie })
    check("studio: list filters by q and status", l.status === 200 && l.body.products.some((p) => p.id === P.id) && l.body.products.every((p) => p.status === "published"), `${l.body?.total}`)
    const sku = await get(`/api/studio/catalog/products?q=${TAG}-M`, { cookie: A.cookie })
    check("studio: list q also matches SKUs", sku.body?.products?.some((p) => p.id === P.id))
    check("studio: list rejects an unknown status (400)", (await get(`/api/studio/catalog/products?status=live`, { cookie: A.cookie })).status === 400)
    const low = await get(`/api/studio/catalog/products?q=${TAG}&lowStock=1`, { cookie: A.cookie })
    check("studio: lowStock=1 includes a product with a sold-out variant", low.body?.products?.some((p) => p.id === P.id))
  }

  /* ===== Studio stock ===== */
  {
    const stock = (body, who = A) => post(`/api/studio/catalog/variants/${vS.id}/stock`, body, { cookie: who.cookie })
    check("stock: a viewer can't change stock (403)", (await stock({ mode: "adjust", qty: 1 }, VIEWER)).status === 403)
    check("stock: a designer (no orders.fulfil) can't change stock (403)", (await stock({ mode: "adjust", qty: 1 }, DESIGNER)).status === 403)
    check("stock: no session is 401", (await post(`/api/studio/catalog/variants/${vS.id}/stock`, { mode: "adjust", qty: 1 })).status === 401)
    check("stock: unknown mode is 400", (await stock({ mode: "add", qty: 1 })).status === 400)
    check("stock: fractional qty is 400", (await stock({ mode: "adjust", qty: 1.5 })).status === 400)
    const add = await stock({ mode: "adjust", qty: 3, reason: "restock", note: TAG })
    check("stock: adjust +3 → on_hand 8", add.status === 200 && add.body.onHand === 8 && add.body.available === 8, brief(add))
    const set = await stock({ mode: "set", qty: 3 })
    check("stock: set 3 → on_hand 3", set.status === 200 && set.body.onHand === 3, brief(set))
    const neg = await stock({ mode: "adjust", qty: -4 })
    check("stock: adjust below zero is 422", neg.status === 422, brief(neg))
    const negSet = await stock({ mode: "set", qty: -1 })
    check("stock: set below zero is 422", negSet.status === 422, brief(negSet))
    const same = await stock({ mode: "set", qty: 3 })
    check("stock: a no-op set changes nothing", same.status === 200 && same.body.onHand === 3)
    const mv = await get(`/api/studio/catalog/variants/${vS.id}/movements`, { cookie: VIEWER.cookie })
    const m = mv.body?.movements ?? []
    check("stock: a viewer can read movements", mv.status === 200)
    check(
      "stock: movements are newest first with on_hand_after",
      m.length === 3 && m[0].reason === "set" && m[0].delta === -5 && m[0].onHandAfter === 3 && m[1].reason === "restock" && m[1].delta === 3 && m[2].note === "Opening stock" && m[2].delta === 5,
      JSON.stringify(m.map((x) => [x.reason, x.delta, x.onHandAfter])),
    )
  }

  /* ===== Holds: holdStock / commitHold / releaseHold / restock / TTL ===== */
  const dev = (body, who = A) => post("/api/studio/catalog/dev/stock", body, { cookie: who.cookie })
  const variant = async (id = vS.id) => (await cur()).variants.find((v) => v.id === id)
  const pubAvail = async (id = vS.id) => (await get(`/api/catalog/variants?ids=${id}`)).body?.variants?.[0]?.available
  {
    const K1 = `${TAG}_k1`
    const K2 = `${TAG}_k2`
    check("hold: dev hooks refuse a hold key without the t_v3_ tag (400)", (await dev({ action: "hold", holdKey: "chk_real", lines: [{ variantId: vS.id, qty: 1 }] })).status === 400)
    check("hold: dev hooks refuse another brand's variant (404)", (await dev({ action: "hold", holdKey: `${TAG}_x`, lines: [{ variantId: vS.id, qty: 1 }] }, B)).status === 404)
    check("hold: dev hooks need a session (401)", (await post("/api/studio/catalog/dev/stock", { action: "holds", holdKey: K1 })).status === 401)
    const q0 = await dev({ action: "hold", holdKey: `${TAG}_q0`, lines: [{ variantId: vS.id, qty: 0 }] })
    check("hold: qty 0 is refused (422)", q0.status === 422, brief(q0))

    const h1 = await dev({ action: "hold", holdKey: K1, lines: [{ variantId: vS.id, qty: 2 }] })
    let v = await variant()
    check("hold: hold 2 of 3 → ok, held 2, available 1", h1.body?.ok === true && v.held === 2 && v.onHand === 3 && v.available === 1, `${brief(h1)} held=${v.held}`)
    check("hold: public availability drops at once (no-store)", (await pubAvail()) === 1)
    const h1b = await dev({ action: "hold", holdKey: K1, lines: [{ variantId: vS.id, qty: 1 }, { variantId: vS.id, qty: 1 }] })
    v = await variant()
    check("hold: same key + same lines (split) is idempotent", h1b.body?.ok === true && v.held === 2, `held=${v.held}`)
    const h2 = await dev({ action: "hold", holdKey: K2, lines: [{ variantId: vS.id, qty: 2 }] })
    check("hold: a second checkout short of stock gets shortages with what's available", h2.body?.ok === false && h2.body.shortages?.[0]?.variantId === vS.id && h2.body.shortages[0].available === 1, brief(h2))
    v = await variant()
    check("hold: a refused hold holds nothing", v.held === 2)
    const h1c = await dev({ action: "hold", holdKey: K1, lines: [{ variantId: vS.id, qty: 3 }] })
    v = await variant()
    check("hold: same key with new lines re-holds, counting its own previous hold", h1c.body?.ok === true && v.held === 3 && v.available === 0, `${brief(h1c)} held=${v.held}`)
    const h1d = await dev({ action: "hold", holdKey: K1, lines: [{ variantId: vS.id, qty: 4 }] })
    v = await variant()
    check("hold: same key asking for more than exists → shortage, previous hold kept", h1d.body?.ok === false && h1d.body.shortages[0].available === 3 && v.held === 3, `${brief(h1d)} held=${v.held}`)
    const below = await post(`/api/studio/catalog/variants/${vS.id}/stock`, { mode: "set", qty: 2 }, { cookie: A.cookie })
    check("stock: setting on_hand below what's held is 422", below.status === 422, brief(below))
    const swap = await dev({ action: "hold", holdKey: K1, lines: [{ variantId: vS.id, qty: 1 }, { variantId: vM.id, qty: 1 }] })
    v = await variant()
    check("hold: new lines including a sold-out variant → shortage for that variant only, nothing changed", swap.body?.ok === false && swap.body.shortages.length === 1 && swap.body.shortages[0].variantId === vM.id && v.held === 3, brief(swap))
    const rel = await dev({ action: "release", holdKey: K1 })
    v = await variant()
    check("release: gives the held stock back", rel.status === 200 && v.held === 0 && v.available === 3, `held=${v.held}`)
    const rel2 = await dev({ action: "release", holdKey: K1 })
    v = await variant()
    check("release: idempotent (second release changes nothing)", rel2.status === 200 && v.held === 0)
    const hs = await dev({ action: "holds", holdKey: K1 })
    check("release: hold rows are marked released", hs.body?.holds?.length === 1 && hs.body.holds[0].status === "released", JSON.stringify(hs.body))

    // Commit.
    const K3 = `${TAG}_k3`
    await dev({ action: "hold", holdKey: K3, lines: [{ variantId: vS.id, qty: 2 }] })
    const cm = await dev({ action: "commit", holdKey: K3 })
    v = await variant()
    check("commit: on_hand and held both drop by the quantity", cm.status === 200 && v.onHand === 1 && v.held === 0 && v.available === 1, `onHand=${v.onHand} held=${v.held}`)
    const cm2 = await dev({ action: "commit", holdKey: K3 })
    v = await variant()
    check("commit: idempotent", cm2.status === 200 && v.onHand === 1 && v.held === 0)
    const reh = await dev({ action: "hold", holdKey: K3, lines: [{ variantId: vS.id, qty: 1 }] })
    v = await variant()
    check("hold: a committed key returns ok without holding again", reh.body?.ok === true && v.held === 0, `held=${v.held}`)
    const rel3 = await dev({ action: "release", holdKey: K3 })
    v = await variant()
    check("release: of a committed key gives nothing back", rel3.status === 200 && v.onHand === 1 && v.held === 0)
    let mv = (await get(`/api/studio/catalog/variants/${vS.id}/movements`, { cookie: A.cookie })).body.movements
    check("commit: writes one 'sale' movement referencing the hold key", mv.filter((x) => x.refId === K3).length === 1 && mv[0].reason === "sale" && mv[0].delta === -2 && mv[0].refType === "hold", JSON.stringify(mv[0]))

    // Two payment confirmations for one checkout at once: stock moves once.
    await post(`/api/studio/catalog/variants/${vS.id}/stock`, { mode: "set", qty: 3 }, { cookie: A.cookie })
    const KC = `${TAG}_kc`
    await dev({ action: "hold", holdKey: KC, lines: [{ variantId: vS.id, qty: 2 }] })
    const [ca, cb2, cr] = await Promise.all([dev({ action: "commit", holdKey: KC }), dev({ action: "commit", holdKey: KC }), dev({ action: "release", holdKey: KC })])
    v = await variant()
    const kcMoves = (await get(`/api/studio/catalog/variants/${vS.id}/movements`, { cookie: A.cookie })).body.movements.filter((x) => x.refId === KC)
    const kcHolds = (await dev({ action: "holds", holdKey: KC })).body?.holds ?? []
    check(
      "commit: concurrent commit + commit + release of one key settle it exactly once",
      ca.status === 200 && cb2.status === 200 && cr.status === 200 && v.held === 0 && kcHolds.length === 1 && ((kcHolds[0].status === "committed" && v.onHand === 1 && kcMoves.length === 1) || (kcHolds[0].status === "released" && v.onHand === 3 && kcMoves.length === 0)),
      `onHand=${v.onHand} held=${v.held} status=${kcHolds[0]?.status} moves=${kcMoves.length}`,
    )
    await post(`/api/studio/catalog/variants/${vS.id}/stock`, { mode: "set", qty: 1 }, { cookie: A.cookie })

    // TTL expiry.
    const K4 = `${TAG}_k4`
    const h4 = await dev({ action: "hold", holdKey: K4, lines: [{ variantId: vS.id, qty: 1 }], ttlMinutes: 500 })
    let hs4 = await dev({ action: "holds", holdKey: K4 })
    const exp = Date.parse(hs4.body?.holds?.[0]?.expiresAt ?? "")
    check("hold: ttlMinutes is capped at 120", h4.body?.ok === true && exp <= Date.now() + 120 * 60_000 + 5_000 && exp > Date.now() + 119 * 60_000, hs4.body?.holds?.[0]?.expiresAt)
    v = await variant()
    check("hold: available 0 while held", v.available === 0)
    const sw = await dev({ action: "expire", holdKey: K4 })
    hs4 = await dev({ action: "holds", holdKey: K4 })
    v = await variant()
    check("ttl: the sweep job expires a hold past its TTL and frees the stock", sw.status === 200 && sw.body.expired >= 1 && hs4.body.holds[0].status === "expired" && v.held === 0 && v.available === 1, `${brief(sw)} held=${v.held}`)
    const sw2 = await dev({ action: "expire", holdKey: K4 })
    v = await variant()
    check("ttl: sweeping again doesn't release twice", sw2.status === 200 && v.held === 0 && v.onHand === 1)
    // Late payment after expiry, stock still there: commit takes it directly.
    const late = await dev({ action: "commit", holdKey: K4 })
    v = await variant()
    mv = (await get(`/api/studio/catalog/variants/${vS.id}/movements`, { cookie: A.cookie })).body.movements
    check("commit: after expiry takes stock directly when it's still there", late.status === 200 && v.onHand === 0 && v.held === 0 && mv[0].refId === K4 && mv[0].delta === -1 && !mv[0].note, JSON.stringify(mv[0]))
    check("public: a sold-out variant shows available 0", (await pubAvail()) === 0)
    check("public: inStock=1 drops a product with nothing available", (await get(`/api/catalog/products?ids=${P.id}&inStock=1`)).body?.total === 0)

    // Restock (ORDERS' contract): reason decides return vs restock.
    const rs = await dev({ action: "restock", variantId: vS.id, qty: 2, reason: `return ret_${TAG}` })
    const rs2 = await dev({ action: "restock", variantId: vS.id, qty: 1, reason: `cancel ord_${TAG}` })
    v = await variant()
    mv = (await get(`/api/studio/catalog/variants/${vS.id}/movements`, { cookie: A.cookie })).body.movements
    check("restock: adds stock; 'return …' records a return, otherwise restock", rs.status === 200 && rs2.status === 200 && v.onHand === 3 && mv[0].reason === "restock" && mv[0].delta === 1 && mv[1].reason === "return" && mv[1].delta === 2, JSON.stringify(mv.slice(0, 2).map((x) => [x.reason, x.delta, x.note])))
    const rs0 = await dev({ action: "restock", variantId: vS.id, qty: 0, reason: "return" })
    check("restock: qty 0 is refused (422)", rs0.status === 422, brief(rs0))

    // Late payment after expiry when the stock has gone: oversell is recorded, never negative.
    const K5 = `${TAG}_k5`
    await dev({ action: "hold", holdKey: K5, lines: [{ variantId: vS.id, qty: 3 }] })
    await dev({ action: "expire", holdKey: K5 })
    await post(`/api/studio/catalog/variants/${vS.id}/stock`, { mode: "set", qty: 1 }, { cookie: A.cookie })
    const over = await dev({ action: "commit", holdKey: K5 })
    v = await variant()
    mv = (await get(`/api/studio/catalog/variants/${vS.id}/movements`, { cookie: A.cookie })).body.movements
    check("commit: a late commit with too little stock takes what's left and notes the oversell", over.status === 200 && v.onHand === 0 && v.held === 0 && mv[0].refId === K5 && mv[0].delta === -1 && /oversold by 2/.test(mv[0].note ?? ""), JSON.stringify(mv[0]))
    const over2 = await dev({ action: "commit", holdKey: K5 })
    v = await variant()
    check("commit: oversold commit is idempotent too", over2.status === 200 && v.onHand === 0)

    // Concurrency: two checkouts race for the last piece.
    await post(`/api/studio/catalog/variants/${vS.id}/stock`, { mode: "set", qty: 1 }, { cookie: A.cookie })
    const [ra, rb] = await Promise.all([dev({ action: "hold", holdKey: `${TAG}_ra`, lines: [{ variantId: vS.id, qty: 1 }] }), dev({ action: "hold", holdKey: `${TAG}_rb`, lines: [{ variantId: vS.id, qty: 1 }] })])
    v = await variant()
    check("hold: two holds racing for the last piece → exactly one wins", [ra.body?.ok, rb.body?.ok].filter((x) => x === true).length === 1 && v.held === 1, `${brief(ra)} / ${brief(rb)} held=${v.held}`)
    await dev({ action: "release", holdKey: `${TAG}_ra` })
    await dev({ action: "release", holdKey: `${TAG}_rb` })

    // Ledger invariant: on_hand equals the sum of movement deltas and the newest on_hand_after.
    v = await variant()
    mv = (await get(`/api/studio/catalog/variants/${vS.id}/movements?limit=500`, { cookie: A.cookie })).body.movements
    const sum = mv.reduce((n, x) => n + x.delta, 0)
    check("invariant: on_hand = Σ movement deltas = newest on_hand_after; held 0 after all releases", sum === v.onHand && mv[0].onHandAfter === v.onHand && v.held === 0 && v.available === v.onHand, `Σ=${sum} onHand=${v.onHand} held=${v.held}`)
  }

  /* ===== Archive / restore ===== */
  {
    pv = await cur()
    const stale = await del(`/api/studio/catalog/products/${P.id}?expectedVersion=1`, { cookie: A.cookie })
    check("studio: DELETE with a stale version is 409", stale.status === 409)
    const noVer = await del(`/api/studio/catalog/products/${P.id}`, { cookie: A.cookie })
    check("studio: DELETE without expectedVersion is 400", noVer.status === 400)
    const arch = await del(`/api/studio/catalog/products/${P.id}?expectedVersion=${pv.version}`, { cookie: A.cookie })
    check("studio: DELETE archives", arch.status === 200 && arch.body.product.status === "archived", brief(arch).slice(0, 120))
    check("public: an archived product is 404", (await get(`/api/catalog/products/${P.id}`)).status === 404)
    pv = arch.body.product
    const ed = await patch(`/api/studio/catalog/products/${P.id}`, { title: `${TAG} edit archived`, expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: editing an archived product is 422", ed.status === 422)
    const pubArch = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: publishing an archived product is 422", pubArch.status === 422)
    const res = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "restore", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: restore → draft", res.status === 200 && res.body.product.status === "draft")
    pv = res.body.product
    const res2 = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "restore", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: restoring a non-archived product is 422", res2.status === 422)
    const pub = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: pv.version }, { cookie: A.cookie })
    check("studio: republish after restore", pub.status === 200)
  }

  /* ===== Collections ===== */
  {
    check("collections: viewer can list (200) but not create (403)", (await get("/api/studio/catalog/collections", { cookie: VIEWER.cookie })).status === 200 && (await post("/api/studio/catalog/collections", { name: `${TAG} c` }, { cookie: VIEWER.cookie })).status === 403)
    check("collections: no session is 401", (await get("/api/studio/catalog/collections")).status === 401)
    check("collections: name too short is 400", (await post("/api/studio/catalog/collections", { name: "x" }, { cookie: A.cookie })).status === 400)
    const cc = await post("/api/studio/catalog/collections", { name: `${TAG} Capsule`, description: "kit" }, { cookie: A.cookie })
    const C = cc.body?.collection
    if (C) created.collections.push(C.id)
    check("collections: create → 201 with a handle from the name", cc.status === 201 && /^t-v3-catalog-/.test(C?.handle ?? "") && C.status === "published", brief(cc).slice(0, 160))
    if (C) {
      const dup = await post("/api/studio/catalog/collections", { name: `${TAG} Capsule 2`, handle: C.handle }, { cookie: A.cookie })
      check("collections: an explicit handle already used by the brand is 400", dup.status === 400)
      const auto = await post("/api/studio/catalog/collections", { name: `${TAG} Capsule` }, { cookie: A.cookie })
      if (auto.body?.collection) created.collections.push(auto.body.collection.id)
      check("collections: the same name gets a suffixed handle", auto.status === 201 && auto.body.collection.handle === `${C.handle}-2`, auto.body?.collection?.handle)
      check("tenancy: brand B PATCH of brand A's collection is 404", (await patch(`/api/studio/catalog/collections/${C.id}`, { name: `${TAG} hijack` }, { cookie: B.cookie })).status === 404)
      check("tenancy: brand B PUT products into brand A's collection is 404", (await put(`/api/studio/catalog/collections/${C.id}/products`, { productIds: [] }, { cookie: B.cookie })).status === 404)
      check("tenancy: brand B DELETE of brand A's collection is 404", (await del(`/api/studio/catalog/collections/${C.id}`, { cookie: B.cookie })).status === 404)
      const bList = await get("/api/catalog/products?brand=b_null_form&limit=1")
      const bProduct = bList.body?.products?.[0]?.id
      const foreign = await put(`/api/studio/catalog/collections/${C.id}/products`, { productIds: [P.id, bProduct ?? "p_x"] }, { cookie: A.cookie })
      check("tenancy: brand A can't put brand B's product in its collection (400)", foreign.status === 400 && !!foreign.body?.error?.fields?.["productIds.1"], brief(foreign).slice(0, 160))
      const setp = await put(`/api/studio/catalog/collections/${C.id}/products`, { productIds: [P.id] }, { cookie: A.cookie })
      check("collections: PUT products sets the ordered list", setp.status === 200 && JSON.stringify(setp.body.collection.productIds) === JSON.stringify([P.id]))
      const pc = await get(`/api/catalog/storefronts/b_lagos_static/collections/${C.handle}`)
      check("public: a published collection shows its public products", pc.status === 200 && pc.body.collection.productIds.includes(P.id), brief(pc).slice(0, 160))
      const byCol = await get(`/api/catalog/products?collection=${C.id}`)
      check("public: products?collection= filters by the collection", byCol.status === 200 && byCol.body.total === 1 && byCol.body.products[0].id === P.id)
      const studioCol = (await get(`/api/studio/catalog/products/${P.id}`, { cookie: A.cookie })).body?.product
      check("studio: the product knows its collection", studioCol?.collectionIds?.includes(C.id))
      const draft = await patch(`/api/studio/catalog/collections/${C.id}`, { status: "draft" }, { cookie: A.cookie })
      check("collections: PATCH status draft", draft.status === 200 && draft.body.collection.status === "draft")
      check("public: a draft collection is 404", (await get(`/api/catalog/storefronts/b_lagos_static/collections/${C.id}`)).status === 404)
      check("public: products?collection= ignores a draft collection", (await get(`/api/catalog/products?collection=${C.id}`)).body?.total === 0)
      const unknownField = await patch(`/api/studio/catalog/collections/${C.id}`, { brandId: "b_null_form" }, { cookie: A.cookie })
      check("collections: PATCH with an unknown field is 400", unknownField.status === 400, brief(unknownField).slice(0, 120))
      const rm = await del(`/api/studio/catalog/collections/${C.id}`, { cookie: A.cookie })
      check("collections: DELETE removes it; the product stays", rm.status === 200 && (await get(`/api/studio/catalog/products/${P.id}`, { cookie: A.cookie })).body?.product?.collectionIds?.length === 0)
      created.collections = created.collections.filter((x) => x !== C.id)
      check("collections: deleting again is 404", (await del(`/api/studio/catalog/collections/${C.id}`, { cookie: A.cookie })).status === 404)
    }
  }

  /* ===== Onboarding (a brand new account) ===== */
  const email = `${TAG}@example.com`
  const password = `Kit-${RUN}-pass-9`
  let S
  try {
    S = await signUpShopper(email, password)
    check("setup: sign-up + email verification give a shopper session", !!S)
  } catch (e) {
    check("setup: sign-up + email verification give a shopper session", false, String(e.message))
  }
  let O = null
  let newBrand = null
  let C3 = null
  if (S) {
    const handle = HTAG
    check("onboarding: no session is 401", (await get("/api/studio/onboarding")).status === 401)
    check("onboarding: a brand session is not a shopper session (401)", (await get("/api/studio/onboarding", { cookie: A.cookie })).status === 401)
    const g0 = await get("/api/studio/onboarding", { cookie: S })
    check("onboarding: a new account has no application yet", g0.status === 200 && g0.body.onboarding === null && g0.body.steps?.length === 6, brief(g0).slice(0, 120))
    const hs = async (h) => (await get(`/api/studio/onboarding/handle?handle=${encodeURIComponent(h)}`, { cookie: S })).body?.status
    check("onboarding: handle check — reserved / too-short / hyphen / taken / available", (await hs("admin")) === "reserved" && (await hs("ab")) === "too-short" && (await hs("a--b")) === "hyphen" && (await hs(brandA.handle)) === "taken" && (await hs(handle)) === "available")
    check("onboarding: handle check needs a session (401)", (await get(`/api/studio/onboarding/handle?handle=${handle}`)).status === 401)

    const step = (name, data, revision) => put(`/api/studio/onboarding/steps/${name}`, { data, revision }, { cookie: S })
    const brandStep = { name: `Kit ${RUN}`, handle, category: "fashion", description: "A test brand made by the catalog acceptance kit." }
    check("onboarding: unknown step is 404", (await step("bogus", {}, 0)).status === 404)
    check("onboarding: first save with revision ≠ 0 is 409", (await step("brand", brandStep, 3)).status === 409)
    const bad = await step("brand", { ...brandStep, description: "short" }, 0)
    check("onboarding: invalid step data is 400 with data.<field>", bad.status === 400 && Object.keys(bad.body?.error?.fields ?? {}).some((k) => /description/.test(k)), brief(bad).slice(0, 160))
    const badHandle = await step("brand", { ...brandStep, handle: brandA.handle }, 0)
    check("onboarding: a taken handle is 400 (data.handle)", badHandle.status === 400 && !!badHandle.body?.error?.fields?.["data.handle"], brief(badHandle).slice(0, 160))
    const extra = await step("brand", { ...brandStep, brandId: "b_lagos_static" }, 0)
    check("onboarding: an unknown field in step data is 400", extra.status === 400)
    let r = await step("brand", brandStep, 0)
    check("onboarding: first save creates the application (revision 1)", r.status === 200 && r.body.onboarding.revision === 1 && r.body.onboarding.status === "draft", brief(r).slice(0, 160))
    let rev = r.body?.onboarding?.revision ?? 1
    check("onboarding: another account sees the applied-for handle as taken", (await get(`/api/studio/onboarding/handle?handle=${handle}`, { cookie: ADA.cookie })).body?.status === "taken")
    check("onboarding: a stale revision is 409", (await step("account", { name: "Kit" }, 0)).status === 409)
    const sub0 = await post("/api/studio/onboarding/submit", { revision: rev }, { cookie: S })
    check("onboarding: submit with unfinished steps is 400", sub0.status === 400, brief(sub0).slice(0, 160))
    const steps = [
      ["account", { name: "Catalog Kit" }],
      ["storefront", { coverPath: "/media/fashion/campaign-woman-night-bulb-lights-07.jpg", accent: "acid", typePreset: "grotesk", template: "minimal" }],
      ["business", { country: "NG", city: "Lagos", currency: "NGN", sellerType: "individual", contactEmail: email, phone: "+234 800 000 0000" }],
      ["payments", { method: "bank", holder: "Catalog Kit", bankName: "Kit Bank", accountLast4: "1234", delivery: ["domestic"], processingMin: 1, processingMax: 3, returnsDays: 14 }],
    ]
    for (const [name, data] of steps) {
      r = await step(name, data, rev)
      if (r.status === 200) rev = r.body.onboarding.revision
      check(`onboarding: save step ${name}`, r.status === 200, brief(r).slice(0, 160))
    }
    const prodStep = { name: `${TAG} First`, description: "The first product from onboarding, made by the kit.", priceMinor: 15_000, images: [{ path: "/media/fashion/campaign-woman-night-bulb-lights-07.jpg", alt: "" }], sizes: [{ label: "S", stock: 2 }, { label: "M", stock: 0 }] }
    const noStock = await step("product", { ...prodStep, sizes: [{ label: "S", stock: 0 }] }, rev)
    check("onboarding: a product with no stock is 400", noStock.status === 400, brief(noStock).slice(0, 120))
    const badPay = await step("payments", { ...steps[3][1], processingMin: 5, processingMax: 2 }, rev)
    check("onboarding: processing max below min is 400", badPay.status === 400)
    const fullAcct = await step("payments", { ...steps[3][1], accountLast4: "0123456789" }, rev)
    check("onboarding: a full account number is refused (400; only the last four are kept)", fullAcct.status === 400)
    r = await step("product", prodStep, rev)
    if (r.status === 200) rev = r.body.onboarding.revision
    check("onboarding: save step product; all six complete", r.status === 200 && r.body.onboarding.completedSteps.length === 6, brief(r).slice(0, 160))
    check("onboarding: submit with a stale revision is 409", (await post("/api/studio/onboarding/submit", { revision: rev - 1 }, { cookie: S })).status === 409)
    const sub = await post("/api/studio/onboarding/submit", { revision: rev }, { cookie: S })
    O = sub.body?.onboarding
    check("onboarding: submit → submitted with a new brand", sub.status === 200 && O?.status === "submitted" && !!O.brandId, brief(sub).slice(0, 160))
    const sub2 = await post("/api/studio/onboarding/submit", { revision: rev }, { cookie: S })
    check("onboarding: submit again is idempotent", sub2.status === 200 && sub2.body.onboarding.brandId === O?.brandId)
    check("onboarding: editing a submitted application is 422", (await step("account", { name: "Kit again" }, O?.revision ?? rev)).status === 422)
    check("onboarding: GET shows the submitted application", (await get("/api/studio/onboarding", { cookie: S })).body?.onboarding?.status === "submitted")
    check("public: a brand under review has no live storefront", (await get(`/api/catalog/storefronts/${handle}`)).body?.storefront == null)
  }

  if (O?.brandId) {
    const si = await post("/api/auth/sign-in", { email, password, actor: "brand", brandId: O.brandId })
    const C = si.status === 200 ? mergeCookies("", si.res) : null
    check("setup: the applicant signs in to Studio for the new brand", !!C && si.body?.profile?.brand?.id === O.brandId, brief(si).slice(0, 160))
    if (C) {
      newBrand = O.brandId
      C3 = C
      const list = await get("/api/studio/catalog/products", { cookie: C })
      const first = list.body?.products?.[0]
      check("onboarding: submit created the first product as a draft with opening stock", list.status === 200 && list.body.total === 1 && first?.status === "draft" && first.variants.find((v) => v.options.Size === "S")?.onHand === 2 && first.currency === "NGN", brief(list).slice(0, 160))
      if (first) {
        const mv = await get(`/api/studio/catalog/variants/${first.variants[0].id}/movements`, { cookie: C })
        check("onboarding: opening stock is a movement", mv.body?.movements?.[0]?.delta === 2)
        const p0 = await post(`/api/studio/catalog/products/${first.id}/status`, { action: "publish", expectedVersion: first.version }, { cookie: C })
        check("studio: a brand under review can't publish products (422)", p0.status === 422, brief(p0).slice(0, 160))
      }
      const sf0 = await get("/api/studio/storefront", { cookie: C })
      check("storefront: the onboarding draft carries the wizard's choices; under review", sf0.status === 200 && sf0.body.draft.config.template === "minimal" && sf0.body.draft.config.accent === "acid" && sf0.body.underReview === true && sf0.body.live === null, brief(sf0).slice(0, 200))
      const pubUR = await post("/api/studio/storefront/publish", { draftRevision: sf0.body?.draft?.revision ?? 1, expectedVersion: 0 }, { cookie: C })
      check("storefront: publishing while under review is 422", pubUR.status === 422, brief(pubUR).slice(0, 160))
      // Tenancy: the new brand vs brand A.
      check("tenancy: the new brand can't read brand A's product (404)", (await get(`/api/studio/catalog/products/${P.id}`, { cookie: C })).status === 404)
      if (first) check("tenancy: brand A can't read the new brand's product (404)", (await get(`/api/studio/catalog/products/${first.id}`, { cookie: A.cookie })).status === 404)

      // Rejection, edit, resubmission: nothing may go public in between.
      const noNote = await post("/api/studio/catalog/dev/admin", { action: "review", onboardingId: O.id, decision: "reject" }, { cookie: ADMIN.cookie })
      check("onboarding: a rejection without a note is 400", noNote.status === 400, brief(noNote).slice(0, 120))
      const rej = await post("/api/studio/catalog/dev/admin", { action: "review", onboardingId: O.id, decision: "reject", note: `${TAG} add a better photo` }, { cookie: ADMIN.cookie })
      const g1 = (await get("/api/studio/onboarding", { cookie: S })).body?.onboarding
      check("onboarding: the applicant sees the rejection and its note", rej.status === 200 && g1?.status === "rejected" && g1.reviewNote === `${TAG} add a better photo`, brief(rej))
      const again = await post("/api/studio/catalog/dev/admin", { action: "review", onboardingId: O.id, decision: "approve" }, { cookie: ADMIN.cookie })
      check("onboarding: a rejected application can't be approved before resubmission (422)", again.status === 422)
      const edit = await put("/api/studio/onboarding/steps/account", { data: { name: "Catalog Kit (fixed)" }, revision: g1?.revision ?? 0 }, { cookie: S })
      check("onboarding: a rejected application can be edited (back to draft)", edit.status === 200 && edit.body.onboarding.status === "draft" && edit.body.onboarding.brandId === O.brandId, brief(edit).slice(0, 160))
      if (first) {
        const f = (await get(`/api/studio/catalog/products/${first.id}`, { cookie: C })).body.product
        const pe = await post(`/api/studio/catalog/products/${first.id}/status`, { action: "publish", expectedVersion: f.version }, { cookie: C })
        check("studio: a rejected brand editing its application still can't publish products (422)", pe.status === 422, brief(pe).slice(0, 160))
      }
      const sfe = (await get("/api/studio/storefront", { cookie: C })).body
      const spe = await post("/api/studio/storefront/publish", { draftRevision: sfe?.draft?.revision ?? 1, expectedVersion: 0 }, { cookie: C })
      check("storefront: a rejected brand editing its application still can't publish (422)", spe.status === 422 && sfe?.underReview === true, brief(spe).slice(0, 160))
      const resub = await post("/api/studio/onboarding/submit", { revision: edit.body?.onboarding?.revision ?? 0 }, { cookie: S })
      check("onboarding: resubmission keeps the same brand", resub.status === 200 && resub.body.onboarding.status === "submitted" && resub.body.onboarding.brandId === O.brandId, brief(resub).slice(0, 160))
      check("onboarding: resubmission doesn't create a second first product", (await get("/api/studio/catalog/products", { cookie: C })).body?.total === 1)

      const appr = await post("/api/studio/catalog/dev/admin", { action: "review", onboardingId: O.id, decision: "approve" }, { cookie: ADMIN.cookie })
      check("setup: dev admin approves the application", appr.status === 200 && appr.body.status === "approved", brief(appr))
      check("onboarding: shows approved", (await get("/api/studio/onboarding", { cookie: S })).body?.onboarding?.status === "approved")
      const sub3 = await post("/api/studio/onboarding/submit", { revision: 99 }, { cookie: S })
      check("onboarding: submitting an approved application is 422", sub3.status === 422)
      if (first) {
        const f = (await get(`/api/studio/catalog/products/${first.id}`, { cookie: C })).body.product
        const p1 = await post(`/api/studio/catalog/products/${first.id}/status`, { action: "publish", expectedVersion: f.version }, { cookie: C })
        check("studio: after approval the first product publishes (library photo)", p1.status === 200, brief(p1).slice(0, 160))
        const pp = await get(`/api/catalog/products/${first.slug}`)
        check("public: the new brand's product is public with its library photo", pp.status === 200 && pp.body.product.images[0]?.src?.startsWith("/media/"), brief(pp).slice(0, 160))
      }
    }
  }

  /* ===== A suspended brand can't lift its suspension by resubmitting its application ===== */
  {
    const email2 = `${TAG}_susp@example.com`
    const password2 = `Kit-${RUN}-susp-9`
    let S2 = null
    try {
      S2 = await signUpShopper(email2, password2)
    } catch (e) {
      check("setup: second sign-up for the suspension check", false, String(e.message))
    }
    if (S2) {
      const st = (name, data, revision) => put(`/api/studio/onboarding/steps/${name}`, { data, revision }, { cookie: S2 })
      const all = [
        ["brand", { name: `Kit S ${RUN}`, handle: `${HTAG}-s`, category: "fashion", description: "A test brand made by the catalog acceptance kit (suspension)." }],
        ["account", { name: "Catalog Kit S" }],
        ["storefront", { coverPath: "/media/fashion/campaign-woman-night-bulb-lights-07.jpg", accent: "acid", typePreset: "grotesk", template: "minimal" }],
        ["business", { country: "NG", city: "Lagos", currency: "NGN", sellerType: "individual", contactEmail: email2, phone: "+234 800 000 0000" }],
        ["payments", { method: "bank", holder: "Catalog Kit", bankName: "Kit Bank", accountLast4: "1234", delivery: ["domestic"], processingMin: 1, processingMax: 3, returnsDays: 14 }],
        ["product", { name: `${TAG} Susp`, description: "The first product from onboarding, made by the kit.", priceMinor: 15_000, images: [{ path: "/media/fashion/campaign-woman-night-bulb-lights-07.jpg", alt: "" }], sizes: [{ label: "S", stock: 1 }] }],
      ]
      let rv = 0
      let ok = true
      for (const [name, data] of all) {
        const r = await st(name, data, rv)
        if (r.status === 200) rv = r.body.onboarding.revision
        else ok = check(`setup: suspension check saves step ${name}`, false, brief(r).slice(0, 160))
      }
      const sub = ok ? await post("/api/studio/onboarding/submit", { revision: rv }, { cookie: S2 }) : null
      const O2 = sub?.body?.onboarding
      const rej = O2?.brandId ? await post("/api/studio/catalog/dev/admin", { action: "review", onboardingId: O2.id, decision: "reject", note: `${TAG} rejected` }, { cookie: ADMIN.cookie }) : null
      const sus = rej?.status === 200 ? await post("/api/admin/decisions/set-brand-status", { id: O2.brandId, status: "suspended", reason: `${TAG} suspension check` }, { cookie: ADMIN.cookie }) : null
      const signIn = () => post("/api/auth/sign-in", { email: email2, password: password2, actor: "brand", brandId: O2.brandId })
      const before = sus?.status === 200 ? await signIn() : null
      check("setup: a rejected, then suspended brand can't sign in to Studio (403)", before?.status === 403, sus ? brief(sus).slice(0, 160) : rej ? brief(rej).slice(0, 160) : sub ? brief(sub).slice(0, 160) : "steps failed")
      if (before?.status === 403) {
        const g = (await get("/api/studio/onboarding", { cookie: S2 })).body?.onboarding
        const ed = await st("account", { name: "Catalog Kit S again" }, g?.revision ?? 0)
        const re = await post("/api/studio/onboarding/submit", { revision: ed.body?.onboarding?.revision ?? 0 }, { cookie: S2 })
        check("onboarding: a suspended brand's resubmission is refused (422)", re.status === 422, brief(re).slice(0, 160))
        const after = await signIn()
        check("onboarding: the suspension still holds after a resubmission attempt (brand sign-in 403)", after.status === 403, brief(after).slice(0, 160))
      }
    }
  }

  /* ===== Storefront draft / publish / versions / restore (on the run's own brand) ===== */
  if (C3) {
    const C = C3
    check("storefront: no session is 401", (await get("/api/studio/storefront")).status === 401)
    check("storefront: viewer can't save the draft (403)", (await put("/api/studio/storefront/draft", { config: {}, baseRevision: 0 }, { cookie: VIEWER.cookie })).status === 403)
    check("storefront: viewer can't publish (403)", (await post("/api/studio/storefront/publish", { draftRevision: 1, expectedVersion: 0 }, { cookie: VIEWER.cookie })).status === 403)
    let sf = (await get("/api/studio/storefront", { cookie: C })).body
    const rev0 = sf.draft.revision
    const prodId = (await get("/api/studio/catalog/products", { cookie: C })).body.products[0].id
    const cfg1 = { template: "street", accent: "ember", typePreset: "expanded", intro: `${TAG} v1`, sections: [{ id: "hero", type: "hero", enabled: true }, { id: "featured", type: "featured-products", enabled: true, productIds: [prodId] }] }
    check("storefront: an invalid config is 400", (await put("/api/studio/storefront/draft", { config: { ...cfg1, template: "neon" }, baseRevision: rev0 }, { cookie: C })).status === 400)
    const foreign = await put("/api/studio/storefront/draft", { config: { ...cfg1, sections: [{ id: "f", type: "featured-products", enabled: true, productIds: [P.id] }] }, baseRevision: rev0 }, { cookie: C })
    check("tenancy: a storefront can't feature another brand's product (400)", foreign.status === 400, brief(foreign).slice(0, 160))
    const aCol = (await get("/api/studio/catalog/collections", { cookie: A.cookie })).body?.collections?.[0]?.id
    const foreignCol = await put("/api/studio/storefront/draft", { config: { ...cfg1, sections: [{ id: "c", type: "collections", enabled: true, collectionIds: [aCol ?? "col_x"] }] }, baseRevision: rev0 }, { cookie: C })
    check("tenancy: a storefront can't show another brand's collection (400)", foreignCol.status === 400, brief(foreignCol).slice(0, 160))
    const dupIds = await put("/api/studio/storefront/draft", { config: { ...cfg1, sections: [{ id: "a", type: "hero", enabled: true }, { id: "a", type: "story", enabled: true }] }, baseRevision: rev0 }, { cookie: C })
    check("storefront: duplicate section ids are 400", dupIds.status === 400)
    const badLink = await put("/api/studio/storefront/draft", { config: { ...cfg1, announcement: { text: "hi", href: "https://evil.example" } }, baseRevision: rev0 }, { cookie: C })
    check("storefront: an announcement link outside Yard is 400", badLink.status === 400)
    for (const href of ["//evil.example/login", "/\\evil.example", "///evil.example"]) {
      const r = await put("/api/studio/storefront/draft", { config: { ...cfg1, announcement: { text: "hi", href } }, baseRevision: rev0 }, { cookie: C })
      check(`storefront: a protocol-relative announcement link (${href}) is 400`, r.status === 400, brief(r).slice(0, 160))
    }
    const stale = await put("/api/studio/storefront/draft", { config: cfg1, baseRevision: rev0 + 5 }, { cookie: C })
    check("storefront: saving with a stale baseRevision is 409", stale.status === 409)
    const s1 = await put("/api/studio/storefront/draft", { config: cfg1, baseRevision: rev0 }, { cookie: C })
    check("storefront: save bumps the draft revision", s1.status === 200 && s1.body.draft.revision === rev0 + 1, brief(s1).slice(0, 160))
    const [x1, x2] = await Promise.all([
      put("/api/studio/storefront/draft", { config: { ...cfg1, intro: "one" }, baseRevision: rev0 + 1 }, { cookie: C }),
      put("/api/studio/storefront/draft", { config: { ...cfg1, intro: "two" }, baseRevision: rev0 + 1 }, { cookie: C }),
    ])
    check("storefront: concurrent saves from one revision → one 200, one 409", [x1.status, x2.status].sort().join() === "200,409", `${x1.status}/${x2.status}`)
    const s1b = await put("/api/studio/storefront/draft", { config: cfg1, baseRevision: rev0 + 2 }, { cookie: C })
    const r1 = s1b.body?.draft?.revision
    check("storefront: publish with a stale draftRevision is 409", (await post("/api/studio/storefront/publish", { draftRevision: r1 - 1, expectedVersion: 0 }, { cookie: C })).status === 409)
    check("storefront: publish expecting the wrong live version is 409", (await post("/api/studio/storefront/publish", { draftRevision: r1, expectedVersion: 3 }, { cookie: C })).status === 409)
    const pub1 = await post("/api/studio/storefront/publish", { draftRevision: r1, expectedVersion: 0, note: TAG }, { cookie: C })
    check("storefront: publish → version 1", pub1.status === 200 && pub1.body.version === 1, brief(pub1).slice(0, 160))
    const pubAgain = await post("/api/studio/storefront/publish", { draftRevision: r1, expectedVersion: 0 }, { cookie: C })
    check("storefront: re-sending the same publish is 409 (no duplicate version)", pubAgain.status === 409)
    const live1 = await get(`/api/catalog/storefronts/${HTAG}`)
    check("public: storefront serves version 1 with the featured product", live1.status === 200 && live1.body.storefront?.version === 1 && live1.body.storefront.config.intro === `${TAG} v1` && live1.body.storefront.config.sections[1].productIds.includes(prodId), brief(live1).slice(0, 200))
    const cfg2 = { ...cfg1, intro: `${TAG} v2`, accent: "aqua" }
    const s2 = await put("/api/studio/storefront/draft", { config: cfg2, baseRevision: r1 }, { cookie: C })
    sf = (await get("/api/studio/storefront", { cookie: C })).body
    check("storefront: draft edits after publish aren't live yet", (await get(`/api/catalog/storefronts/${HTAG}`)).body?.storefront?.config?.intro === `${TAG} v1` && sf.draft.config.intro === `${TAG} v2`)
    const pub2 = await post("/api/studio/storefront/publish", { draftRevision: s2.body.draft.revision, expectedVersion: 1 }, { cookie: C })
    check("storefront: publish → version 2", pub2.status === 200 && pub2.body.version === 2)
    sf = (await get("/api/studio/storefront", { cookie: C })).body
    check("storefront: history lists both versions, newest first", sf.versions?.length === 2 && sf.versions[0].version === 2 && sf.live.version === 2 && sf.versions[1].note === TAG && sf.draft.behindLive === false, JSON.stringify(sf.versions))
    const v1 = await get("/api/studio/storefront/versions/1", { cookie: C })
    check("storefront: GET version 1 has its config", v1.status === 200 && v1.body.config.intro === `${TAG} v1`)
    check("storefront: unknown version is 404", (await get("/api/studio/storefront/versions/99", { cookie: C })).status === 404)
    check("storefront: non-numeric version is 404", (await get("/api/studio/storefront/versions/abc", { cookie: C })).status === 404)
    check("tenancy: brand A's version 2 is its own, not the new brand's", (await get("/api/studio/storefront/versions/2", { cookie: A.cookie })).body?.config?.intro !== `${TAG} v2`)
    const rStale = await post("/api/studio/storefront/versions/1/restore", { baseRevision: sf.draft.revision - 1 }, { cookie: C })
    check("storefront: restore with a stale baseRevision is 409", rStale.status === 409)
    check("storefront: restoring a version that doesn't exist is 404", (await post("/api/studio/storefront/versions/42/restore", { baseRevision: sf.draft.revision }, { cookie: C })).status === 404)
    const rs = await post("/api/studio/storefront/versions/1/restore", { baseRevision: sf.draft.revision }, { cookie: C })
    check("storefront: restore copies the version into the draft", rs.status === 200 && rs.body.draft.config.intro === `${TAG} v1` && rs.body.draft.revision === sf.draft.revision + 1, brief(rs).slice(0, 160))
    check("public: a restore isn't live until published", (await get(`/api/catalog/storefronts/${HTAG}`)).body?.storefront?.version === 2)
    const pub3 = await post("/api/studio/storefront/publish", { draftRevision: rs.body.draft.revision, expectedVersion: 2 }, { cookie: C })
    const live3 = await get(`/api/catalog/storefronts/${HTAG}`)
    check("storefront: publishing the restored draft → version 3 with v1's config", pub3.status === 200 && pub3.body.version === 3 && live3.body?.storefront?.version === 3 && live3.body.storefront.config.intro === `${TAG} v1`)
    // A product that stops being public drops out of the live storefront at read time.
    const fp = (await get(`/api/studio/catalog/products/${prodId}`, { cookie: C })).body.product
    await post(`/api/studio/catalog/products/${prodId}/status`, { action: "unpublish", expectedVersion: fp.version }, { cookie: C })
    const live4 = await get(`/api/catalog/storefronts/${HTAG}`)
    check("public: an unpublished product is dropped from the live storefront's sections", live4.body?.storefront?.config?.sections?.[1]?.productIds?.length === 0, JSON.stringify(live4.body?.storefront?.config?.sections?.[1]))

    /* ===== Through CHECKOUT: the contract as the cart and checkout call it ===== */
    if (S) {
      const fp2 = (await get(`/api/studio/catalog/products/${prodId}`, { cookie: C })).body.product
      await post(`/api/studio/catalog/products/${prodId}/status`, { action: "publish", expectedVersion: fp2.version }, { cookie: C })
      const vv = fp2.variants.find((x) => x.options.Size === "S")
      const vvM = fp2.variants.find((x) => x.options.Size === "M")
      const studioV = async () => (await get(`/api/studio/catalog/products/${prodId}`, { cookie: C })).body.product.variants.find((x) => x.id === vv.id)
      // The new brand sets up delivery (shipping area) the way Studio does, for its own brand only.
      const ship = await put(
        "/api/studio/shipping",
        { originCountry: "NG", originCity: "Lagos", handlingMin: 1, handlingMax: 3, cutoffLocal: "14:00", workdays: 31, localPickup: false, pickupLocationId: null, closures: [], zones: [{ name: "Domestic", kind: "domestic", countries: ["NG"], enabled: true, methods: [{ service: "standard", label: "Standard", enabled: true, transitMin: 2, transitMax: 4, rates: [{ minSubtotalMinor: 0, amountMinor: 100_000 }] }] }] },
        { cookie: C },
      )
      check("setup: the new brand saves a delivery profile", ship.status === 200, brief(ship).slice(0, 160))
      const add = await post("/api/cart/lines", { variantId: vv.id, qty: 1 }, { cookie: S })
      check("checkout: a published variant can go in the cart", add.status === 200 || add.status === 201, brief(add).slice(0, 160))
      const tooMany = await post("/api/cart/lines", { variantId: vvM.id, qty: 1 }, { cookie: S })
      check("checkout: a sold-out variant can't go in the cart (404/409)", tooMany.status === 409 || tooMany.status === 404, brief(tooMany).slice(0, 160))
      const cart = await get("/api/cart?currency=NGN&to=NG&city=Lagos", { cookie: S })
      const group = cart.body?.groups?.find((g) => g.brandId === newBrand)
      const service = group?.shipping?.[0]?.service ?? group?.shipping?.options?.[0]?.service
      check("checkout: the cart re-prices from the catalogue", cart.status === 200 && !!group && JSON.stringify(group).includes("15000"), brief(cart).slice(0, 200))
      const shipTo = { name: "Catalog Kit", line1: "1 Kit Street", city: "Lagos", country: "NG", phone: "+234 800 000 0000" }
      const co = await post("/api/checkout", { idempotencyKey: `${TAG}_co1`, currency: "NGN", shipTo, shipping: [{ brandId: newBrand, service: service ?? "standard" }] }, { cookie: S })
      let sv = await studioV()
      check("checkout: starting a checkout holds the stock (held 1)", co.status === 201 && sv.held === 1 && sv.onHand === 2, `${brief(co).slice(0, 200)} held=${sv?.held}`)
      if (co.status === 201) {
        const coRetry = await post("/api/checkout", { idempotencyKey: `${TAG}_co1`, currency: "NGN", shipTo, shipping: [{ brandId: newBrand, service: service ?? "standard" }] }, { cookie: S })
        sv = await studioV()
        check("checkout: a retried checkout doesn't hold twice", coRetry.status === 200 && sv.held === 1, `${coRetry.status} held=${sv.held}`)
        const paid = await post(`/api/checkout/${co.body.id}/stub-pay`, { outcome: "success" }, { cookie: S })
        sv = await studioV()
        const mv = (await get(`/api/studio/catalog/variants/${vv.id}/movements`, { cookie: C })).body?.movements ?? []
        check("checkout: payment commits the hold (on_hand 1, held 0, one sale movement)", paid.status === 200 && sv.onHand === 1 && sv.held === 0 && mv[0]?.reason === "sale" && mv[0]?.refId === co.body.id, `${brief(paid).slice(0, 160)} onHand=${sv.onHand} held=${sv.held}`)
        await post("/api/cart/lines", { variantId: vv.id, qty: 1 }, { cookie: S })
        const co2 = await post("/api/checkout", { idempotencyKey: `${TAG}_co2`, currency: "NGN", shipTo, shipping: [{ brandId: newBrand, service: service ?? "standard" }] }, { cookie: S })
        const heldNow = (await studioV()).held
        const failedPay = co2.status === 201 ? await post(`/api/checkout/${co2.body.id}/stub-pay`, { outcome: "failed" }, { cookie: S }) : co2
        sv = await studioV()
        check("checkout: a failed payment releases the hold", co2.status === 201 && heldNow === 1 && failedPay.status === 200 && sv.held === 0 && sv.onHand === 1, `${brief(failedPay).slice(0, 160)} held ${heldNow}→${sv.held}`)
      }
    }
  }
}

async function cleanup() {
  // Archive the products this run made in seeded brands, delete its collections (tagged rows stay as history).
  try {
    const A = await demo("brand", "u_b_tobi", "b_lagos_static")
    const B = await demo("brand", "u_b_minji", "b_null_form")
    for (const who of [A, B]) {
      const l = await get(`/api/studio/catalog/products?q=${TAG}&limit=100`, { cookie: who.cookie })
      for (const p of l.body?.products ?? []) {
        if (!p.title.includes(TAG) || p.status === "archived") continue
        await del(`/api/studio/catalog/products/${p.id}?expectedVersion=${p.version}`, { cookie: who.cookie })
      }
      const cols = await get("/api/studio/catalog/collections", { cookie: who.cookie })
      for (const c of cols.body?.collections ?? []) if (c.name.includes(TAG)) await del(`/api/studio/catalog/collections/${c.id}`, { cookie: who.cookie })
    }
    const left = await get(`/api/studio/catalog/products?q=${TAG}&status=published`, { cookie: A.cookie })
    check("cleanup: no product of this run stays published in the seeded brand", (left.body?.products ?? []).length === 0)
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
export default async function v3catalog(opts = {}) {
  if (opts.base) base = String(opts.base).replace(/\/$/, "")
  quiet = true
  return run()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run()
  console.log(`# ${passed} passed, ${failed} failed (run ${TAG})`)
  process.exit(failed ? 1 : 0)
}
