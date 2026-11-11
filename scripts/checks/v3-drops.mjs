#!/usr/bin/env node
// DROPS AND DRAWS (task G) live acceptance kit: a brand made fresh for this run creates a draw drop
// (with an Idempotency-Key and an uploaded drop image), edits it (409 on a stale version), schedules it
// (seed hash committed), fresh shoppers set reminders and enter (idempotent, leave and re-enter), the
// reminder email lands in the dev outbox, the draw runs once (seed revealed and matching the hash),
// the winner buys inside their window (limit enforced by checkout, stub pay), the others are refused
// with a reason, a second drop is cancelled, role / Yard-setup / founding-brand gates hold.
// Plain Node 22 (fetch, no deps). Prints one PASS/FAIL line per check; exits non-zero on any failure.
//
//   node scripts/checks/v3-drops.mjs          (server at YARD_BASE, default http://localhost:3000)
//
// Needs a DEVELOPMENT server with the stub providers and the schedulers (drops tick + email deliver
// every minute). Takes ~4 minutes: the draw is scheduled a minute or two ahead.
// Env:
//   YARD_BASE     server origin
//   YARD_DEV_LOG  the dev server's stdout (sign-up verification links are read from it)
//
// Test data (all tagged t_v3_drops_<run>): two founding brands made by admin adm_1 (one claimed by a
// fresh owner with a payout account, one left unclaimed), their products, four fresh shopper accounts,
// the drops, a paid stub order. At the end: drops cancelled, products archived, claim links revoked,
// reminders cleared, carts emptied, unpaid checkouts expired. Accounts, the paid order and the
// founding brands stay (tagged), as in the founding and engagement kits. Read-only refusal checks use
// the seeded fulfilment and viewer members of Lagos Static (nothing is written for them).
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { deflateSync, crc32 } from "node:zlib"

const base = (process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
const DEV_LOG = process.env.YARD_DEV_LOG ?? "/tmp/claude-0/-home-user/e300ec86-35a4-5f82-b2d8-95972eccde0c/scratchpad/dev.log"
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const TAG = `t_v3_drops_${RUN}`
// The dev server trusts one proxy hop: a per-run client address gives the kit its own per-IP buckets.
const IP = `10.${120 + Math.floor(Math.random() * 20)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`

let failed = 0
let passed = 0
function check(name, ok, detail = "") {
  if (ok) passed++
  else failed++
  const d = detail === "" || detail == null ? "" : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 500)
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${d && !ok ? ` — ${d}` : ""}`)
  return !!ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (s) => createHash("sha256").update(s).digest("hex")
const iso = (ms) => new Date(ms).toISOString()

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

async function api(method, path, { jar, body, raw, headers } = {}) {
  const h = { "X-Forwarded-For": IP, Origin: base, "X-Yard-Client": "1", ...(headers ?? {}) }
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
const del = (p, o = {}) => api("DELETE", p, o)
const brief = (r) => `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message} ${r.body.error.fields ? JSON.stringify(r.body.error.fields) : ""}` : (r.text ?? "").slice(0, 300)}`
const key = (n) => `${TAG}_${n}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)

async function demo(actor, account, brandId) {
  const jar = new Jar()
  const r = await post("/api/auth/demo", { actor, account, ...(brandId ? { brandId } : {}) }, { jar })
  if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
  return jar
}

/** A fresh shopper for this run: sign up, verify through the stub email in the dev log. */
const SHOPPER_PW = `Kit-drops-${RUN}-pw!`
async function freshShopper(label) {
  const email = `${TAG}_${label}@example.com`
  const jar = new Jar()
  const s = await post("/api/auth/sign-up", { name: `Drops Kit ${label.toUpperCase()}`, email, password: SHOPPER_PW }, { jar })
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
  const si = await post("/api/auth/sign-in", { email, password: SHOPPER_PW, actor: "shopper" }, { jar })
  if (si.status !== 200) throw new Error(`sign-in ${label}: ${brief(si)}`)
  const id = (await get("/api/session", { jar })).body?.shopper?.id
  return { jar, email, id, label }
}

async function outbox(email) {
  const r = await get(`/api/auth/dev?op=outbox&email=${encodeURIComponent(email)}`)
  return r.status === 200 ? r.body.emails : []
}
async function waitOutbox(email, pred, timeoutMs = 120_000) {
  const t0 = Date.now()
  let rows = []
  while (Date.now() - t0 < timeoutMs) {
    rows = await outbox(email)
    if (pred(rows)) return rows
    await sleep(3000)
  }
  return rows
}
async function waitUntil(ms, why) {
  const left = ms - Date.now()
  if (left > 0) {
    console.log(`# waiting ${Math.ceil(left / 1000)}s ${why}`)
    await sleep(left)
  }
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
    for (let x = 0; x < w; x++) rows.push(Buffer.from([200, (x * 4) & 255, (y * 3) & 255]))
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

