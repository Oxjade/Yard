#!/usr/bin/env node
// Profile photo live acceptance kit. Plain Node 22 (fetch), no dependencies.
//   node scripts/checks/v3-profile-photo.mjs            (YARD_BASE overrides http://localhost:3000)
// Prints one PASS/FAIL line per check and exits non-zero when any check fails.
// Signs up two kit shoppers (emails contain "t_v3_photo_<run>"), and signs in as demo accounts:
// u_b_tobi (owner of Lagos Static), u_b_minji (Null Form), u_ada (demo shopper), adm_1 (Owner) and
// adm_4 (Ads operations, no content.moderate). At the end the dev-only /api/auth/dev route deletes
// the kit shopper's conversation, and both kit accounts are deleted and erased (photos included).
import { readFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { deflateSync } from "node:zlib"

const BASE = process.env.YARD_BASE ?? "http://localhost:3000"
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`
const TAG = `t_v3_photo_${RUN}`
const IP = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`
const PW = "Correct-horse-battery-9"
const BRAND_A = "b_lagos_static"

let failed = 0
let passed = 0
const check = (name, ok, detail = "") => {
  if (ok) passed++
  else failed++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 500)}` : ""}`)
  return ok
}
const email = (who) => `${TAG}_${who}@example.com`
const cid = () => `kit${randomBytes(8).toString("hex")}`

class Jar {
  constructor() {
    this.c = new Map()
  }
  take(res) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = sc.split(";")
      const i = pair.indexOf("=")
      const k = pair.slice(0, i).trim()
      const v = pair.slice(i + 1).trim()
      if (attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || v === "") this.c.delete(k)
      else this.c.set(k, v)
    }
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ")
  }
}

