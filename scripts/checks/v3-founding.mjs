#!/usr/bin/env node
// FOUNDING BRANDS live acceptance kit: admin create, Yard setup access, not-for-sale enforcement,
// claim links, claim, buy only after a payout account, other brands unaffected. Plain Node 22
// (fetch, no deps). Prints one PASS/FAIL line per check; exits non-zero when any check fails.
//
//   node scripts/checks/v3-founding.mjs          (server at YARD_BASE, default http://localhost:3000)
//
// Needs a DEVELOPMENT server: demo sign-in (adm_1 owner, adm_3 trust & safety, u_ada shopper,
// u_b_tobi brand owner), the dev hooks /api/auth/dev (expire-claim-links, inspect), /api/cart/dev
// (force a kit line past the cart check), /api/studio/catalog/dev/stock and the checkout stub.
//
// Test data: everything carries t_v3_founding_<run> / handle kit-fnd-<run>: two founding brands
// (left in place, products archived and claim links revoked at the end), their products, the
// claimant accounts (t_v3_ addresses), cart lines (removed) and a stub checkout (expired at the end).
// Rate limits: founding create is 20 an hour per admin and the kit spends 6, so about 3 runs an hour.
import { deflateSync, crc32 } from "node:zlib"

const base = (process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const TAG = `t_v3_founding_${RUN}`
const CONTROL_BRAND = "b_lagos_static"

let failed = 0
let passed = 0
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail === "" || detail == null ? "" : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)
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

async function api(method, path, { jar, body, headers, raw } = {}) {
  const h = { Origin: base, "X-Yard-Client": "1", ...(headers ?? {}) }
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
      if (res.status === 429 && attempt < 3) {
        await sleep(Math.min(65, Number(res.headers.get("retry-after") ?? 10)) * 1000)
        continue
      }
      return { status: res.status, body: json, text, headers: res.headers }
    } catch (e) {
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
const brief = (r) => `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message} ${r.body.error.fields ? JSON.stringify(r.body.error.fields) : ""}` : r.text.slice(0, 240)}`

async function demo(actor, account, brandId) {
  const jar = new Jar()
  const r = await post("/api/auth/demo", { actor, account, ...(brandId ? { brandId } : {}) }, { jar })
  if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
  return jar
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
    for (let x = 0; x < w; x++) rows.push(Buffer.from([(x * 3) & 255, (y * 5) & 255, 140]))
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
}
function upload(jar, query) {
  const boundary = `----yardkit${RUN}`
  const buf = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}.png"\r\nContent-Type: image/png\r\n\r\n`),
    pngBytes(),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  return api("POST", `/api/uploads?${query}`, { jar, raw: buf, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(buf.length) } })
}

/* ---------------- the kit ---------------- */