const shipTo = { name: "Drops Kit", line1: "1 Kit Street", city: "Lagos", country: "NG", phone: "+234 800 000 0000" }
const cleanup = { drops: [], products: [], links: [], reminders: [], carts: [], checkouts: [] }

/** A founding brand launched through Yard setup, with one published product (stock 10). */
async function foundingBrand(ADM, label) {
  const handle = `kit-drp${label}-${RUN}`.slice(0, 30)
  const c = await post("/api/admin/founding-brands", { name: `Kit Drops ${label.toUpperCase()} ${RUN}`.slice(0, 40), handle, category: "fashion", city: "Lagos", country: "NG", currency: "NGN", story: `${TAG}: founding brand ${label} made by the drops kit.`, idempotencyKey: key(`brand_${label}`) }, { jar: ADM })
  const F = c.body?.brand
  if (!check(`setup: founding brand ${label} created (201)`, c.status === 201 && !!F, brief(c))) throw new Error("founding create failed")
  const SET = new Jar(ADM.cookie)
  const so = await post(`/api/admin/founding-brands/${F.id}/setup-session`, undefined, { jar: SET })
  check(`setup: Yard setup opened on ${label}`, so.status === 201, brief(so))
  const img = await upload(SET, "purpose=social_post&as=brand")
  const cp = await post(
    "/api/studio/catalog/products",
    {
      images: img.body?.media?.id ? [{ mediaId: img.body.media.id, alt: TAG }] : [],
      title: `${TAG} ${label} Jacket`,
      description: "A drops kit jacket.",
      categorySlug: "fashion",
      priceMinor: 25_000,
      options: [{ name: "Size", values: [{ value: "M" }] }],
      variants: [{ sku: `${TAG}-${label}-M`, options: { Size: "M" }, initialStock: 10 }],
    },
    { jar: SET },
  )
  const P = cp.body?.product
  if (!check(`setup: product created on ${label} (201)`, cp.status === 201 && !!P, brief(cp))) throw new Error("product create failed")
  const pub = await post(`/api/studio/catalog/products/${P.id}/status`, { action: "publish", expectedVersion: P.version }, { jar: SET })
  check(`setup: product published on ${label}`, pub.status === 200, brief(pub))
  const sf = await get("/api/studio/storefront", { jar: SET })
  const sp = await post("/api/studio/storefront/publish", { draftRevision: sf.body?.draft?.revision, expectedVersion: sf.body?.live?.version ?? 0 }, { jar: SET })
  check(`setup: storefront ${label} launched`, sp.status === 200, brief(sp))
  return { F, SET, P, V: P.variants[0].id, handle }
}