async function call(method, path, { body, jar, raw, headers = {}, write = true } = {}) {
  const h = { "X-Forwarded-For": IP, ...headers }
  if (method !== "GET" && write) Object.assign(h, { Origin: BASE, "X-Yard-Client": "1" })
  if (body !== undefined) h["Content-Type"] = "application/json"
  if (jar?.c.size) h.cookie = jar.header()
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body))
  if (raw) h["Content-Length"] = String(raw.length)
  const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: "manual" })
  jar?.take(res)
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { _raw: text.slice(0, 200) }
  }
  return { status: res.status, json }
}
const get = (p, o) => call("GET", p, o)
const post = (p, body, o = {}) => call("POST", p, { ...o, body })
const del = (p, o) => call("DELETE", p, o)
const sum = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 400)}`
const code = (r) => r.json?.error?.code
const dev = (body) => post("/api/auth/dev", body)

const outbox = async (to) => (await get(`/api/auth/dev?op=outbox&email=${encodeURIComponent(to)}`)).json?.emails ?? []
async function latestToken(to, template) {
  const m = (await outbox(to)).find((e) => e.template === template)
  return m ? new URL(String(m.vars.url)).searchParams.get("token") : null
}
async function signUpAndVerify(who, name) {
  const em = email(who)
  const jar = new Jar()
  const r = await post("/api/auth/sign-up", { name, email: em, password: PW })
  const tok = await latestToken(em, "verification")
  const v = tok ? await post("/api/auth/verify-email/confirm", { token: tok }, { jar }) : null
  return { email: em, jar, ok: r.status === 200 && v?.status === 200, userId: v?.json?.profile?.id }
}
async function demo(actor, account) {
  const jar = new Jar()
  const r = await post("/api/auth/demo", { actor, account }, { jar })
  return { jar, ok: r.status === 200, r }
}
const notes = async (as, jar) => (await get(`/api/notifications?as=${as}`, { jar })).json?.items ?? []

// ── Files ──────────────────────────────────────────────────────────────────────────────────────
/** The fixture JPEG with an Exif APP1 segment (camera + GPS marker text) added after SOI. */
function jpegWithExif() {
  const base = readFileSync(new URL("../../public/media/fashion/campaign-woman-low-key-portrait-04.jpg", import.meta.url))
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), Buffer.from(`KITCAMERA GPS 6.45N 3.39E ${TAG}`)])
  const len = Buffer.alloc(2)
  len.writeUInt16BE(payload.length + 2)
  return Buffer.concat([base.subarray(0, 2), Buffer.from([0xff, 0xe1]), len, payload, base.subarray(2)])
}
function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
/** A solid RGB PNG of `side` px. */
function png(side, rgb = [109, 25, 217]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(side, 0)
  ihdr.writeUInt32BE(side, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: side }, () => rgb).flat())])
  const raw = Buffer.concat(Array.from({ length: side }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}
function multipart(parts) {
  const boundary = `----yardphoto${RUN}`
  const chunks = []
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ""}\r\nContent-Type: ${p.type ?? "application/octet-stream"}\r\n\r\n`), p.data, Buffer.from("\r\n"))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { raw: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` }
}
async function uploadPhoto(jar, data, { as = "shopper", type = "image/jpeg", filename = "photo.jpg", parts, method = "POST", headers = {}, write } = {}) {
  const mp = multipart(parts ?? [{ name: "file", filename, type, data }])
  return call(method, `/api/account/photo?as=${as}`, { jar, raw: mp.raw, headers: { "Content-Type": mp.type, ...headers }, write })
}
async function media(src, jar, headers = {}) {
  const res = await fetch(BASE + src, { headers: { ...(jar?.c.size ? { cookie: jar.header() } : {}), ...headers } })
  const body = Buffer.from(await res.arrayBuffer())
  return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), body }
}
const asAdmin = (src) => src.replace(/\?as=\w+$/, "?as=admin")
const asBrand = (src) => src.replace(/\?as=\w+$/, "?as=brand")
const SAME = { "Sec-Fetch-Site": "same-origin" }

async function main() {
  console.log(`# run ${RUN} against ${BASE}`)
  const A = await signUpAndVerify("a", "Kit Amara Photo")
  const B = await signUpAndVerify("b", "Kit Bayo Stranger")
  const tobi = await demo("brand", "u_b_tobi")
  const minji = await demo("brand", "u_b_minji")
  const ada = await demo("shopper", "u_ada")
  const owner = await demo("admin", "adm_1")
  const ads = await demo("admin", "adm_4")
  check("P0 two kit shoppers signed up; demo brand members, shopper and admins signed in", A.ok && B.ok && tobi.ok && minji.ok && ada.ok && owner.ok && ads.ok, sum(owner.r))

  // ===== Add ==================================================================================
  const acc0 = await get("/api/account?as=shopper", { jar: A.jar })
  check("P1 GET /api/account → photo null before any upload", acc0.status === 200 && acc0.json.account.photo === null, sum(acc0))
  const jpeg = jpegWithExif()
  const up1 = await uploadPhoto(A.jar, jpeg)
  const p1 = up1.json?.account?.photo
  check("P2 POST /api/account/photo (JPEG) → 200 { account } with photo { mediaId, src ?as=shopper, width, height }", up1.status === 200 && /^med_/.test(p1?.mediaId ?? "") && p1.src === `/api/media/${p1.mediaId}?as=shopper` && p1.width > 0 && p1.height > 0, sum(up1))
  const own = await media(p1?.src ?? "/x", A.jar)
  check("P3 the owner reads it (200 image/jpeg, private cache)", own.status === 200 && own.type === "image/jpeg" && /private/.test(own.cache ?? ""), `${own.status} ${own.type} ${own.cache}`)
  check("P4 metadata stripped: the stored file has no Exif segment or the kit's GPS text", own.body.length > 0 && !own.body.includes(Buffer.from("Exif\0\0", "binary")) && !own.body.includes(Buffer.from("KITCAMERA")), own.body.length)
  const sess = await get("/api/session", { jar: A.jar })
  check("P5 GET /api/session → shopper.photoSrc is the photo", sess.json?.shopper?.photoSrc === p1?.src, sum(sess))
  const acc1 = await get("/api/account?as=shopper", { jar: A.jar })
  check("P6 GET /api/account returns the same photo", acc1.json?.account?.photo?.mediaId === p1?.mediaId, sum(acc1))

  // ===== Visibility ===========================================================================
  const stranger = await media(p1.src, B.jar)
  const anon = await media(p1.src.replace(/\?.*$/, ""))
  const anonAs = await media(p1.src)
  check("P7 another shopper and anonymous visitors get 404 (private, never public)", stranger.status === 404 && anon.status === 404 && anonAs.status === 404, `${stranger.status} ${anon.status} ${anonAs.status}`)
  const brandBefore = await media(asBrand(p1.src), tobi.jar)
  check("P8 a brand the shopper has never messaged or bought from → 404", brandBefore.status === 404, brandBefore.status)
  const send = await post("/api/inbox/messages", { brandId: BRAND_A, clientId: cid(), kind: "text", body: `Hi! Do you have the jacket in medium? ${TAG}`, topic: "sizing", origin: "storefront" }, { jar: A.jar })
  const convId = send.json?.conversation?.id
  check("P9 the kit shopper messages Lagos Static", send.status === 201 && !!convId, sum(send))
  const studioList = await get("/api/studio/inbox/conversations", { jar: tobi.jar })
  const row = (studioList.json?.items ?? []).find((c) => c.id === convId)
  check("P10 Studio inbox: the conversation's customer carries photoSrc (?as=brand)", row?.customer?.photoSrc === `/api/media/${p1.mediaId}?as=brand`, row ?? sum(studioList))
  const brandSees = await media(row?.customer?.photoSrc ?? asBrand(p1.src), tobi.jar)
  check("P11 the brand in the conversation reads the customer's photo (200)", brandSees.status === 200 && brandSees.type === "image/jpeg", brandSees.status)
  const otherBrand = await media(asBrand(p1.src), minji.jar)
  check("P12 another brand still gets 404", otherBrand.status === 404, otherBrand.status)
  const adminSees = await media(asAdmin(p1.src), owner.jar, SAME)
  const adminCross = await media(asAdmin(p1.src), owner.jar)
  check("P13 admins read the current photo same-origin (200); without Sec-Fetch-Site same-origin → 404", adminSees.status === 200 && adminCross.status === 404, `${adminSees.status} ${adminCross.status}`)
  const dir = await get(`/api/admin/users?q=${encodeURIComponent(TAG)}`, { jar: owner.jar })
  const dirRow = (dir.json?.items ?? []).find((u) => u.email === A.email)
  check("P14 Admin › Users directory carries photoSrc (?as=admin)", dirRow?.photoSrc === `/api/media/${p1.mediaId}?as=admin`, dirRow ?? sum(dir))

  // ===== Replace ==============================================================================
  const up2 = await uploadPhoto(A.jar, png(256), { type: "image/png", filename: "square.png", method: "PUT" })
  const p2 = up2.json?.account?.photo
  check("P15 PUT /api/account/photo (PNG) replaces it: new mediaId and src", up2.status === 200 && p2?.mediaId && p2.mediaId !== p1.mediaId && p2.width === 256 && p2.height === 256, sum(up2))
  const oldForBrand = await media(asBrand(p1.src), tobi.jar)
  const newForBrand = await media(asBrand(p2?.src ?? "/x"), tobi.jar)
  check("P16 the replaced photo is no longer shown to the brand (404); the new one is (200)", oldForBrand.status === 404 && newForBrand.status === 200 && newForBrand.type === "image/png", `${oldForBrand.status} ${newForBrand.status}`)
  const audit1 = await get(`/api/admin/audit?subjectId=${A.userId}&actorKind=all`, { jar: owner.jar })
  const actions1 = (audit1.json?.items ?? []).map((e) => e.action)
  check("P17 audit: account.photo_added then account.photo_replaced on the user", actions1.includes("account.photo_added") && actions1.includes("account.photo_replaced"), actions1)

  // ===== Refusals =============================================================================
  const gif = await uploadPhoto(A.jar, Buffer.concat([Buffer.from("GIF89a"), randomBytes(400)]), { type: "image/gif", filename: "a.gif" })
  const txt = await uploadPhoto(A.jar, Buffer.from("not a photo at all ".repeat(20)), { type: "image/jpeg", filename: "fake.jpg" })
  check("P18 a GIF and a text file named .jpg → 415 unsupported_type", gif.status === 415 && code(gif) === "unsupported_type" && txt.status === 415, `${sum(gif)} | ${sum(txt)}`)
  const big = await uploadPhoto(A.jar, Buffer.concat([jpeg, randomBytes(10 * 1024 * 1024)]))
  check("P19 over 10 MB → 413 too_large", big.status === 413 && code(big) === "too_large", sum(big))
  const tiny = await uploadPhoto(A.jar, png(32), { type: "image/png", filename: "tiny.png" })
  check("P20 smaller than 64 px → 422 rule", tiny.status === 422 && /64 px/.test(tiny.json?.error?.message ?? ""), sum(tiny))
  const two = await uploadPhoto(A.jar, null, { parts: [{ name: "file", filename: "a.png", type: "image/png", data: png(128) }, { name: "file", filename: "b.png", type: "image/png", data: png(128) }] })
  const none = await uploadPhoto(A.jar, null, { parts: [{ name: "other", data: Buffer.from("x") }] })
  check("P21 two files, or no `file` field → 400 validation", two.status === 400 && none.status === 400, `${sum(two)} | ${sum(none)}`)
  const csrf = await uploadPhoto(A.jar, png(128), { type: "image/png", write: false })
  check("P22 without Origin / X-Yard-Client → 403 csrf", csrf.status === 403 && code(csrf) === "csrf", sum(csrf))
  const anonUp = await uploadPhoto(new Jar(), png(128), { type: "image/png" })
  check("P23 signed out → 401", anonUp.status === 401, sum(anonUp))
  const demoUp = await uploadPhoto(ada.jar, png(128), { type: "image/png" })
  const demoDel = await del("/api/account/photo?as=shopper", { jar: ada.jar })
  const demoBrand = await uploadPhoto(tobi.jar, png(128), { type: "image/png", as: "brand" })
  check("P24 demo accounts (shopper and brand member) → 422 \"Demo accounts can't change their photo.\"", demoUp.status === 422 && demoDel.status === 422 && demoBrand.status === 422 && /Demo accounts can't change their photo/.test(demoUp.json?.error?.message ?? ""), `${sum(demoUp)} | ${sum(demoDel)} | ${sum(demoBrand)}`)
  const still = await get("/api/account?as=shopper", { jar: A.jar })
  check("P25 refused uploads left the photo as it was", still.json?.account?.photo?.mediaId === p2?.mediaId, sum(still))

  // ===== Admin removal ========================================================================
  const noPerm = await post("/api/admin/decisions/remove-account-photo", { id: A.userId, reason: "Not a photo of a person" }, { jar: ads.jar })
  check("P26 an admin without content.moderate → 403", noPerm.status === 403, sum(noPerm))
  const noReason = await post("/api/admin/decisions/remove-account-photo", { id: A.userId, reason: "" }, { jar: owner.jar })
  check("P27 a removal needs a reason → 400", noReason.status === 400, sum(noReason))
  const removed = await post("/api/admin/decisions/remove-account-photo", { id: A.userId, reason: "Not a photo of a person" }, { jar: owner.jar })
  check("P28 content.moderate admin removes it → 200 { item, audit user.photo_removed with the reason }", removed.status === 200 && removed.json.item.removedMediaId === p2?.mediaId && removed.json.audit.action === "user.photo_removed" && removed.json.audit.reason === "Not a photo of a person", sum(removed))
  const again = await post("/api/admin/decisions/remove-account-photo", { id: A.userId, reason: "Not a photo of a person" }, { jar: owner.jar })
  check("P29 removing again → 409 (no photo)", again.status === 409, sum(again))
  const accR = await get("/api/account?as=shopper", { jar: A.jar })
  const sessR = await get("/api/session", { jar: A.jar })
  check("P30 the account is back to initials: photo null, session photoSrc null", accR.json?.account?.photo === null && sessR.json?.shopper?.photoSrc === null, `${sum(accR)} | ${sum(sessR)}`)
  const goneOwner = await media(p2.src, A.jar)
  const goneBrand = await media(asBrand(p2.src), tobi.jar)
  const evidence = await media(asAdmin(p2.src), owner.jar, SAME)
  const noEvidence = await media(asAdmin(p2.src), ads.jar, SAME)
  check("P31 the removed file: 404 for the owner and the brand; content moderators still open it (200), others 404", goneOwner.status === 404 && goneBrand.status === 404 && evidence.status === 200 && noEvidence.status === 404, `${goneOwner.status} ${goneBrand.status} ${evidence.status} ${noEvidence.status}`)
  const aNotes = await notes("shopper", A.jar)
  const notice = aNotes.find((n) => n.key === `photo-moderation:${p2.mediaId}`)
  check("P32 the person is notified with the reason (content_moderation, links to Settings)", notice?.title === "Yard removed your profile photo" && /Not a photo of a person/.test(notice.body) && notice.href === "/you/settings" && notice.category === "content_moderation", aNotes.slice(0, 3))
  const audit2 = await get(`/api/admin/audit?subjectId=${A.userId}&actorKind=admin`, { jar: owner.jar })
  const entry = (audit2.json?.items ?? []).find((e) => e.action === "user.photo_removed")
  check("P33 Admin audit log lists user.photo_removed with the reason and the admin", entry?.reason === "Not a photo of a person" && !!entry.actor, entry ?? sum(audit2))

  // ===== Remove your own ======================================================================
  const up3 = await uploadPhoto(A.jar, jpeg)
  const p3 = up3.json?.account?.photo
  check("P34 after a removal the person can add a new photo", up3.status === 200 && !!p3?.mediaId, sum(up3))
  const mine = await del("/api/account/photo?as=shopper", { jar: A.jar })
  const mineAgain = await del("/api/account/photo?as=shopper", { jar: A.jar })
  check("P35 DELETE /api/account/photo → photo null; again → 200 (nothing to remove)", mine.status === 200 && mine.json.account.photo === null && mineAgain.status === 200, `${sum(mine)} | ${sum(mineAgain)}`)
  const gone3 = await media(asBrand(p3?.src ?? "/x"), tobi.jar)
  check("P36 the removed photo is no longer shown to the brand", gone3.status === 404, gone3.status)
  const audit3 = await get(`/api/admin/audit?subjectId=${A.userId}&actorKind=all`, { jar: owner.jar })
  check("P37 audit: account.photo_removed by the person", (audit3.json?.items ?? []).some((e) => e.action === "account.photo_removed"), (audit3.json?.items ?? []).map((e) => e.action))

  // ===== Brand member, own account ============================================================
  const brandAcc = await get("/api/account?as=brand", { jar: tobi.jar })
  check("P38 GET /api/account?as=brand carries photo (null for the demo member)", brandAcc.status === 200 && brandAcc.json.account.photo === null && brandAcc.json.account.demo === true, sum(brandAcc))

  // ===== Cleanup ==============================================================================
  const up4 = await uploadPhoto(A.jar, png(128), { type: "image/png" })
  const d1 = await dev({ op: "delete-conversations", email: A.email })
  check("Z1 cleanup: the kit conversation is deleted", d1.json?.deleted === 1, sum(d1))
  let ok = 0
  for (const c of [A, B]) {
    const j = new Jar()
    const si = await post("/api/auth/sign-in", { email: c.email, password: PW }, { jar: j })
    if (si.json?.status !== "signed_in") continue
    const r = await post("/api/auth/account/delete", { confirm: "DELETE" }, { jar: j })
    if (r.status === 200) ok++
  }
  await dev({ op: "run-erasures" })
  const erased = await media(asAdmin(up4.json?.account?.photo?.src ?? "/x"), owner.jar, SAME)
  const erasedRemoved = await media(asAdmin(p2.src), owner.jar, SAME)
  check("Z2 cleanup: both kit accounts deleted and erased; every photo of theirs is gone (404), removed ones too", ok === 2 && erased.status === 404 && erasedRemoved.status === 404, { ok, erased: erased.status, removed: erasedRemoved.status })
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