const key = (n) => `${TAG}_${n}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)
const cleanup = { products: [], brands: [], cartJars: [], checkouts: [], bis: [] }

async function main() {
  console.log(`# FOUNDING kit against ${base}, run ${TAG}`)
  const ADM = await demo("admin", "adm_1") // owner: brands.founding
  const ADM_TS = await demo("admin", "adm_3") // trust & safety: no brands.founding
  const SHOP = await demo("shopper", "u_ada")
  const CONTROL_OWNER = await demo("brand", "u_b_tobi", CONTROL_BRAND)
  await del("/api/cart", { jar: SHOP })
  cleanup.cartJars.push(SHOP)

  /* ===== 1. Create ===== */
  const handle = `kit-fnd-${RUN}`.slice(0, 30)
  check("permission: a non-owner admin can't list founding brands (403)", (await get("/api/admin/founding-brands", { jar: ADM_TS })).status === 403)
  check("permission: anonymous is 401", (await get("/api/admin/founding-brands", { jar: new Jar() })).status === 401)
  const h1 = await get(`/api/admin/founding-brands/handle?handle=${handle}`, { jar: ADM })
  check("create: handle check says available", h1.status === 200 && h1.body?.available === true, brief(h1))
  const hTaken = await get(`/api/admin/founding-brands/handle?handle=lagos-static`, { jar: ADM })
  check("create: a taken handle is reported (not available, with a message)", hTaken.status === 200 && hTaken.body?.available === false && !!hTaken.body?.message, brief(hTaken))
  const createBody = { name: `Kit Founding ${RUN}`.slice(0, 40), handle, category: "fashion", city: "Lagos", country: "NG", currency: "NGN", story: `${TAG}: a founding brand made by the kit.`, instagram: "@kit.founding", tiktok: "kitfounding", idempotencyKey: key("create") }
  check("create: unknown field is 400", (await post("/api/admin/founding-brands", { ...createBody, verified: true }, { jar: ADM })).status === 400)
  check("create: bad Instagram handle is 400", (await post("/api/admin/founding-brands", { ...createBody, instagram: "https://instagram.com/x y" }, { jar: ADM })).status === 400)
  check("create: non-owner admin is 403", (await post("/api/admin/founding-brands", createBody, { jar: ADM_TS })).status === 403)
  const c1 = await post("/api/admin/founding-brands", createBody, { jar: ADM })
  const F = c1.body?.brand
  if (!check("create: 201 with a founding row (setting_up, unclaimed, badge on)", c1.status === 201 && F?.status === "setting_up" && F.claimStatus === "unclaimed" && F.foundingBadge === true && F.instagram === "kit.founding", brief(c1))) throw new Error("create failed")
  cleanup.brands.push(F.id)
  const c2 = await post("/api/admin/founding-brands", createBody, { jar: ADM })
  check("create: replay with the same key returns the same brand (200)", c2.status === 200 && c2.body?.brand?.id === F.id, brief(c2))
  const c3 = await post("/api/admin/founding-brands", { ...createBody, idempotencyKey: key("create2") }, { jar: ADM })
  check("create: the same handle with a new key is refused (400 handle)", c3.status === 400 && !!c3.body?.error?.fields?.handle, brief(c3))
  const list = await get("/api/admin/founding-brands?limit=50", { jar: ADM })
  check("list: the new brand is listed with its status", list.status === 200 && list.body?.items?.some((b) => b.id === F.id && b.status === "setting_up"), brief(list))
  const shipping0 = (await get(`/api/admin/founding-brands/${F.id}`, { jar: ADM })).body?.brand
  check("create: GET one returns it", shipping0?.id === F.id)

  // Logo + banner by the admin (uploads as=admin), then PATCH.
  const logo = await upload(ADM, `purpose=storefront_cover&as=admin&brandId=${F.id}`)
  const banner = await upload(ADM, `purpose=storefront_cover&as=admin&brandId=${F.id}`)
  check("admin upload: founding brand logo + banner (201)", logo.status === 201 && banner.status === 201, `${brief(logo)} | ${brief(banner)}`)
  const upOther = await upload(ADM, `purpose=storefront_cover&as=admin&brandId=${CONTROL_BRAND}`)
  check("admin upload: another (non-founding) brand is refused (404)", upOther.status === 404, brief(upOther))
  const upPurpose = await upload(ADM, `purpose=social_post&as=admin&brandId=${F.id}`)
  check("admin upload: other purposes are refused (403)", upPurpose.status === 403, brief(upPurpose))
  const p1 = await patch(`/api/admin/founding-brands/${F.id}`, { logoMediaId: logo.body?.media?.id, bannerMediaId: banner.body?.media?.id, story: `${TAG}: our story, longer.` }, { jar: ADM })
  check("patch: logo, banner and story saved", p1.status === 200 && p1.body?.brand?.logo?.mediaId === logo.body?.media?.id && p1.body?.brand?.banner?.mediaId === banner.body?.media?.id, brief(p1))

  /* ===== 2. Yard setup ===== */
  const nonOwnerSetup = await post(`/api/admin/founding-brands/${F.id}/setup-session`, undefined, { jar: ADM_TS })
  check("setup: non-owner admin can't open setup (403)", nonOwnerSetup.status === 403, brief(nonOwnerSetup))
  const SET = new Jar(ADM.cookie)
  const so = await post(`/api/admin/founding-brands/${F.id}/setup-session`, undefined, { jar: SET })
  check("setup: owner admin opens Yard setup (201, 8 h)", so.status === 201 && so.body?.brandId === F.id && Date.parse(so.body?.expiresAt) - Date.now() <= 8 * 3600_000 + 60_000, brief(so))
  const sess = await get("/api/session", { jar: SET })
  check("setup: the brand session is role yard_setup on the founding brand", sess.body?.brand?.role === "yard_setup" && sess.body?.brand?.brand?.id === F.id, brief(sess))

  const img = await upload(SET, "purpose=social_post&as=brand")
  check("setup: product photo upload (201)", img.status === 201, brief(img))
  check("setup: location images are refused (403)", (await upload(SET, "purpose=location_image&as=brand")).status === 403)
  const prodBody = {
    images: img.body?.media?.id ? [{ mediaId: img.body.media.id, alt: TAG }] : [],
    title: `${TAG} Tee`,
    description: "A founding kit tee.",
    categorySlug: "fashion",
    priceMinor: 15_000,
    options: [{ name: "Size", values: [{ value: "M" }] }],
    variants: [{ sku: `${TAG}-M`, options: { Size: "M" }, initialStock: 10 }],
  }
  const cp = await post("/api/studio/catalog/products", prodBody, { jar: SET })
  const P = cp.body?.product
  if (!check("setup: product created in Studio (201)", cp.status === 201 && !!P, brief(cp))) throw new Error("setup product failed")
  cleanup.products.push({ id: P.id, jar: SET })
  const pub = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: P.version }, { jar: SET })
  check("setup: product published (200)", pub.status === 200, brief(pub))
  const V = P.variants[0].id
  check("setup: shipping is readable (starter profile exists)", (await get("/api/studio/shipping", { jar: SET })).status === 200)

  // Not yet launched: not public.
  check("launch gate: product isn't public before the storefront is published (404)", (await get(`/api/catalog/products/${P.id}`)).status === 404)
  check("launch gate: storefront isn't public before publish (404)", (await get(`/api/catalog/storefronts/${handle}`)).status === 404)
  // Search follows the same launch gate: nothing of the brand is findable before launch.
  const sq0 = await get(`/api/search?q=${encodeURIComponent(createBody.name)}&limit=20`)
  check("launch gate: search shows neither the brand nor its product before launch", sq0.status === 200 && !(sq0.body?.items ?? []).some((i) => i.brandId === F.id) && !(sq0.body?.brands ?? []).some((b) => b.brandId === F.id), brief(sq0))
  const sf = await get("/api/studio/storefront", { jar: SET })
  const sp = await post("/api/studio/storefront/publish", { draftRevision: sf.body?.draft?.revision, expectedVersion: sf.body?.live?.version ?? 0 }, { jar: SET })
  check("setup: storefront published (launch)", sp.status === 200, brief(sp))
  // Launch re-indexes the whole brand: its product shows in search and the shop listing at once.
  const sq1 = await get(`/api/search?brand=${F.id}`)
  check("search: after launch the product is in the shop listing (brand filter)", (sq1.body?.items ?? []).some((i) => i.productId === P.id), brief(sq1))
  const sq2 = await get(`/api/search?q=${encodeURIComponent(createBody.name)}&limit=21`)
  check("search: after launch the brand is findable by name", (sq2.body?.brands ?? []).some((b) => b.brandId === F.id), brief(sq2))

  // Audit as the admin.
  const audit = await get(`/api/admin/audit?subjectType=brand&subjectId=${F.id}&actorKind=all&limit=200`, { jar: ADM })
  const items = audit.body?.items ?? []
  const writes = items.filter((a) => a.action === "yard_setup.write")
  check("audit: setup writes are recorded as the admin (actor kind admin, via yard_setup)", writes.length >= 3 && writes.every((a) => (a.actorKind ?? a.actor?.kind) === "admin"), JSON.stringify(writes.slice(0, 2)))
  check("audit: create and setup_opened recorded", items.some((a) => a.action === "founding.created") && items.some((a) => a.action === "founding.setup_opened"), items.map((a) => a.action).join(","))
  const all = await get(`/api/admin/audit?subjectType=storefront&subjectId=${F.id}&actorKind=all`, { jar: ADM })
  const sfPub = all.body?.items?.find((a) => a.action === "storefront.published")
  check("audit: domain rows written in setup are attributed to admin (storefront.published)", !!sfPub && (sfPub.actorKind ?? sfPub.actor?.kind) === "admin", brief(all))

  /* ===== 3. Setup can't reach anything else ===== */
  for (const [label, r] of [
    ["payouts", await get("/api/studio/payouts", { jar: SET })],
    ["payout account", await get("/api/studio/payouts/account", { jar: SET })],
    ["payout account write", await put("/api/studio/payouts/account", { country: "NG", currency: "NGN", bankCode: "058", bankName: "Kit Bank", accountName: "Kit", accountNumber: "0123456789" }, { jar: SET })],
    ["orders", await get("/api/studio/orders", { jar: SET })],
    ["inbox", await get("/api/studio/inbox/conversations", { jar: SET })],
    ["team invites", await get("/api/auth/invites", { jar: SET })],
    ["drops", await get("/api/drops/studio", { jar: SET })],
    ["catalog dev hooks", await post("/api/studio/catalog/dev/stock", { action: "holds", holdKey: key("h") }, { jar: SET })],
    ["brand switch", await post("/api/auth/brand/switch", { brandId: CONTROL_BRAND }, { jar: SET })],
  ])
    check(`setup: ${label} refused (403)`, r.status === 403, brief(r))
  const signIn = await post("/api/auth/demo", { actor: "brand", account: "adm_1", brandId: F.id }, { jar: new Jar() })
  check("setup: brand sign-in can't reach the founding brand as the admin", signIn.status !== 200, brief(signIn))

  /* ===== 4. Unclaimed: visible, not for sale ===== */
  const pdp = await get(`/api/catalog/products/${P.id}`)
  check("public: product visible after launch with brand.forSale false and the badge", pdp.status === 200 && pdp.body?.product?.brand?.forSale === false && pdp.body?.product?.brand?.foundingBadge === true, brief(pdp))
  const store = await get(`/api/catalog/storefronts/${handle}`)
  check("public: storefront visible, forSale false, no private fields", store.status === 200 && store.body?.brand?.forSale === false && !("creationKey" in (store.body?.brand ?? {})) && !("createdBy" in (store.body?.brand ?? {})), brief(store))
  const vars = await get(`/api/catalog/variants?ids=${V}`)
  const vRow = vars.body?.variants?.find((v) => v.variantId === V)
  check("public: variants say forSale false, available 0, reason unclaimed", vRow?.forSale === false && vRow.available === 0 && vRow.notForSale === "unclaimed", brief(vars))
  const add = await post("/api/cart/lines", { variantId: V, qty: 1 }, { jar: SHOP })
  check("cart: adding an unclaimed brand's piece is refused (422)", add.status === 422 && /isn't selling/.test(add.body?.error?.message ?? ""), brief(add))
  const anon = await post("/api/cart/lines", { variantId: V, qty: 1 }, { jar: new Jar() })
  check("cart: anonymous add refused too (422)", anon.status === 422, brief(anon))
  const forced = await post("/api/cart/dev", { variantId: V, qty: 1 }, { jar: SHOP })
  check("setup for forged checkout: line forced into the cart (dev hook)", forced.status === 201, brief(forced))
  const view = await get("/api/cart?currency=NGN&to=NG&city=Lagos", { jar: SHOP })
  const vl = view.body?.lines?.find((l) => l.variantId === V)
  check("cart view: the forced line is unavailable (not_for_sale), priced 0, not in any brand group", vl?.status === "unavailable" && vl.unavailableReason === "not_for_sale" && vl.lineMinor === 0 && !view.body?.groups?.some((g) => g.brandId === F.id), brief(view))
  const forgedCo = await post("/api/checkout", { idempotencyKey: key("forged"), currency: "NGN", shipTo: { name: "Kit", line1: "1 Kit Street", city: "Lagos", country: "NG", phone: "+234 800 000 0000" }, shipping: [{ brandId: F.id, service: "standard" }] }, { jar: SHOP })
  check("checkout: a forged checkout with the unclaimed line is refused (409, line field)", forgedCo.status === 409 && !!forgedCo.body?.error?.fields?.[`lines.${V}`], brief(forgedCo))
  await del("/api/cart", { jar: SHOP })
  const bis = await post("/api/wishlist/back-in-stock", { variantId: V }, { jar: SHOP })
  check("notify me: back-in-stock request accepted (201)", bis.status === 201, brief(bis))
  cleanup.bis.push({ variantId: V, jar: SHOP })

  /* ===== 5. Claim links: refusals ===== */
  const E1 = `${TAG}_owner@example.com`
  const E2 = `${TAG}_late@example.com`
  const noReauth = await post(`/api/admin/founding-brands/${F.id}/claim-link`, { email: E1, idempotencyKey: key("l1") }, { jar: ADM })
  check("claim link: needs a recent re-auth (403 reauth)", noReauth.status === 403 && noReauth.body?.error?.fields?.reauth === "required", brief(noReauth))
  check("reauth: demo admin confirms (dev)", (await post("/api/auth/reauth?as=admin", { demo: true }, { jar: ADM })).status === 200)
  const demoEmail = await post(`/api/admin/founding-brands/${F.id}/claim-link`, { email: "ada@example.com", idempotencyKey: key("ldemo") }, { jar: ADM })
  check("claim link: a demo or admin address is refused (422)", demoEmail.status === 422 || demoEmail.status === 400, brief(demoEmail))
  const l1 = await post(`/api/admin/founding-brands/${F.id}/claim-link`, { email: E1, idempotencyKey: key("l1") }, { jar: ADM })
  const T1 = l1.body?.url ? new URL(l1.body.url).searchParams.get("token") : null
  check("claim link: issued (201) with a copyable URL", l1.status === 201 && !!T1 && l1.body?.link?.status === "pending", brief(l1))
  const l1r = await post(`/api/admin/founding-brands/${F.id}/claim-link`, { email: E1, idempotencyKey: key("l1") }, { jar: ADM })
  check("claim link: a retry with the same key returns the same link (200)", l1r.status === 200 && l1r.body?.url === l1.body?.url, brief(l1r))
  const outbox = await get(`/api/auth/dev?op=outbox&email=${encodeURIComponent(E1)}`)
  check("claim email: one founding_claim email queued", outbox.body?.emails?.filter((e) => e.template === "founding_claim").length === 1, brief(outbox))
  check("list: status link_sent", (await get(`/api/admin/founding-brands/${F.id}`, { jar: ADM })).body?.brand?.status === "link_sent")
  const l2 = await post(`/api/admin/founding-brands/${F.id}/claim-link`, { email: E1, idempotencyKey: key("l2") }, { jar: ADM })
  const T2 = l2.body?.url ? new URL(l2.body.url).searchParams.get("token") : null
  check("claim link: re-send issues a new link", l2.status === 201 && !!T2 && T2 !== T1, brief(l2))
  const pRevoked = await post("/api/auth/claim/preview", { token: T1 })
  check("claim: the replaced link is refused (410 revoked)", pRevoked.status === 410 && pRevoked.body?.error?.fields?.link === "revoked", brief(pRevoked))
  const pBad = await post("/api/auth/claim/preview", { token: "x".repeat(43) })
  check("claim: an invalid link is refused (404)", pBad.status === 404, brief(pBad))
  const pOk = await post("/api/auth/claim/preview", { token: T2 })
  check("claim preview: brand, masked email, no account yet", pOk.status === 200 && pOk.body?.brand?.id === F.id && pOk.body?.hasAccount === false && !pOk.body?.email?.includes(TAG), brief(pOk))

  // A second founding brand for the expired / wrong-account cases.
  const g1 = await post("/api/admin/founding-brands", { ...createBody, name: `Kit Founding B ${RUN}`.slice(0, 40), handle: `kit-fndb-${RUN}`.slice(0, 30), idempotencyKey: key("createB") }, { jar: ADM })
  const G = g1.body?.brand
  check("create: second founding brand (201)", g1.status === 201 && !!G, brief(g1))
  if (G) cleanup.brands.push(G.id)
  const lg = await post(`/api/admin/founding-brands/${G.id}/claim-link`, { email: E2, idempotencyKey: key("lg") }, { jar: ADM })
  const TG = lg.body?.url ? new URL(lg.body.url).searchParams.get("token") : null
  const exp = await post("/api/auth/dev", { op: "expire-claim-links", email: E2 })
  check("dev: claim link backdated", exp.status === 200 && exp.body?.expired === 1, brief(exp))
  const pExp = await post("/api/auth/claim/preview", { token: TG })
  check("claim: an expired link is refused (410 expired)", pExp.status === 410 && pExp.body?.error?.fields?.link === "expired", brief(pExp))
  const aExp = await post("/api/auth/claim/accept", { token: TG, acceptAgreement: true, agreementVersion: pOk.body?.agreementVersion, name: "Late Owner", password: "Kit-founding-late-pw!" })
  check("claim: accept on an expired link is refused (410)", aExp.status === 410, brief(aExp))

  /* ===== 6. Claim ===== */
  const PW = `Kit-founding-${RUN}-pw!`
  const noAgree = await post("/api/auth/claim/accept", { token: T2, acceptAgreement: false, agreementVersion: pOk.body?.agreementVersion, name: "Kit Owner", password: PW })
  check("claim: without accepting the agreement → 400", noAgree.status === 400 && !!noAgree.body?.error?.fields?.acceptAgreement, brief(noAgree))
  const stale = await post("/api/auth/claim/accept", { token: T2, acceptAgreement: true, agreementVersion: "old", name: "Kit Owner", password: PW })
  check("claim: a stale agreement version → 409", stale.status === 409, brief(stale))
  const OWN = new Jar()
  const acc = await post("/api/auth/claim/accept", { token: T2, acceptAgreement: true, agreementVersion: pOk.body?.agreementVersion, name: "Kit Owner", password: PW }, { jar: OWN })
  check("claim: accepted, signed in as the brand, redirect to payouts", acc.status === 200 && acc.body?.brandId === F.id && acc.body?.redirect === "/studio/settings#payouts" && acc.body?.profile?.role === "owner", brief(acc))
  const used = await post("/api/auth/claim/accept", { token: T2, acceptAgreement: true, agreementVersion: pOk.body?.agreementVersion, name: "Kit Owner", password: PW })
  check("claim: the used link is refused (409 used)", used.status === 409 && used.body?.error?.fields?.link === "used", brief(used))
  cleanup.products = cleanup.products.map((x) => ({ ...x, jar: OWN }))
  const insp = await get(`/api/auth/dev?op=inspect&email=${encodeURIComponent(E1)}`)
  check("claim: the claimant is OWNER and email-verified", insp.body?.brandMembers?.some((m) => m.brandId === F.id && m.role === "owner") && !!insp.body?.credentials?.emailVerifiedAt, brief(insp))
  const setupAfter = await get("/api/studio/storefront", { jar: SET })
  check("claim: the Yard setup session is gone (401)", setupAfter.status === 401, brief(setupAfter))
  const reopen = await post(`/api/admin/founding-brands/${F.id}/setup-session`, undefined, { jar: new Jar(ADM.cookie) })
  check("claim: setup can't be reopened on a claimed brand (422)", reopen.status === 422, brief(reopen))
  const row = (await get(`/api/admin/founding-brands/${F.id}`, { jar: ADM })).body?.brand
  check("admin: status claimed (no payout account yet), claimedBy set", row?.status === "claimed" && row?.claimedBy?.name === "Kit Owner" && row?.claimLink === null, JSON.stringify(row ?? {}).slice(0, 300))
  const profEdit = await patch(`/api/admin/founding-brands/${F.id}`, { story: "changed" }, { jar: ADM })
  check("admin: after claim the profile can't be edited (422)", profEdit.status === 422, brief(profEdit))
  const audC = await get(`/api/admin/audit?subjectType=brand&subjectId=${F.id}&actorKind=all&limit=200`, { jar: ADM })
  const audL = await get(`/api/admin/audit?subjectType=brand_invite&subjectId=${l2.body?.link?.id}&actorKind=all`, { jar: ADM })
  check("audit: founding.claimed (as the new owner) and claim_link_issued (as the admin) recorded", audC.body?.items?.some((a) => a.action === "founding.claimed") && audL.body?.items?.some((a) => a.action === "founding.claim_link_issued"), `${audC.body?.items?.map((a) => a.action).join(",")} | ${brief(audL)}`)

  // Wrong account: a link to E1 (now an account) on brand G must be claimed signed in as E1.
  const lw = await post(`/api/admin/founding-brands/${G.id}/claim-link`, { email: E1, idempotencyKey: key("lw") }, { jar: ADM })
  const TW = lw.body?.url ? new URL(lw.body.url).searchParams.get("token") : null
  check("claim link: re-issued after expiry (201)", lw.status === 201 && !!TW, brief(lw))
  const pw = await post("/api/auth/claim/preview", { token: TW }, { jar: SHOP })
  check("claim preview: hasAccount true, signedInMatches false for another shopper", pw.body?.hasAccount === true && pw.body?.signedInMatches === false, brief(pw))
  const wrong = await post("/api/auth/claim/accept", { token: TW, acceptAgreement: true, agreementVersion: pOk.body?.agreementVersion }, { jar: SHOP })
  check("claim: signed in as the wrong account is refused (401)", wrong.status === 401, brief(wrong))
  const anonAcc = await post("/api/auth/claim/accept", { token: TW, acceptAgreement: true, agreementVersion: pOk.body?.agreementVersion, name: "Someone", password: "Kit-someone-pw-123!" })
  check("claim: anonymous on an existing account's link is refused (401), no account takeover", anonAcc.status === 401, brief(anonAcc))
  await del(`/api/admin/founding-brands/${G.id}/claim-link`, { jar: ADM })
  const pRev = await post("/api/auth/claim/preview", { token: TW })
  check("claim: a revoked link is refused (410)", pRev.status === 410, brief(pRev))

  /* ===== 7. Buy only after a payout account ===== */
  const vars2 = (await get(`/api/catalog/variants?ids=${V}`)).body?.variants?.find((v) => v.variantId === V)
  check("claimed, no payout account: still not for sale (no_payout_account)", vars2?.forSale === false && vars2.notForSale === "no_payout_account", JSON.stringify(vars2))
  check("claimed, no payout account: cart add still refused (422)", (await post("/api/cart/lines", { variantId: V, qty: 1 }, { jar: SHOP })).status === 422)
  const hold = await post("/api/studio/catalog/dev/stock", { action: "hold", holdKey: key("hold"), lines: [{ variantId: V, qty: 1 }] }, { jar: OWN })
  check("stock backstop: a checkout hold on a brand not selling is refused", hold.status >= 400 || hold.body?.ok === false, brief(hold))
  const reauthOwn = await post("/api/auth/reauth?as=brand", { password: PW }, { jar: OWN })
  check("owner: password re-auth (200)", reauthOwn.status === 200, brief(reauthOwn))
  const acct = await put("/api/studio/payouts/account", { country: "NG", currency: "NGN", bankCode: "058", bankName: "Kit Bank Nigeria", accountName: `${TAG} Ltd`.slice(0, 100), accountNumber: `${Date.now()}`.slice(-10) }, { jar: OWN })
  check("owner: payout account saved", acct.status === 200, brief(acct))
  const vars3 = (await get(`/api/catalog/variants?ids=${V}`)).body?.variants?.find((v) => v.variantId === V)
  check("live: variant now for sale with stock", vars3?.forSale === true && vars3.available === 10, JSON.stringify(vars3))
  // The first payout account re-indexes the brand: search stops reading it as sold out.
  const sq3 = await get(`/api/search?brand=${F.id}&inStock=true`)
  const hit3 = (sq3.body?.items ?? []).find((i) => i.productId === P.id)
  check("search: after the payout account the product is in stock in search (inStock filter, available 10)", hit3?.available === 10, brief(sq3))
  const add2 = await post("/api/cart/lines", { variantId: V, qty: 1 }, { jar: SHOP })
  check("live: cart add accepted (201)", add2.status === 201, brief(add2))
  const cv = await get("/api/cart?currency=NGN&to=NG&city=Lagos", { jar: SHOP })
  const grp = cv.body?.groups?.find((g) => g.brandId === F.id)
  const opt = grp?.shipping?.options?.find((o) => o.available)
  check("live: cart groups the brand with a delivery option (starter shipping)", !!opt, brief(cv))
  const co = await post("/api/checkout", { idempotencyKey: key("co"), currency: "NGN", shipTo: { name: "Kit", line1: "1 Kit Street", city: "Lagos", country: "NG", phone: "+234 800 000 0000" }, shipping: [{ brandId: F.id, service: opt?.service ?? "standard" }] }, { jar: SHOP })
  check("live: checkout starts (201)", co.status === 201 && !!co.body?.id, brief(co))
  if (co.body?.id) cleanup.checkouts.push({ id: co.body.id, jar: SHOP })
  const rowLive = (await get(`/api/admin/founding-brands/${F.id}`, { jar: ADM })).body?.brand
  check("admin: status live (claimed + payout account + launched)", rowLive?.status === "live", JSON.stringify(rowLive ?? {}).slice(0, 200))

  /* ===== 6b. Badge toggle ===== */
  const off = await patch(`/api/admin/founding-brands/${F.id}`, { foundingBadge: false }, { jar: ADM })
  check("badge: admin can toggle the badge after claim", off.status === 200 && off.body?.brand?.foundingBadge === false, brief(off))
  const pdp2 = await get(`/api/catalog/products/${P.id}`)
  check("badge: the product's brand line drops the badge (memo invalidated)", pdp2.body?.product?.brand?.foundingBadge === false && pdp2.body?.product?.brand?.forSale === true, brief(pdp2))

  /* ===== 8. Control brand unaffected ===== */
  const ctl = await get(`/api/catalog/products?brand=${CONTROL_BRAND}&limit=5`)
  const ctlProduct = ctl.body?.products?.find((p) => p.brand?.id === CONTROL_BRAND) ?? ctl.body?.products?.[0]
  check("control: an ordinary brand reads forSale true, no badge", ctlProduct?.brand?.forSale === true && ctlProduct?.brand?.foundingBadge === false, brief(ctl))
  const ctlVariantIds = ctlProduct?.variants?.map((v) => v.id) ?? []
  const ctlVars = ctlVariantIds.length ? (await get(`/api/catalog/variants?${ctlVariantIds.map((i) => `ids=${i}`).join("&")}`)).body?.variants ?? [] : []
  const ctlV = ctlVars.find((v) => v.available > 0)
  check("control: variants for sale with stock", !!ctlV && ctlV.forSale === true && ctlV.notForSale === null, JSON.stringify(ctlVars.slice(0, 2)))
  if (ctlV) {
    const ca = await post("/api/cart/lines", { variantId: ctlV.variantId, qty: 1 }, { jar: SHOP })
    check("control: cart add works (201)", ca.status === 201, brief(ca))
  }
  check("control: the brand's owner keeps Studio access", (await get("/api/studio/storefront", { jar: CONTROL_OWNER })).status === 200)
  check("control: the control brand's owner can't see founding admin routes (401)", (await get("/api/admin/founding-brands", { jar: CONTROL_OWNER })).status === 401)
}

async function restore() {
  for (const p of cleanup.products) {
    const cur = (await get(`/api/studio/catalog/products/${p.id}`, { jar: p.jar }).catch(() => null))?.body?.product
    if (cur && cur.status !== "archived") await del(`/api/studio/catalog/products/${p.id}?expectedVersion=${cur.version}`, { jar: p.jar }).catch(() => {})
  }
  for (const c of cleanup.checkouts) await post(`/api/checkout/${c.id}/stub-expire`, undefined, { jar: c.jar }).catch(() => {})
  for (const b of cleanup.bis) await del(`/api/wishlist/back-in-stock/${b.variantId}`, { jar: b.jar }).catch(() => {})
  for (const j of cleanup.cartJars) await del("/api/cart", { jar: j }).catch(() => {})
}

main()
  .catch((e) => {
    failed++
    console.log(`FAIL kit aborted — ${e?.stack ?? e}`)
  })
  .finally(async () => {
    await restore()
    console.log(`\n# ${passed} passed, ${failed} failed (run ${TAG})`)
    process.exit(failed ? 1 : 0)
  })