async function main() {
  console.log(`# DROPS kit against ${base}, run ${TAG}`)
  const ADM = await demo("admin", "adm_1")
  const FULFIL = await demo("brand", "u_b_kemi", "b_lagos_static") // orders.fulfil, no content.publish
  const VIEWER = await demo("brand", "u_b_viewer", "b_lagos_static")
  const ANON = new Jar()

  /* ===== Setup: a fresh brand (founding, claimed by a fresh owner) and an unclaimed one ===== */
  const A = await foundingBrand(ADM, "a")
  const U = await foundingBrand(ADM, "u")
  check("reauth: demo admin confirms (dev)", (await post("/api/auth/reauth?as=admin", { demo: true }, { jar: ADM })).status === 200)
  const ownerEmail = `${TAG}_owner@example.com`
  const link = await post(`/api/admin/founding-brands/${A.F.id}/claim-link`, { email: ownerEmail, idempotencyKey: key("link") }, { jar: ADM })
  const token = link.body?.url ? new URL(link.body.url).searchParams.get("token") : null
  check("setup: claim link issued for brand a", link.status === 201 && !!token, brief(link))
  const preview = await post("/api/auth/claim/preview", { token })
  const OWNER_PW = `Kit-drops-owner-${RUN}!`
  const OWN = new Jar()
  const acc = await post("/api/auth/claim/accept", { token, acceptAgreement: true, agreementVersion: preview.body?.agreementVersion, name: "Drops Kit Owner", password: OWNER_PW }, { jar: OWN })
  if (!check("setup: a fresh owner claims brand a (owner role)", acc.status === 200 && acc.body?.brandId === A.F.id && acc.body?.profile?.role === "owner", brief(acc))) throw new Error("claim failed")
  cleanup.products.push({ id: A.P.id, jar: OWN })
  cleanup.products.push({ id: U.P.id, jar: U.SET })
  cleanup.links.push(U.F.id)

  const shoppers = {}
  for (const l of ["s1", "s2", "s3", "s4"]) shoppers[l] = await freshShopper(l)
  const S = Object.values(shoppers)
  check("setup: four fresh shoppers signed in", S.every((s) => !!s.id), S.map((s) => s.id))
  for (const s of S) cleanup.carts.push(s.jar)

  // Drop image (drop_image purpose).
  const dimg = await upload(OWN, "purpose=drop_image&as=brand")
  const imageId = dimg.body?.media?.id
  check("image: the owner uploads a drop image (201)", dimg.status === 201 && !!imageId, brief(dimg))
  check("image: a viewer can't upload a drop image (403)", (await upload(VIEWER, "purpose=drop_image&as=brand")).status === 403)

  /* ===== Gates before the payout account ===== */
  const T0 = Date.now()
  const later = (name, extra = {}) => ({
    name: `${TAG} ${name}`,
    description: "Drops kit drop.",
    access: "first_come",
    startsAt: iso(T0 + 86_400_000),
    endsAt: iso(T0 + 86_400_000 + 3600_000),
    productIds: [A.P.id],
    ...extra,
  })
  const createAs = (jar, body, k = key(`c_${Math.random().toString(36).slice(2, 8)}`)) => post("/api/drops", body, { jar, headers: { "Idempotency-Key": k } })
  {
    const early = await createAs(OWN, later("nopayout"))
    check("gate: a claimed brand can save a draft before its payout account (201)", early.status === 201, brief(early))
    if (early.body?.drop) {
      cleanup.drops.push({ id: early.body.drop.id, jar: OWN })
      const sch = await post(`/api/drops/${early.body.drop.id}/schedule`, { expectedVersion: early.body.drop.version }, { jar: OWN })
      check("gate: scheduling without a payout account is refused (422, says payout account)", sch.status === 422 && /payout account/i.test(sch.body?.error?.message ?? ""), brief(sch))
      check("gate: that draft isn't public (404)", (await get(`/api/drops/${early.body.drop.id}`)).status === 404)
    }
  }
  {
    // Yard setup (admin acting for the unclaimed brand) can't reach drops at all.
    const r1 = await createAs(U.SET, { ...later("setup"), productIds: [U.P.id] })
    check("gate: Yard setup can't create a drop (403)", r1.status === 403, brief(r1))
    check("gate: Yard setup can't list Studio drops (403)", (await get("/api/drops/studio", { jar: U.SET })).status === 403)
    check("gate: Yard setup can't upload a drop image (403)", (await upload(U.SET, "purpose=drop_image&as=brand")).status === 403)
    // Roles without content.publish.
    check("role: a fulfilment member can't create a drop (403)", (await createAs(FULFIL, later("ful"))).status === 403)
    check("role: a viewer can't create a drop (403)", (await createAs(VIEWER, later("view"))).status === 403)
    check("role: a shopper can't create a drop (401)", (await createAs(shoppers.s1.jar, later("shop"))).status === 401)
    check("role: anonymous can't create a drop (401)", (await createAs(ANON, later("anon"))).status === 401)
    // The unclaimed founding brand's piece can't be bought, drop or not.
    const add = await post("/api/cart/lines", { variantId: U.V, qty: 1 }, { jar: shoppers.s4.jar })
    check("founding: an unclaimed brand's piece can't go in the cart (422, isn't selling)", add.status === 422 && /isn't selling/.test(add.body?.error?.message ?? ""), brief(add))
    const pub = await get(`/api/drops?brandId=${U.F.id}&phase=all&limit=50`)
    check("founding: the unclaimed brand has no public drops", pub.status === 200 && (pub.body?.items ?? []).length === 0, brief(pub))
  }

  /* ===== Payout account (brand a goes live) ===== */
  check("setup: owner password re-auth", (await post("/api/auth/reauth?as=brand", { password: OWNER_PW }, { jar: OWN })).status === 200)
  const pa = await put("/api/studio/payouts/account", { country: "NG", currency: "NGN", bankCode: "058", bankName: "Kit Bank Nigeria", accountName: `${TAG} Ltd`.slice(0, 100), accountNumber: `${Date.now()}`.slice(-10) }, { jar: OWN })
  check("setup: payout account saved, brand a for sale", pa.status === 200, brief(pa))

  /* ===== Create the draw drop (idempotent) ===== */
  const T1 = Date.now()
  const times = { entryOpensAt: T1 + 75_000, entryClosesAt: T1 + 165_000, startsAt: T1 + 195_000, endsAt: T1 + 2 * 3600_000 }
  const drawBody = {
    name: `${TAG} Draw`,
    description: "A drops kit draw: one winner.",
    image: imageId ?? null,
    access: "draw",
    entryOpensAt: iso(times.entryOpensAt),
    entryClosesAt: iso(times.entryClosesAt),
    startsAt: iso(times.startsAt),
    endsAt: iso(times.endsAt),
    productIds: [A.P.id],
    winnersCount: 1,
    limitPerCustomer: 1,
    purchaseWindowMinutes: 30,
    reminderLeadMinutes: 2,
  }
  check("create: no Idempotency-Key is 400", (await post("/api/drops", drawBody, { jar: OWN })).status === 400)
  const k1 = key("draw")
  const c1 = await createAs(OWN, drawBody, k1)
  const D = c1.body?.drop
  if (!check("create: the owner creates a draw draft (201, draft, version 1, image kept)", c1.status === 201 && D?.status === "draft" && D.version === 1 && D.access === "draw" && D.image === imageId, brief(c1))) throw new Error("draw create failed")
  cleanup.drops.push({ id: D.id, jar: OWN })
  const c2 = await createAs(OWN, drawBody, k1)
  check("create: a retry with the same key returns the same draft (200)", c2.status === 200 && c2.body?.drop?.id === D.id, brief(c2))
  const c3 = await createAs(OWN, { ...drawBody, winnersCount: 2 }, k1)
  check("create: the same key with a different body is 409", c3.status === 409, brief(c3))
  const studio = await get("/api/drops/studio?status=draft", { jar: OWN })
  check("create: one draft in Studio for the key (no duplicate)", (studio.body?.items ?? []).filter((x) => x.name === drawBody.name).length === 1, brief(studio))
  check("draft: not public (404) and not listed", (await get(`/api/drops/${D.id}`)).status === 404 && !(await get(`/api/drops?brandId=${A.F.id}&phase=all`)).body?.items?.some((x) => x.id === D.id))

  /* ===== Edit ===== */
  const stale = await patch(`/api/drops/${D.id}`, { description: "Stale edit.", expectedVersion: 7 }, { jar: OWN })
  check("edit: a stale expectedVersion is 409 (Reload)", stale.status === 409 && /Reload/i.test(stale.body?.error?.message ?? ""), brief(stale))
  check("edit: a viewer can't edit (403)", (await patch(`/api/drops/${D.id}`, { description: "x", expectedVersion: 1 }, { jar: VIEWER })).status === 403)
  const e1 = await patch(`/api/drops/${D.id}`, { description: "A drops kit draw: one winner, one piece each.", expectedVersion: 1 }, { jar: OWN })
  check("edit: the owner edits the draft (version 2)", e1.status === 200 && e1.body?.drop?.version === 2, brief(e1))
  const replay = await patch(`/api/drops/${D.id}`, { description: "Replay with old version.", expectedVersion: 1 }, { jar: OWN })
  check("edit: replaying with the old version is 409", replay.status === 409, brief(replay))

  /* ===== Schedule ===== */
  const sch = await post(`/api/drops/${D.id}/schedule`, { expectedVersion: 2 }, { jar: OWN })
  check("schedule: 200, scheduled, phase upcoming (entries not open yet)", sch.status === 200 && sch.body?.drop?.status === "scheduled" && sch.body.drop.phase === "upcoming", brief(sch))
  let ver = sch.body?.drop?.version ?? 3
  const info0 = await get(`/api/drops/${D.id}/draw`)
  const HASH = info0.body?.seedHash
  check("fairness: before the draw the seed hash is public and the seed is not", info0.status === 200 && /^[0-9a-f]{64}$/.test(HASH ?? "") && info0.body.seed === null && info0.body.drawnAt === null && info0.body.winners === 1, brief(info0))
  const pub0 = await get(`/api/drops?brandId=${A.F.id}&phase=upcoming&limit=50`)
  check("public: the scheduled draw is listed under upcoming", pub0.body?.items?.some((x) => x.id === D.id), brief(pub0))
  check("public: detail by slug (200)", (await get(`/api/drops/${D.slug}`)).status === 200)
  if (imageId) {
    const m = await fetch(`${base}/api/media/${imageId}?as=shopper`, { headers: { "X-Forwarded-For": IP } })
    check("image: the drop image is public once the drop is scheduled (200)", m.status === 200, String(m.status))
  }

  /* ===== Reminders (before entries open) ===== */
  {
    const r4 = await post(`/api/drops/${D.id}/reminder`, undefined, { jar: shoppers.s4.jar })
    check("reminder: s4 sets a reminder on the upcoming draw", r4.status === 200 && r4.body?.reminder === true, brief(r4))
    cleanup.reminders.push({ id: D.id, jar: shoppers.s4.jar })
    check("reminder: setting it again is idempotent (200)", (await post(`/api/drops/${D.id}/reminder`, undefined, { jar: shoppers.s4.jar })).status === 200)
    const r1 = await post(`/api/drops/${D.id}/reminder`, undefined, { jar: shoppers.s1.jar })
    const u1 = await del(`/api/drops/${D.id}/reminder`, { jar: shoppers.s1.jar })
    check("reminder: s1 sets then clears it", r1.status === 200 && u1.status === 200 && u1.body?.reminder === false, `${brief(r1)} | ${brief(u1)}`)
    const me4 = (await get(`/api/drops/${D.id}`, { jar: shoppers.s4.jar })).body?.me
    const me1 = (await get(`/api/drops/${D.id}`, { jar: shoppers.s1.jar })).body?.me
    check("reminder: detail me.reminder true for s4, false for s1", me4?.reminder === true && me1?.reminder === false, JSON.stringify([me4, me1]))
    check("reminder: anonymous is 401", (await post(`/api/drops/${D.id}/reminder`, undefined, { jar: ANON })).status === 401)
    const early = await post(`/api/drops/${D.id}/entry`, undefined, { jar: shoppers.s1.jar })
    check("entry: entering before entries open is 422", early.status === 422 && /aren't open/.test(early.body?.error?.message ?? ""), brief(early))
  }

  /* ===== Entries ===== */
  await waitUntil(times.entryOpensAt + 1500, "for entries to open")
  {
    const det = await get(`/api/drops/${D.id}`)
    check("entries: phase entries_open", det.body?.drop?.phase === "entries_open", JSON.stringify(det.body?.drop?.phase))
    for (const s of [shoppers.s1, shoppers.s2, shoppers.s3]) {
      const r = await post(`/api/drops/${D.id}/entry`, undefined, { jar: s.jar })
      check(`entry: ${s.label} enters`, r.status === 200 && r.body?.entered === true && r.body.status === "entered", brief(r))
    }
    const again = await post(`/api/drops/${D.id}/entry`, undefined, { jar: shoppers.s1.jar })
    check("entry: entering twice is idempotent", again.status === 200 && again.body?.status === "entered", brief(again))
    const leave = await del(`/api/drops/${D.id}/entry`, { jar: shoppers.s3.jar })
    const after = (await get(`/api/drops/${D.id}/draw`, { jar: shoppers.s3.jar })).body?.me
    check("entry: s3 leaves (withdrawn)", leave.status === 200 && leave.body?.entered === false && after?.status === "withdrawn", `${brief(leave)} ${JSON.stringify(after)}`)
    const back = await post(`/api/drops/${D.id}/entry`, undefined, { jar: shoppers.s3.jar })
    check("entry: s3 enters again after leaving", back.status === 200 && back.body?.status === "entered", brief(back))
    check("entry: a brand member can't enter (401 brand session)", (await post(`/api/drops/${D.id}/entry`, undefined, { jar: OWN })).status === 401)
    const counts = (await get(`/api/drops/${D.id}/draw`)).body?.counts
    check("entries: 3 entries counted", counts?.entries === 3, JSON.stringify(counts))
    const mine = await get("/api/drops/me", { jar: shoppers.s2.jar })
    check("drops/me: lists s2's entry", mine.body?.entries?.some((e) => e.drop.id === D.id && e.status === "entered"), brief(mine))
    const mine4 = await get("/api/drops/me", { jar: shoppers.s4.jar })
    check("drops/me: lists s4's reminder", mine4.body?.reminders?.some((r) => r.dropId === D.id), brief(mine4))
    // Terms are locked once entries are open.
    const cur = (await get("/api/drops/studio?status=scheduled", { jar: OWN })).body?.items?.find((x) => x.id === D.id)
    ver = cur?.version ?? ver
    const lockW = await patch(`/api/drops/${D.id}`, { winnersCount: 3, expectedVersion: ver }, { jar: OWN })
    check("lock: changing winners while entries are open is 422", lockW.status === 422, brief(lockW))
    const lockT = await patch(`/api/drops/${D.id}`, { entryOpensAt: iso(Date.now() + 120_000), expectedVersion: ver }, { jar: OWN })
    check("lock: moving the entry opening while entries are open is 422", lockT.status === 422, brief(lockT))
    const copy = await patch(`/api/drops/${D.id}`, { description: "Copy edits stay allowed.", expectedVersion: ver }, { jar: OWN })
    check("lock: a copy edit is still allowed (200)", copy.status === 200, brief(copy))
    const earlyDraw = await post(`/api/drops/${D.id}/draw`, undefined, { jar: OWN })
    check("draw: can't run while entries are open (422)", earlyDraw.status === 422, brief(earlyDraw))
  }

  /* ===== Reminder email (dev outbox) ===== */
  {
    const rows = await waitOutbox(shoppers.s4.email, (r) => r.some((e) => e.template === "drop_reminder" && e.status !== "pending" && e.status !== "sending"), 100_000)
    const rem = rows.filter((e) => e.template === "drop_reminder")
    check("reminder: s4's reminder email lands in the dev outbox once (stub)", rem.length === 1 && rem[0].status === "stub", JSON.stringify(rows.map((e) => [e.template, e.status])))
    const rows1 = await outbox(shoppers.s1.email)
    check("reminder: s1 (cleared) got no reminder email", !rows1.some((e) => e.template === "drop_reminder"), JSON.stringify(rows1.map((e) => e.template)))
  }

  /* ===== The draw ===== */
  let winner = null
  const losers = []
  {
    await waitUntil(times.entryClosesAt + 1500, "for entries to close")
    const late = await post(`/api/drops/${D.id}/entry`, undefined, { jar: shoppers.s4.jar })
    check("entry: entering after entries closed is 422", late.status === 422, brief(late))
    const run = await post(`/api/drops/${D.id}/draw`, undefined, { jar: OWN })
    check("draw: the brand runs it (or the scheduler already did)", run.status === 200 || (run.status === 422 && /already/.test(run.body?.error?.message ?? "")), brief(run))
    const again = await post(`/api/drops/${D.id}/draw`, undefined, { jar: OWN })
    check("draw: running it again is refused (422)", again.status === 422 && /already/.test(again.body?.error?.message ?? ""), brief(again))
    const info = await get(`/api/drops/${D.id}/draw`)
    const b = info.body ?? {}
    check("fairness: after the draw the seed is published and hashes to the committed hash", typeof b.seed === "string" && b.seedHash === HASH && sha256(b.seed) === HASH && !!b.drawnAt, brief(info))
    check("fairness: counts (3 entries, 1 won, 2 waitlisted)", b.counts?.entries === 3 && b.counts.won === 1 && b.counts.waitlisted === 2, JSON.stringify(b.counts))
    const order = [shoppers.s1, shoppers.s2, shoppers.s3].map((s) => ({ s, k: sha256(`${b.seed}:${D.id}:${s.id}`) })).sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0))
    winner = order[0].s
    losers.push(order[1].s, order[2].s)
    const wme = (await get(`/api/drops/${D.id}/draw`, { jar: winner.jar })).body?.me
    check("fairness: the winner is reproducible from the seed (rank 1, won)", wme?.status === "won" && wme.rank === 1, JSON.stringify(wme))
    check("draw: the winner's window opens at release, for 30 minutes", wme?.windowOpensAt === iso(times.startsAt) && Date.parse(wme.windowEndsAt) - times.startsAt === 30 * 60_000, JSON.stringify(wme))
    const pre = await get(`/api/drops/${D.id}`, { jar: winner.jar })
    check("winner: before release canBuy false with the window reason", pre.body?.me?.canBuy === false && /opens at/.test(pre.body?.me?.reason ?? ""), JSON.stringify(pre.body?.me))
  }

  /* ===== Winners buy in their window, others can't ===== */
  const pickService = async (jar) => {
    const v = await get("/api/cart?currency=NGN&to=NG&city=Lagos", { jar })
    return v.body?.groups?.find((g) => g.brandId === A.F.id)?.shipping?.options?.find((o) => o.available)?.service ?? "standard"
  }
  let coN = 0
  const checkout = async (s, qty) => {
    await del("/api/cart", { jar: s.jar })
    const a = await post("/api/cart/lines", { variantId: A.V, qty }, { jar: s.jar })
    if (a.status !== 201 && a.status !== 200) return { add: a, co: a }
    const co = await post("/api/checkout", { idempotencyKey: key(`co${++coN}`), currency: "NGN", shipTo, shipping: [{ brandId: A.F.id, service: await pickService(s.jar) }] }, { jar: s.jar })
    if (co.status === 201 && co.body?.id) cleanup.checkouts.push({ id: co.body.id, jar: s.jar })
    return { add: a, co }
  }
  {
    await waitUntil(times.startsAt + 1500, "for the release (winner's window)")
    const det = await get(`/api/drops/${D.id}`, { jar: winner.jar })
    check("winner: detail says canBuy, no reason, entry won", det.body?.me?.canBuy === true && det.body.me.reason === null && det.body.me.entry?.status === "won", JSON.stringify(det.body?.me))
    for (const l of losers) {
      const m = (await get(`/api/drops/${D.id}`, { jar: l.jar })).body?.me
      check(`non-winner ${l.label}: canBuy false with a reason`, m?.canBuy === false && typeof m.reason === "string" && m.reason.length > 0 && m.entry?.status === "waitlisted", JSON.stringify(m))
    }
    const m4 = (await get(`/api/drops/${D.id}`, { jar: shoppers.s4.jar })).body?.me
    check("non-entrant s4: canBuy false with a reason", m4?.canBuy === false && !!m4.reason && m4.entry === null, JSON.stringify(m4))

    const lose = await checkout(losers[0], 1)
    check("checkout: a non-winner is refused with a reason (422, winners)", lose.co.status === 422 && /winners/.test(lose.co.body?.error?.message ?? ""), brief(lose.co))
    const outsider = await checkout(shoppers.s4, 1)
    check("checkout: a non-entrant is refused (422)", outsider.co.status === 422, brief(outsider.co))
    const two = await checkout(winner, 2)
    check("checkout: the winner can add to the cart (201)", two.add.status === 201 || two.add.status === 200, brief(two.add))
    check("checkout: the purchase limit is enforced by checkout (qty 2 → 422 on the line)", two.co.status === 422 && !!two.co.body?.error?.fields?.[`lines.${A.V}`], brief(two.co))
    const one = await checkout(winner, 1)
    check("checkout: the winner checks out one piece in their window (201)", one.co.status === 201 && !!one.co.body?.id, brief(one.co))
    if (one.co.body?.id) {
      const pay = await post(`/api/checkout/${one.co.body.id}/stub-pay`, { outcome: "success" }, { jar: winner.jar })
      check("checkout: stub payment succeeds (paid)", pay.status === 200 && pay.body?.status === "paid", brief(pay))
      const me = (await get(`/api/drops/${D.id}/draw`, { jar: winner.jar })).body?.me
      check("draw: the winner's entry becomes purchased", me?.status === "purchased", JSON.stringify(me))
      const more = await checkout(winner, 1)
      check("checkout: after buying the limit another checkout is 422", more.co.status === 422, brief(more.co))
      const after = (await get(`/api/drops/${D.id}`, { jar: winner.jar })).body?.me
      check("winner: detail now says the limit is reached", after?.canBuy === false && /limit/.test(after?.reason ?? ""), JSON.stringify(after))
    }
    const mine = await get("/api/drops/me", { jar: winner.jar })
    check("drops/me: the winner's entry shows purchased", mine.body?.entries?.some((e) => e.drop.id === D.id && e.status === "purchased"), brief(mine))
    const live = await get(`/api/drops?brandId=${A.F.id}&phase=live&limit=50`)
    check("public: the released draw is listed under live", live.body?.items?.some((x) => x.id === D.id && x.phase === "live"), brief(live))
    const emailW = await waitOutbox(winner.email, (r) => r.some((e) => e.template === "drop_draw_won" && e.status !== "pending"), 60_000)
    check("email: the winner got one drop_draw_won email", emailW.filter((e) => e.template === "drop_draw_won").length === 1, JSON.stringify(emailW.map((e) => [e.template, e.status])))
    const emailL = await waitOutbox(losers[0].email, (r) => r.some((e) => e.template === "drop_draw_lost" && e.status !== "pending"), 60_000)
    check("email: a non-winner got one drop_draw_lost email", emailL.filter((e) => e.template === "drop_draw_lost").length === 1, JSON.stringify(emailL.map((e) => [e.template, e.status])))
  }

  /* ===== Cancel ===== */
  {
    const c = await createAs(OWN, later("cancel"))
    cleanup.drops.push({ id: c.body?.drop?.id, jar: OWN })
    const s = c.body?.drop ? await post(`/api/drops/${c.body.drop.id}/schedule`, { expectedVersion: c.body.drop.version }, { jar: OWN }) : c
    check("cancel: setup, a second drop scheduled", s.status === 200, brief(s))
    const X = s.body?.drop
    if (X) {
      await post(`/api/drops/${X.id}/reminder`, undefined, { jar: shoppers.s2.jar })
      cleanup.reminders.push({ id: X.id, jar: shoppers.s2.jar })
      check("cancel: a stale version is 409", (await post(`/api/drops/${X.id}/cancel`, { expectedVersion: X.version + 5 }, { jar: OWN })).status === 409)
      check("cancel: a viewer can't cancel (403)", (await post(`/api/drops/${X.id}/cancel`, { expectedVersion: X.version }, { jar: VIEWER })).status === 403)
      const cn = await post(`/api/drops/${X.id}/cancel`, { expectedVersion: X.version }, { jar: OWN })
      check("cancel: the owner cancels it (200, cancelled)", cn.status === 200 && cn.body?.drop?.status === "cancelled", brief(cn))
      check("cancel: cancelling again is 422", (await post(`/api/drops/${X.id}/cancel`, { expectedVersion: X.version + 1 }, { jar: OWN })).status === 422)
      check("cancel: not in the public list any more", !(await get(`/api/drops?brandId=${A.F.id}&phase=all&limit=50`)).body?.items?.some((x) => x.id === X.id))
      check("cancel: a new reminder on it is 422", (await post(`/api/drops/${X.id}/reminder`, undefined, { jar: shoppers.s3.jar })).status === 422)
      check("cancel: it can't be edited (422)", (await patch(`/api/drops/${X.id}`, { name: "x", expectedVersion: X.version + 1 }, { jar: OWN })).status === 422)
    }
  }
}

