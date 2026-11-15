#!/usr/bin/env node
// Suggestions from Yard (product proposals) live acceptance kit. Plain Node 22 (fetch), no dependencies.
//   node scripts/checks/v3-proposals.mjs            (YARD_BASE overrides http://localhost:3000)
// Prints one PASS/FAIL line per check and exits non-zero when any check fails.
// Signs in as demo admins (adm_1 Owner, adm_3 Trust & safety, adm_4 Ads operations, adm_5 Support),
// demo brand members (u_b_tobi owner and u_b_viewer viewer of Lagos Static, u_b_minji of Null Form)
// and the demo shopper (u_ada). Every suggestion and product it makes carries this run's tag
// ("t_v3_proposals_<run>") in its note or name; at the end the dev-only /api/auth/dev route deletes
// them, the products made from them, their notifications, emails and photos.
import { readFileSync } from "node:fs"
import { randomBytes } from "node:crypto"

const BASE = process.env.YARD_BASE ?? "http://localhost:3000"
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`
const TAG = `t_v3_proposals_${RUN}`
const IP = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`
const BRAND_A = "b_lagos_static"

let failed = 0
let passed = 0
const check = (name, ok, detail = "") => {
  if (ok) passed++
  else failed++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 500)}` : ""}`)
  return ok
}

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

async function call(method, path, { body, jar, raw, headers = {} } = {}) {
  const h = { "X-Forwarded-For": IP, ...headers }
  if (method !== "GET") Object.assign(h, { Origin: BASE, "X-Yard-Client": "1" })
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
const patch = (p, body, o = {}) => call("PATCH", p, { ...o, body })
const sum = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 400)}`
const fields = (r) => r.json?.error?.fields ?? {}
const dev = (body) => post("/api/auth/dev", body)

async function demo(actor, account) {
  const jar = new Jar()
  const r = await post("/api/auth/demo", { actor, account }, { jar })
  return { jar, ok: r.status === 200, r }
}
const notes = async (as, jar) => (await get(`/api/notifications?as=${as}`, { jar })).json?.items ?? []

async function uploadPhoto(jar, brandId) {
  const boundary = `----yardproposals${RUN}`
  const file = readFileSync(new URL("../../public/media/fashion/tops-white-tee-hanger-concrete-07.jpg", import.meta.url))
  const raw = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${TAG}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)])
  return call("POST", `/api/uploads?purpose=social_post&as=admin&brandId=${encodeURIComponent(brandId)}`, { jar, raw, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` } })
}

