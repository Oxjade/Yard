#!/usr/bin/env node
// Admin › Brands › Delete brand live acceptance kit (catalog/brand-removal.ts). Plain Node 22
// (fetch, no deps). One PASS/FAIL/SKIP line per check; non-zero exit when any check fails.
//
//   node scripts/checks/v3-brand-removal.mjs     (server at YARD_BASE, default http://localhost:3000)
//
// Needs a DEVELOPMENT server: demo sign-in (adm_1 owner, adm_3 trust & safety) and demo re-auth.
// Delete path: the kit creates its own founding brand (handle kit-del-<run>) with an uploaded
// cover, checks permission, the preview, the typed-handle and mode guards, deletes it, and checks
// it's gone everywhere (admin, public page, its file, the audit log).
// Close path (opt-in, it is final): YARD_KIT_CLOSE_BRAND=<brand id with orders> closes that brand
// and checks its orders stay readable by Yard (and by YARD_KIT_CLOSE_SHOPPER=<demo account>, the
// customer of YARD_KIT_CLOSE_ORDER=<order id>, when given). Without it the close checks SKIP.
import { deflateSync, crc32 } from "node:zlib"
import { pathToFileURL } from "node:url"

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const TAG = `t_v3_brand_removal_${RUN}`

async function run(options = {}) {
  const base = (options.base ?? process.env.YARD_BASE ?? "http://localhost:3000").replace(/\/$/, "")
  const results = []
  const check = (name, ok, detail = "") => {
    const r = { status: ok ? "PASS" : "FAIL", name, detail: ok ? "" : String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300) }
    results.push(r)
    console.log(`${r.status} ${name}${r.detail ? ` — ${r.detail}` : ""}`)
    return !!ok
  }
  const skip = (name, why) => {
    results.push({ status: "SKIP", name, detail: why })
    console.log(`SKIP ${name} — ${why}`)
  }

  const jarOf = () => ({ cookie: "" })
  const merge = (jar, res) => {
    const m = new Map(jar.cookie.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c]))
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const kv = c.split(";")[0]
      const name = kv.split("=")[0]
      if (kv === `${name}=` || /max-age=0/i.test(c)) m.delete(name)
      else m.set(name, kv)
    }
    jar.cookie = [...m.values()].join("; ")
  }
  async function api(method, path, { jar, body, raw, headers } = {}) {
    const h = { Origin: base, "X-Yard-Client": "1", ...(headers ?? {}) }
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
    if (jar) merge(jar, res)
    return { status: res.status, body: json, text }
  }
  const brief = (r) => `${r.status} ${r.body?.error ? `${r.body.error.code}: ${r.body.error.message}` : r.text.slice(0, 200)}`
  async function demo(actor, account) {
    const jar = jarOf()
    const r = await api("POST", "/api/auth/demo", { jar, body: { actor, account } })
    if (r.status !== 200) throw new Error(`demo sign-in ${actor}/${account}: ${brief(r)}`)
    return jar
  }
  function png() {
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
      for (let x = 0; x < w; x++) rows.push(Buffer.from([(x * 7) & 255, (y * 3) & 255, 90]))
    }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))])
  }
  function upload(jar, query) {
    const boundary = `----yardkit${RUN}`
    const buf = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}.png"\r\nContent-Type: image/png\r\n\r\n`), png(), Buffer.from(`\r\n--${boundary}--\r\n`)])
    return api("POST", `/api/uploads?${query}`, { jar, raw: buf, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": String(buf.length) } })
  }
  const reauth = (jar) => api("POST", "/api/auth/reauth?as=admin", { jar, body: { demo: true } })

  let OWNER
  let TS
  try {
    OWNER = await demo("admin", "adm_1")
    TS = await demo("admin", "adm_3")
  } catch (e) {
    check("demo admins sign in", false, e.message)
    return results
  }

  /* ===== Delete: a brand with no orders ===== */
  const handle = `kit-del-${RUN}`.slice(0, 30)
  const c = await api("POST", "/api/admin/founding-brands", { jar: OWNER, body: { name: `Kit Delete ${RUN}`.slice(0, 40), handle, category: "fashion", city: "Lagos", country: "NG", currency: "NGN", story: `${TAG}: made to be deleted.`, idempotencyKey: `${TAG}_create` } })
  const B = c.body?.brand
  if (!check("setup: a founding brand to delete (201)", c.status === 201 && B?.id, brief(c))) return results
  const cover = await upload(OWNER, `purpose=storefront_cover&as=admin&brandId=${B.id}`)
  const mediaId = cover.body?.media?.id
  check("setup: its cover uploaded (201)", cover.status === 201 && mediaId, brief(cover))
  const p = await api("PATCH", `/api/admin/founding-brands/${B.id}`, { jar: OWNER, body: { bannerMediaId: mediaId } })
  check("setup: cover set on the storefront draft", p.status === 200, brief(p))
  const pageBefore = await api("GET", `/brands/${handle}`)
  check("setup: its public page answers before (opens soon, 200)", pageBefore.status === 200, `${pageBefore.status}`)

  const tsPreview = await api("GET", `/api/admin/brands/${B.id}/removal`, { jar: TS })
  check("permission: a trust & safety admin can't preview (403)", tsPreview.status === 403, brief(tsPreview))
  const tsDelete = await api("DELETE", `/api/admin/brands/${B.id}`, { jar: TS, body: { mode: "delete", confirmHandle: handle, reason: `${TAG} not allowed` } })
  check("permission: a trust & safety admin can't delete (403)", tsDelete.status === 403, brief(tsDelete))
  const anon = await api("DELETE", `/api/admin/brands/${B.id}`, { body: { mode: "delete", confirmHandle: handle, reason: `${TAG} anonymous` } })
  check("permission: anonymous is 401", anon.status === 401, brief(anon))

  const pv = await api("GET", `/api/admin/brands/${B.id}/removal`, { jar: OWNER })
  check("preview: mode delete, with why and the counts", pv.status === 200 && pv.body?.mode === "delete" && /no orders/.test(pv.body?.why ?? "") && pv.body?.footprint?.mediaFiles >= 1 && pv.body?.records?.orders === 0, brief(pv))
  check("re-auth: a fresh demo confirmation is accepted", (await reauth(OWNER)).status === 200)
  const wrong = await api("DELETE", `/api/admin/brands/${B.id}`, { jar: OWNER, body: { mode: "delete", confirmHandle: "not-the-handle", reason: `${TAG} wrong handle` } })
  check("guard: a wrong typed handle is 400 (confirmHandle)", wrong.status === 400 && !!wrong.body?.error?.fields?.confirmHandle, brief(wrong))
  const wrongMode = await api("DELETE", `/api/admin/brands/${B.id}`, { jar: OWNER, body: { mode: "close", confirmHandle: handle, reason: `${TAG} wrong mode` } })
  check("guard: a mode that isn't the preview's is 409", wrongMode.status === 409, brief(wrongMode))
  const noReason = await api("DELETE", `/api/admin/brands/${B.id}`, { jar: OWNER, body: { mode: "delete", confirmHandle: handle, reason: "x" } })
  check("guard: a reason is required (400)", noReason.status === 400, brief(noReason))
  const done = await api("DELETE", `/api/admin/brands/${B.id}`, { jar: OWNER, body: { mode: "delete", confirmHandle: handle.toUpperCase(), reason: `${TAG}: kit test brand` } })
  check("delete: 200, erased, its file removed", done.status === 200 && done.body?.mode === "delete" && done.body?.filesRemoved >= 1 && done.body?.removed?.mediaFiles >= 1, brief(done))
  const again = await api("DELETE", `/api/admin/brands/${B.id}`, { jar: OWNER, body: { mode: "delete", confirmHandle: handle, reason: `${TAG}: second time` } })
  check("delete: a second delete is 404", again.status === 404, brief(again))
  check("gone: Admin founding brand is 404", (await api("GET", `/api/admin/founding-brands/${B.id}`, { jar: OWNER })).status === 404)
  const list = await api("GET", "/api/admin/founding-brands?limit=100", { jar: OWNER })
  check("gone: not in the founding list", list.status === 200 && !list.body?.items?.some((x) => x.id === B.id), brief(list))
  check("gone: its cover is 404", (await api("GET", `/api/media/${mediaId}?as=admin`, { jar: OWNER })).status === 404)
  const page = await api("GET", `/brands/${handle}`)
  check("gone: its public page is 404", page.status === 404, `${page.status}`)
  const handleCheck = await api("GET", `/api/admin/founding-brands/handle?handle=${handle}`, { jar: OWNER })
  check("gone: its handle is free again", handleCheck.status === 200 && handleCheck.body?.available === true, brief(handleCheck))
  const audit = await api("GET", `/api/admin/audit?subjectType=brand&subjectId=${B.id}`, { jar: OWNER })
  const row = audit.body?.items?.find((x) => x.action === "brand.deleted")
  check("audit: brand.deleted written with who, which brand and the reason", audit.status === 200 && row && row.actorKind === "admin" && row.target?.includes(`@${handle}`) && row.reason === `${TAG}: kit test brand`, brief(audit))

  /* ===== Close: a brand with orders (opt-in) ===== */
  const closeId = process.env.YARD_KIT_CLOSE_BRAND
  if (!closeId) {
    skip("close: a brand with orders is closed, its orders stay readable", "set YARD_KIT_CLOSE_BRAND (final: the brand stays closed)")
    return results
  }
  const cp = await api("GET", `/api/admin/brands/${closeId}/removal`, { jar: OWNER })
  if (!check("close preview: mode close, says why", cp.status === 200 && cp.body?.mode === "close" && cp.body?.records?.orders > 0 && /closed, not erased/.test(cp.body?.why ?? ""), brief(cp))) return results
  const ch = cp.body.brand.handle
  await reauth(OWNER)
  const closed = await api("DELETE", `/api/admin/brands/${closeId}`, { jar: OWNER, body: { mode: "close", confirmHandle: ch, reason: `${TAG}: kit close` } })
  check("close: 200, closed", closed.status === 200 && closed.body?.mode === "close", brief(closed))
  check("close: its public page is 404", (await api("GET", `/brands/${ch}`)).status === 404)
  const st = await api("GET", `/api/admin/statuses?kind=brand&ids=${closeId}`, { jar: OWNER })
  check("close: Admin sees it suspended and closed, with nothing to reinstate", st.status === 200 && st.body?.statuses?.[closeId] === "suspended" && !!st.body?.closed?.[closeId] && !st.body?.reinstateTo?.[closeId], brief(st))
  const reinstate = await api("POST", "/api/admin/decisions/set-brand-status", { jar: OWNER, body: { id: closeId, status: "reinstate", reason: `${TAG}: try to reinstate` } })
  check("close: reinstating a closed brand is refused (409)", reinstate.status === 409, brief(reinstate))
  const closeAudit = await api("GET", `/api/admin/audit?subjectType=brand&subjectId=${closeId}`, { jar: OWNER })
  check("close: brand.closed audited", closeAudit.body?.items?.some((x) => x.action === "brand.closed"), brief(closeAudit))
  const order = process.env.YARD_KIT_CLOSE_ORDER
  if (order) {
    const adminOrder = await api("GET", `/api/orders/admin/${order}`, { jar: OWNER })
    check("close: Yard still reads the order", adminOrder.status === 200 && !!adminOrder.body?.order, brief(adminOrder))
    const shopperAccount = process.env.YARD_KIT_CLOSE_SHOPPER
    if (shopperAccount) {
      const shopper = await demo("shopper", shopperAccount)
      const mine = await api("GET", `/api/orders/${order}`, { jar: shopper })
      check("close: the shopper still reads the order", mine.status === 200 && !!mine.body?.order, brief(mine))
    }
  }
  return results
}

export default run

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = await run()
  process.exitCode = out.some((r) => r.status === "FAIL") ? 1 : 0
}