async function restore() {
  for (const r of cleanup.reminders) await del(`/api/drops/${r.id}/reminder`, { jar: r.jar }).catch(() => {})
  for (const c of cleanup.checkouts) await post(`/api/checkout/${c.id}/stub-expire`, undefined, { jar: c.jar }).catch(() => {})
  for (const j of cleanup.carts) await del("/api/cart", { jar: j }).catch(() => {})
  for (const d of cleanup.drops) {
    if (!d.id) continue
    const cur = (await get("/api/drops/studio?status=all&limit=50", { jar: d.jar }).catch(() => null))?.body?.items?.find((x) => x.id === d.id)
    if (cur && cur.status !== "cancelled" && cur.status !== "ended") await post(`/api/drops/${cur.id}/cancel`, { expectedVersion: cur.version }, { jar: d.jar }).catch(() => {})
  }
  for (const p of cleanup.products) {
    const cur = (await get(`/api/studio/catalog/products/${p.id}`, { jar: p.jar }).catch(() => null))?.body?.product
    if (cur && cur.status !== "archived") await del(`/api/studio/catalog/products/${p.id}?expectedVersion=${cur.version}`, { jar: p.jar }).catch(() => {})
  }
  if (cleanup.links.length) {
    const adm = await demo("admin", "adm_1").catch(() => null)
    if (adm) for (const id of cleanup.links) await del(`/api/admin/founding-brands/${id}/claim-link`, { jar: adm }).catch(() => {})
  }
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