async function main() {
  console.log(`# run ${RUN} against ${BASE}`)
  const owner = await demo("admin", "adm_1")
  const trust = await demo("admin", "adm_3")
  const ads = await demo("admin", "adm_4")
  const support = await demo("admin", "adm_5")
  const tobi = await demo("brand", "u_b_tobi")
  const viewer = await demo("brand", "u_b_viewer")
  const minji = await demo("brand", "u_b_minji")
  const ada = await demo("shopper", "u_ada")
  check("P0 demo admins, brand members and the shopper signed in", [owner, trust, ads, support, tobi, viewer, minji, ada].every((x) => x.ok), sum(owner.r))

  // ===== Admin: context, photo, new-product suggestion ==========================================
  const ctx = await get(`/api/admin/proposals/context?brandId=${BRAND_A}`, { jar: owner.jar })
  check("P1 the form context: brand currency, handling time, its products and collections", ctx.status === 200 && ctx.json.brand.id === BRAND_A && !!ctx.json.brand.currency && Array.isArray(ctx.json.products) && ctx.json.products.length > 0, sum(ctx))
  const sample = ctx.json?.products?.[0]
  const up = await uploadPhoto(owner.jar, BRAND_A)
  const mediaId = up.json?.media?.id
  check("P2 an admin with catalog.propose uploads a photo for the brand (private)", up.status === 201 && !!mediaId && up.json.media.visibility === "private", sum(up))
  const upNo = await uploadPhoto(ads.jar, BRAND_A)
  check("P3 an admin without catalog.propose can't upload for a brand → 403", upNo.status === 403, sum(upNo))
  const brandSees = await fetch(`${BASE}/api/media/${mediaId}?as=brand`, { headers: { cookie: tobi.jar.header() } })
  const otherBrand = await fetch(`${BASE}/api/media/${mediaId}?as=brand`, { headers: { cookie: minji.jar.header() } })
  const anonPhoto = await fetch(`${BASE}/api/media/${mediaId}`)
  check("P4 the brand's members see the photo before accepting; another brand and the public don't", brandSees.status === 200 && otherBrand.status === 404 && anonPhoto.status === 404, `${brandSees.status} ${otherBrand.status} ${anonPhoto.status}`)

  const title = `Kit Tee ${TAG}`
  const product = {
    title,
    description: "Heavyweight cotton tee with a boxy fit. Printed in Lagos.",
    categorySlug: sample?.category,
    subcategory: sample?.subcategory ?? null,
    tags: ["cotton", "kit"],
    priceMinor: 1500000,
    processingDays: [1, 3],
    options: [{ name: "Size", values: [{ value: "M" }, { value: "L" }] }],
    variants: [
      { sku: `KIT-${RUN}-M`.toUpperCase(), options: { Size: "M" }, initialStock: 5 },
      { sku: `KIT-${RUN}-L`.toUpperCase(), options: { Size: "L" }, initialStock: 3 },
    ],
    images: [{ mediaId, alt: "Front" }],
    collectionIds: [],
  }
  const noPerm = await post("/api/admin/proposals", { kind: "new", brandId: BRAND_A, product, note: TAG }, { jar: ads.jar })
  const noPerm2 = await get("/api/admin/proposals", { jar: support.jar })
  check("P5 admins without catalog.propose (ads ops, support) → 403 on create and list", noPerm.status === 403 && noPerm2.status === 403, `${sum(noPerm)} | ${sum(noPerm2)}`)
  const bad = await post("/api/admin/proposals", { kind: "new", brandId: BRAND_A, product: { ...product, dropId: "d_x" }, note: TAG }, { jar: owner.jar })
  const badImg = await post("/api/admin/proposals", { kind: "new", brandId: BRAND_A, product: { ...product, images: [{ mediaId: "med_not_theirs", alt: "" }] }, note: TAG }, { jar: owner.jar })
  check("P6 unknown fields (a drop) and a photo that isn't the brand's → 400", bad.status === 400 && badImg.status === 400 && Object.keys(fields(badImg)).some((k) => k.startsWith("product.images")), `${sum(bad)} | ${sum(badImg)}`)
  const created = await post("/api/admin/proposals", { kind: "new", brandId: BRAND_A, product, note: `Lookbook photos attached ${TAG}` }, { jar: owner.jar })
  const P1 = created.json?.proposal
  check("P7 new-product suggestion → 201 pending, nothing in the catalogue yet", created.status === 201 && P1?.status === "pending" && P1.kind === "new" && P1.productId === null && P1.title === title, sum(created))
  const pub0 = await get(`/api/catalog/products?brand=${BRAND_A}&limit=60`)
  check("P8 the public catalogue doesn't have it", !(pub0.json?.products ?? pub0.json?.items ?? []).some((p) => p.title === title), sum(pub0))

  // ===== Brand notified =========================================================================
  const bNotes = await notes("brand", tobi.jar)
  const n1 = bNotes.find((n) => n.key === `proposal:${P1?.id}`)
  check("P9 the brand gets a Studio notification naming the product, linking to the review page", !!n1 && n1.title === `Yard suggested a new product: ${title}` && n1.href === `/studio/products/suggestions/${P1?.id}`, JSON.stringify(n1 ?? bNotes.slice(0, 2)))
  const mails = (await get(`/api/auth/dev?op=proposal-emails&proposalId=${P1?.id}`)).json?.emails ?? []
  check("P10 an email row per product manager (template product_suggestion, product name, note and review link)", mails.length >= 1 && mails.every((m) => m.template === "product_suggestion" && m.vars.product === title && String(m.vars.url).includes(`/studio/products/suggestions/${P1?.id}`) && String(m.vars.note).includes(TAG)), JSON.stringify(mails).slice(0, 400))
  const sList = await get("/api/studio/proposals", { jar: tobi.jar })
  check("P11 Studio lists it as waiting (pending count)", sList.status === 200 && sList.json.counts.pending >= 1 && sList.json.items.some((p) => p.id === P1?.id), sum(sList))
  const sOne = await get(`/api/studio/proposals/${P1?.id}`, { jar: tobi.jar })
  check("P12 the brand reads it without the admin's name; it says accepting publishes it", sOne.status === 200 && sOne.json.proposal.createdBy === undefined && sOne.json.proposal.willPublish === true && sOne.json.proposal.proposed.title === title && sOne.json.proposal.images[mediaId]?.src.includes("as=brand"), sum(sOne))

  // ===== Refusals ===============================================================================
  const otherB = await get(`/api/studio/proposals/${P1?.id}`, { jar: minji.jar })
  const otherBAccept = await post(`/api/studio/proposals/${P1?.id}/accept`, {}, { jar: minji.jar })
  const otherList = await get("/api/studio/proposals?status=all", { jar: minji.jar })
  check("P13 brand B can't see or accept brand A's suggestion (404) and doesn't list it", otherB.status === 404 && otherBAccept.status === 404 && !(otherList.json?.items ?? []).some((p) => p.id === P1?.id), `${sum(otherB)} | ${sum(otherBAccept)}`)
  const shopper = await get(`/api/studio/proposals/${P1?.id}`, { jar: ada.jar })
  const shopperAdmin = await get(`/api/admin/proposals/${P1?.id}`, { jar: ada.jar })
  check("P14 a shopper can't read it (401 on Studio and Admin)", shopper.status === 401 && shopperAdmin.status === 401, `${sum(shopper)} | ${sum(shopperAdmin)}`)
  const viewerAccept = await post(`/api/studio/proposals/${P1?.id}/accept`, {}, { jar: viewer.jar })
  const viewerRead = await get(`/api/studio/proposals/${P1?.id}`, { jar: viewer.jar })
  check("P15 a brand viewer can read it but can't accept (403)", viewerRead.status === 200 && viewerAccept.status === 403, `${sum(viewerRead)} | ${sum(viewerAccept)}`)
  const adsRead = await get(`/api/admin/proposals/${P1?.id}`, { jar: ads.jar })
  const trustRead = await get(`/api/admin/proposals/${P1?.id}`, { jar: trust.jar })
  check("P16 Admin detail: ads ops → 403; trust & safety (catalog.propose) → 200 with who sent it", adsRead.status === 403 && trustRead.status === 200 && trustRead.json.proposal.createdBy?.id, `${sum(adsRead)} | ${sum(trustRead)}`)

  // ===== Accept → live ==========================================================================
  const accepted = await post(`/api/studio/proposals/${P1?.id}/accept`, {}, { jar: tobi.jar })
  const productId = accepted.json?.productId
  check("P17 the brand accepts → product created and published", accepted.status === 200 && accepted.json.proposal.status === "accepted" && !!productId && accepted.json.published === true, sum(accepted))
  const again = await post(`/api/studio/proposals/${P1?.id}/accept`, {}, { jar: tobi.jar })
  check("P18 accepting twice → 409", again.status === 409, sum(again))
  const live = await get(`/api/catalog/products?brand=${BRAND_A}&limit=60&sort=new`)
  const liveRow = (live.json?.products ?? live.json?.items ?? []).find((p) => p.id === productId)
  check("P19 it's live in the public catalogue with its price, both variants and the photo", !!liveRow && liveRow.priceMinor === 1500000 && liveRow.variants.length === 2 && liveRow.images.length === 1, sum(live))
  const photoPublic = await fetch(`${BASE}/api/media/${mediaId}`)
  check("P20 the photo is public now that a published product shows it", photoPublic.status === 200, String(photoPublic.status))
  const aNotes = await notes("admin", owner.jar)
  const n2 = aNotes.find((n) => n.key === `proposal.decided:${P1?.id}`)
  check("P21 the admin who sent it is told it was accepted", !!n2 && /accepted your suggestion/.test(n2.title), JSON.stringify(n2 ?? aNotes.slice(0, 2)))
  const aList = await get(`/api/admin/proposals?status=accepted&brandId=${BRAND_A}`, { jar: owner.jar })
  check("P22 the Admin list shows it as accepted, with the brand member who answered", aList.status === 200 && aList.json.items.some((p) => p.id === P1?.id && p.status === "accepted" && p.decidedBy?.name), sum(aList))

  // ===== Edit → decline =========================================================================
  const pctx = await get(`/api/admin/proposals/context?productId=${productId}`, { jar: owner.jar })
  const cur = pctx.json?.product
  check("P23 the edit form context has the product and no waiting suggestion", pctx.status === 200 && cur?.id === productId && pctx.json.pendingId === null, sum(pctx))
  const editBody = (over = {}) => ({
    title: cur.title,
    description: cur.description,
    details: cur.details,
    categorySlug: cur.category,
    subcategory: cur.subcategory,
    tags: cur.tags,
    badges: cur.badges,
    priceMinor: cur.priceMinor,
    compareAtMinor: cur.compareAtMinor,
    processingDays: cur.processingDays,
    options: cur.options,
    variants: cur.variants.filter((v) => v.status === "active").map((v) => ({ id: v.id, sku: v.sku, options: v.options, priceMinor: v.priceOverrideMinor })),
    images: cur.images.map((i) => ({ id: i.id, alt: i.alt })),
    collectionIds: cur.collectionIds,
    stockDelta: {},
    expectedVersion: cur.version,
    ...over,
  })
  const same = await post("/api/admin/proposals", { kind: "edit", productId, product: editBody(), note: TAG }, { jar: owner.jar })
  check("P24 an edit that changes nothing → 400", same.status === 400, sum(same))
  const mId = cur.variants.find((v) => v.options.Size === "M")?.id
  const mStock = cur.variants.find((v) => v.id === mId)?.onHand
  const stale = await post("/api/admin/proposals", { kind: "edit", productId, product: editBody({ priceMinor: 1200000, expectedVersion: cur.version + 1 }), note: TAG }, { jar: owner.jar })
  check("P24b a form loaded from another version of the product → 409", stale.status === 409, sum(stale))
  const e1 = await post("/api/admin/proposals", { kind: "edit", productId, product: editBody({ priceMinor: 1200000, stockDelta: { [mId]: 4 } }), note: `Winter price ${TAG}` }, { jar: owner.jar })
  const E1 = e1.json?.proposal
  const sc = E1?.changes?.find((c) => c.field === "stock")
  check("P25 edit suggestion → 201 with only the changed fields (price, stock as a change: +4)", e1.status === 201 && JSON.stringify(E1?.fields) === JSON.stringify(["priceMinor", "stock"]) && E1.changes[0].before === 1500000 && E1.changes[0].after === 1200000 && E1.stockDelta?.[mId] === 4 && sc?.before?.[mId] === mStock && sc?.after?.[mId] === mStock + 4, sum(e1))
  const dup = await post("/api/admin/proposals", { kind: "edit", productId, product: editBody({ priceMinor: 1100000 }), note: TAG }, { jar: owner.jar })
  check("P26 a second edit for the same product while one waits → 409", dup.status === 409, sum(dup))
  const n3 = (await notes("brand", tobi.jar)).find((n) => n.key === `proposal:${E1?.id}`)
  check("P27 the brand is told: “Yard suggested changes to …”", !!n3 && n3.title.startsWith("Yard suggested changes to"), JSON.stringify(n3))
  const declined = await post(`/api/studio/proposals/${E1?.id}/decline`, { reason: "Price stays for now." }, { jar: tobi.jar })
  check("P28 the brand declines with a reason", declined.status === 200 && declined.json.proposal.status === "declined" && declined.json.proposal.declineReason === "Price stays for now.", sum(declined))
  const after = await get(`/api/catalog/products/${encodeURIComponent(liveRow?.slug ?? productId)}`)
  const afterP = after.json?.product ?? after.json
  check("P29 nothing changed on the product", afterP?.priceMinor === 1500000, sum(after))
  const n4 = (await notes("admin", owner.jar)).find((n) => n.key === `proposal.decided:${E1?.id}`)
  check("P30 the admin is told it was declined", !!n4 && /declined your suggestion/.test(n4.title), JSON.stringify(n4))
  // Two suggestions for the same product at once: one wins, the other is the same 409 (not a 500).
  const race = await Promise.all([1, 2].map((i) => post("/api/admin/proposals", { kind: "edit", productId, product: editBody({ tags: ["cotton", `race${i}`] }), note: `Race ${i} ${TAG}` }, { jar: owner.jar })))
  const won = race.find((r) => r.status === 201)
  check("P30b two at once for the same product → one 201, one 409", JSON.stringify(race.map((r) => r.status).sort()) === "[201,409]", race.map(sum).join(" | "))
  if (won) await post(`/api/admin/proposals/${won.json.proposal.id}/withdraw`, {}, { jar: owner.jar })

  // ===== Withdraw ===============================================================================
  const e2 = await post("/api/admin/proposals", { kind: "edit", productId, product: editBody({ tags: ["cotton", "kit", "winter"] }), note: `Tags ${TAG}` }, { jar: owner.jar })
  const E2 = e2.json?.proposal
  const wNo = await post(`/api/admin/proposals/${E2?.id}/withdraw`, {}, { jar: ads.jar })
  const w = await post(`/api/admin/proposals/${E2?.id}/withdraw`, {}, { jar: owner.jar })
  check("P31 withdraw: ads ops → 403; owner → withdrawn", e2.status === 201 && wNo.status === 403 && w.status === 200 && w.json.proposal.status === "withdrawn", `${sum(e2)} | ${sum(w)}`)
  const n5 = (await notes("brand", tobi.jar)).find((n) => n.key === `proposal:${E2?.id}`)
  const wAccept = await post(`/api/studio/proposals/${E2?.id}/accept`, {}, { jar: tobi.jar })
  check("P32 the brand's notification is gone and the withdrawn suggestion can't be accepted (409)", !n5 && wAccept.status === 409, `${JSON.stringify(n5)} | ${sum(wAccept)}`)
  const w2 = await post(`/api/admin/proposals/${E2?.id}/withdraw`, {}, { jar: owner.jar })
  check("P33 withdrawing twice → 409", w2.status === 409, sum(w2))

  // ===== Update (supersede) + conflict flag =====================================================
  const e3 = await post("/api/admin/proposals", { kind: "edit", productId, product: editBody({ priceMinor: 1300000, title: `Kit Tee II ${TAG}` }), note: `Rename ${TAG}` }, { jar: owner.jar })
  const E3 = e3.json?.proposal
  const rev = await post(`/api/admin/proposals/${E3?.id}/revise`, { product: editBody({ priceMinor: 1350000, title: `Kit Tee II ${TAG}`, stockDelta: { [mId]: 2 } }), note: `Rename, new price ${TAG}` }, { jar: trust.jar })
  const E4 = rev.json?.proposal
  const oldNow = await get(`/api/admin/proposals/${E3?.id}`, { jar: owner.jar })
  check("P34 update supersedes: the old one reads “superseded”, the new one is pending", rev.status === 201 && E4?.status === "pending" && E4.supersedesId === E3?.id && oldNow.json?.proposal?.status === "superseded", `${sum(rev)} | ${sum(oldNow)}`)
  const oldBrand = await get(`/api/studio/proposals/${E3?.id}`, { jar: tobi.jar })
  const oldAccept = await post(`/api/studio/proposals/${E3?.id}/accept`, {}, { jar: tobi.jar })
  check("P35 the replaced version's link (an older email) opens the latest version; answering the old one → 409", oldBrand.status === 200 && oldBrand.json.proposal.id === E4?.id && oldAccept.status === 409, `${sum(oldBrand)} | ${sum(oldAccept)}`)
  // A sale while it waits: the suggested +2 lands on the count then, the sale is kept.
  const sold = await post(`/api/studio/catalog/variants/${mId}/stock`, { mode: "adjust", qty: -1, reason: "correction" }, { jar: tobi.jar })
  // The brand changes the price itself before answering.
  const sp = await get(`/api/studio/catalog/products/${productId}`, { jar: tobi.jar })
  const changed = await patch(`/api/studio/catalog/products/${productId}`, { priceMinor: 1400000, expectedVersion: sp.json?.product?.version }, { jar: tobi.jar })
  const flagged = await get(`/api/studio/proposals/${E4?.id}`, { jar: tobi.jar })
  const pc = flagged.json?.proposal?.changes?.find((c) => c.field === "priceMinor")
  const fs = flagged.json?.proposal?.changes?.find((c) => c.field === "stock")
  check("P36 conflict flag: the price the brand changed since is flagged with its value now; stock (a sale since) isn't, and reads from the count now", sold.status === 200 && changed.status === 200 && flagged.json?.proposal?.conflicts?.includes("priceMinor") && pc?.changedSince === true && pc.now === 1400000 && pc.before === 1500000 && !flagged.json.proposal.conflicts.includes("title") && !flagged.json.proposal.conflicts.includes("stock") && fs?.before?.[mId] === mStock - 1 && fs?.after?.[mId] === mStock + 1, `${sum(sold)} | ${sum(changed)} | ${sum(flagged)}`)
  // Edit before accepting, from a form loaded before the brand's price change: the usual 409.
  const staleOwn = await post(`/api/studio/proposals/${E4?.id}/accept`, { product: editBody({ title: `Kit Tee II ${TAG}`, priceMinor: 1350000, stockDelta: { [mId]: 2 } }) }, { jar: tobi.jar })
  const stillWaiting = await get(`/api/studio/proposals/${E4?.id}`, { jar: tobi.jar })
  check("P36b “edit before accepting” from a stale form → 409, the suggestion still waits", staleOwn.status === 409 && stillWaiting.json?.proposal?.status === "pending", `${sum(staleOwn)} | ${sum(stillWaiting)}`)
  // Edit before accepting: the brand keeps Yard's name and stock change but its own price.
  const fresh = (await get(`/api/studio/catalog/products/${productId}`, { jar: tobi.jar })).json?.product
  const own = await post(`/api/studio/proposals/${E4?.id}/accept`, { product: editBody({ title: `Kit Tee II ${TAG}`, priceMinor: 1400000, stockDelta: { [mId]: 2 }, expectedVersion: fresh?.version }) }, { jar: tobi.jar })
  const final = await get(`/api/studio/catalog/products/${productId}`, { jar: tobi.jar })
  const finalM = final.json?.product?.variants?.find((v) => v.id === mId)?.onHand
  check("P37 “edit before accepting” applies the brand's version (Yard's name, its own price, +2 on top of the sale)", own.status === 200 && own.json.proposal.status === "accepted" && final.json?.product?.title === `Kit Tee II ${TAG}` && final.json.product.priceMinor === 1400000 && finalM === mStock + 1, `${sum(own)} | ${finalM} vs ${mStock + 1}`)
  const audit = await get(`/api/admin/audit?actorKind=all&subjectId=${[P1?.id, E1?.id, E2?.id, E4?.id].join(",")}`, { jar: owner.jar })
  const actions = new Set((audit.json?.entries ?? audit.json?.items ?? []).map((e) => e.action))
  check("P38 audit: created, updated, withdrawn, accepted and declined are all recorded", ["catalog.proposal_created", "catalog.proposal_updated", "catalog.proposal_withdrawn", "catalog.proposal_accepted", "catalog.proposal_declined"].every((a) => actions.has(a)), [...actions].join(", ") || sum(audit))

  // ===== Cleanup ================================================================================
  const z = await dev({ op: "delete-proposals", tag: TAG })
  check("Z1 cleanup: this run's suggestions, product, notifications, emails and photo deleted", z.status === 200 && z.json.proposals >= 5 && z.json.products === 1 && z.json.mediaPurged >= 1, sum(z))
  const gone = await get(`/api/catalog/products?brand=${BRAND_A}&limit=60`)
  const left = await get(`/api/admin/proposals?status=all&q=${encodeURIComponent(TAG)}`, { jar: owner.jar })
  check("Z2 nothing of this run is left (catalogue, suggestions)", !(gone.json?.products ?? gone.json?.items ?? []).some((p) => p.title.includes(TAG)) && left.json?.total === 0, `${sum(left)}`)
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
