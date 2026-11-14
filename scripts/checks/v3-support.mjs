#!/usr/bin/env node
// Yard Support + account name/email live acceptance kit. Plain Node 22 (fetch), no dependencies.
//   node scripts/checks/v3-support.mjs            (YARD_BASE overrides http://localhost:3000)
// Prints one PASS/FAIL line per check and exits non-zero when any check fails.
// Every account it creates carries this run's tag (emails contain "t_v3_support_<run>"). It signs in
// as demo admins (adm_1 Owner, adm_5 Support, adm_4 Ads operations) and the demo brand owner
// (u_b_tobi), reads emails through the dev-only /api/auth/dev route (404 in production), and at
// the end deletes the support threads it made and the shopper accounts (deletion + erasure).
import { randomBytes } from "node:crypto"

const BASE = process.env.YARD_BASE ?? "http://localhost:3000"
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`
const TAG = `t_v3_support_${RUN}`
const IP = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`
const PW = "Correct-horse-battery-9"

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
  constructor(name) {
    this.name = name
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

async function call(method, path, { body, jar, origin = true } = {}) {
  const h = { "X-Forwarded-For": IP }
  if (origin && method !== "GET") Object.assign(h, { Origin: BASE, "X-Yard-Client": "1" })
  if (body !== undefined) h["Content-Type"] = "application/json"
  if (jar?.c.size) h.cookie = jar.header()
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" })
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
const del = (p, o) => call("DELETE", p, o)
const sum = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 400)}`
const code = (r) => r.json?.error?.code
const fields = (r) => r.json?.error?.fields ?? {}

const outbox = async (to) => (await get(`/api/auth/dev?op=outbox&email=${encodeURIComponent(to)}`)).json?.emails ?? []
const dev = (body) => post("/api/auth/dev", body)
async function latestToken(to, template) {
  const m = (await outbox(to)).find((e) => e.template === template)
  return m ? new URL(String(m.vars.url)).searchParams.get("token") : null
}
async function signUpAndVerify(who, name) {
  const em = email(who)
  const jar = new Jar(who)
  const r = await post("/api/auth/sign-up", { name, email: em, password: PW })
  const tok = await latestToken(em, "verification")
  const v = tok ? await post("/api/auth/verify-email/confirm", { token: tok }, { jar }) : null
  return { email: em, jar, ok: r.status === 200 && v?.status === 200, userId: v?.json?.profile?.id }
}
async function demo(actor, account) {
  const jar = new Jar(account)
  const r = await post("/api/auth/demo", { actor, account }, { jar })
  return { jar, ok: r.status === 200, r }
}
const notes = async (as, jar) => (await get(`/api/notifications?as=${as}`, { jar })).json?.items ?? []

async function main() {
  console.log(`# run ${RUN} against ${BASE}`)
  const A = await signUpAndVerify("a", "Kit Ada Support")
  const B = await signUpAndVerify("b", "Kit Bola Support")
  check("S0 two kit shoppers signed up and verified", A.ok && B.ok)
  const owner = await demo("admin", "adm_1")
  const agent = await demo("admin", "adm_5")
  const ads = await demo("admin", "adm_4")
  const brand = await demo("brand", "u_b_tobi")
  check("S0 demo admins (owner, support, ads ops) and the demo brand owner signed in", owner.ok && agent.ok && ads.ok && brand.ok, sum(owner.r))
  const BRAND_ID = (await get("/api/session", { jar: brand.jar })).json?.brand?.brand?.id

  // ===== Shopper → Yard Support =================================================================
  const none = await get("/api/support/conversation", { jar: A.jar })
  check("S1 GET /api/support/conversation before any message → { conversation: null }", none.status === 200 && none.json.conversation === null, sum(none))
  const no404 = await get("/api/support/conversation/messages", { jar: A.jar })
  check("S2 GET …/conversation/messages before any message → 404", no404.status === 404, sum(no404))
  const anon = await get("/api/support/conversation")
  check("S3 signed out → 401", anon.status === 401, sum(anon))
  const csrf = await call("POST", "/api/support/messages", { jar: A.jar, body: { clientId: cid(), kind: "text", body: "hi" }, origin: false })
  check("S4 a write without Origin / X-Yard-Client → 403 csrf", csrf.status === 403 && code(csrf) === "csrf", sum(csrf))
  const empty = await post("/api/support/messages", { clientId: cid(), kind: "text", body: "   " }, { jar: A.jar })
  check("S5 an empty text → 400 fields.body", empty.status === 400 && fields(empty).body, sum(empty))
  const photoFirst = await post("/api/support/messages", { clientId: cid(), kind: "image", attachmentIds: ["med_nope"] }, { jar: A.jar })
  check("S6 a photo as the very first message → 400 fields.attachmentIds", photoFirst.status === 400 && fields(photoFirst).attachmentIds, sum(photoFirst))
  const badOrder = await post("/api/support/messages", { clientId: cid(), kind: "order", orderRefId: "or_not_mine", body: "Where is it?" }, { jar: A.jar })
  check("S7 an order that isn't the shopper's → 400 fields.orderRefId", badOrder.status === 400 && fields(badOrder).orderRefId, sum(badOrder))
  const firstId = cid()
  const first = await post("/api/support/messages", { clientId: firstId, kind: "text", body: "Hi Yard, my parcel hasn't moved in a week." }, { jar: A.jar })
  const conv = first.json?.conversation
  check("S8 first message → 201, kind support, counterpart Yard Support, side customer", first.status === 201 && conv?.kind === "support" && conv?.brand?.name === "Yard Support" && first.json.message.side === "customer" && conv.interaction?.canSend === true, sum(first))
  const retry = await post("/api/support/messages", { clientId: firstId, kind: "text", body: "Hi Yard, my parcel hasn't moved in a week." }, { jar: A.jar })
  check("S9 the same clientId again → 200, same message", retry.status === 200 && retry.json.message.id === first.json.message.id, sum(retry))
  const again = await get("/api/support/conversation", { jar: A.jar })
  check("S10 GET /api/support/conversation → the thread (summary)", again.json?.conversation?.id === conv?.id && again.json.conversation.lastMessage?.side === "customer", sum(again))
  const list = await get("/api/inbox/conversations", { jar: A.jar })
  check("S11 the brand inbox list never contains the support thread", list.status === 200 && !list.json.items.some((c) => c.id === conv?.id), sum(list))
  const viaInbox = await get(`/api/inbox/conversations/${conv?.id}/messages`, { jar: A.jar })
  check("S12 the brand inbox routes don't serve a support thread → 404", viaInbox.status === 404, sum(viaInbox))
  const report = await post("/api/reports", { subjectType: "conversation", subjectId: conv?.id, reason: "spam" }, { jar: A.jar })
  check("S13 a support thread can't be reported", report.status === 404 || report.status === 400 || report.status === 403, sum(report))

  // ===== Admin queue ============================================================================
  const q1 = await get("/api/admin/support", { jar: agent.jar })
  const row = q1.json?.items?.find((x) => x.id === conv?.id)
  check("S14 Support admin: the queue lists it first-class (unread, open, shopper party with email)", q1.status === 200 && row?.unread >= 1 && row.status === "open" && row.party.kind === "shopper" && row.party.email === A.email, sum(q1))
  check("S15 unread open conversations are listed before read ones", q1.json?.items?.findIndex((x) => x.unread === 0) === -1 || q1.json.items.findIndex((x) => x.unread === 0) > q1.json.items.findIndex((x) => x.id === conv?.id), q1.json?.items?.map((x) => [x.id, x.unread]))
  const qc = await get("/api/admin/queues/counts", { jar: agent.jar })
  check("S16 queue counts include support for the Support role", qc.status === 200 && typeof qc.json.support === "number" && qc.json.support >= 1, sum(qc))
  const qcAds = await get("/api/admin/queues/counts", { jar: ads.jar })
  check("S17 Ads operations' counts leave support out", qcAds.status === 200 && qcAds.json.support === undefined, sum(qcAds))
  const adsList = await get("/api/admin/support", { jar: ads.jar })
  check("S18 Ads operations (no support.manage) → 403", adsList.status === 403, sum(adsList))
  const agentNotes = await notes("admin", agent.jar)
  check("S19 the Support admin got a notification (support:<id>, Support queue link)", agentNotes.some((n) => n.key === `support:${conv?.id}` && n.href === `/admin/support?case=${encodeURIComponent(conv?.id)}` && n.category === "support_message"), agentNotes.slice(0, 3))
  const adsNotes = await notes("admin", ads.jar)
  check("S20 Ads operations got no support notification", !adsNotes.some((n) => n.key === `support:${conv?.id}`))
  const at = await get(`/api/admin/support/${conv?.id}/messages`, { jar: agent.jar })
  check("S21 admin thread → the shopper's message (side customer)", at.status === 200 && at.json.messages.some((m) => m.side === "customer") && at.json.conversation.kind === "support", sum(at))
  const replyId = cid()
  const reply = await post(`/api/admin/support/${conv?.id}/messages`, { clientId: replyId, body: "Sorry about that! We've chased the brand; tracking updates within a day." }, { jar: agent.jar })
  check("S22 admin reply → 201 as side support; the admin view names its author", reply.status === 201 && reply.json.message.side === "support" && reply.json.message.author?.name, sum(reply))
  const case1 = await get(`/api/admin/support/${conv?.id}`, { jar: agent.jar })
  check("S23 replying assigns an unassigned conversation to the replier", case1.json?.case?.assignee?.name === "Ngozi Eze", sum(case1))

  // ===== Shopper sees the reply =================================================================
  const st = await get("/api/support/conversation/messages", { jar: A.jar })
  const last = st.json?.messages?.at(-1)
  check("S24 shopper thread: Yard Support's reply (side support), no admin name anywhere", st.status === 200 && last?.side === "support" && last.author === undefined && !JSON.stringify(st.json).includes("Ngozi"), sum(st))
  check("S25 shopper summary: unread 1", st.json?.conversation?.unread === 1, st.json?.conversation)
  const un = await get("/api/inbox/unread", { jar: A.jar })
  check("S26 the inbox badge counts the support thread", un.status === 200 && un.json.conversations >= 1, sum(un))
  const shopNotes = await notes("shopper", A.jar)
  const sn = shopNotes.find((n) => n.key === `support:${conv?.id}`)
  check("S27 shopper notification: 'Yard Support replied', category new_message, href /inbox?support=1", sn?.title === "Yard Support replied" && sn.category === "new_message" && sn.href === "/inbox?support=1", shopNotes.slice(0, 3))
  const rd = await post("/api/support/conversation/read", { upToSeq: last?.seq ?? 0 }, { jar: A.jar })
  const afterRead = await get("/api/support/conversation", { jar: A.jar })
  check("S28 read → 204 and unread 0", rd.status === 204 && afterRead.json?.conversation?.unread === 0, sum(rd))
  const adminRead = await post(`/api/admin/support/${conv?.id}/read`, { upToSeq: 1e9 }, { jar: agent.jar })
  const at2 = await get("/api/support/conversation/messages", { jar: A.jar })
  check("S29 admin read → 204; the shopper sees Yard's read receipt", adminRead.status === 204 && at2.json?.receipts?.theirs?.upToSeq >= first.json.message.seq, sum(at2))
  const typing = await post("/api/support/conversation/typing", undefined, { jar: A.jar })
  check("S30 typing → 204", typing.status === 204, sum(typing))

  // ===== Resolve / reopen =======================================================================
  const res = await patch(`/api/admin/support/${conv?.id}`, { status: "resolved" }, { jar: agent.jar })
  check("S31 resolve → case resolved", res.status === 200 && res.json.case.status === "resolved" && res.json.case.resolvedAt, sum(res))
  const st2 = await get("/api/support/conversation/messages", { jar: A.jar })
  check("S32 the shopper sees the resolved line and status", st2.json?.conversation?.status === "resolved" && st2.json.messages.at(-1)?.side === "system", sum(st2))
  const reopenMsg = await post("/api/support/messages", { clientId: cid(), kind: "text", body: "Still nothing, sorry!" }, { jar: A.jar })
  const case2 = await get(`/api/admin/support/${conv?.id}`, { jar: agent.jar })
  check("S33 a new shopper message reopens it", reopenMsg.status === 201 && reopenMsg.json.conversation.status === "open" && case2.json?.case?.status === "open", sum(case2))
  const resolvedAgain = await patch(`/api/admin/support/${conv?.id}`, { status: "resolved" }, { jar: owner.jar })
  const reopened = await patch(`/api/admin/support/${conv?.id}`, { status: "open", assignee: "me" }, { jar: owner.jar })
  check("S34 the Owner can resolve, reopen and take it (assign to me)", resolvedAgain.status === 200 && reopened.json?.case?.status === "open" && reopened.json.case.assignee?.name === "Kemi Ajayi", sum(reopened))
  const mine = await get("/api/admin/support?filter=open&mine=1", { jar: owner.jar })
  check("S35 ?mine=1 lists conversations assigned to the caller", mine.json?.items?.some((x) => x.id === conv?.id) && mine.json.counts.mine >= 1, sum(mine))
  const unassign = await patch(`/api/admin/support/${conv?.id}`, { assignee: null }, { jar: owner.jar })
  check("S36 unassign → assignee null", unassign.json?.case?.assignee === null, sum(unassign))
  const search = await get(`/api/admin/support?filter=all&q=${encodeURIComponent("Kit Ada Support")}`, { jar: owner.jar })
  check("S37 search by shopper name finds it", search.json?.items?.length === 1 && search.json.items[0].id === conv?.id, sum(search))

  // ===== Brand → Yard Support (Studio) ==========================================================
  const bNone = await get("/api/studio/support/conversation", { jar: brand.jar })
  check("S38 Studio: GET /api/studio/support/conversation → 200", bNone.status === 200, sum(bNone))
  if (bNone.json?.conversation) await dev({ op: "delete-support", brandId: BRAND_ID })
  const bSend = await post("/api/studio/support/messages", { clientId: cid(), kind: "text", body: "Hi @support, how do I set up my first drop?" }, { jar: brand.jar })
  const bConv = bSend.json?.conversation
  check("S39 Studio: a brand member messages Yard Support → 201 (side brand)", bSend.status === 201 && bConv?.kind === "support" && bSend.json.message.side === "brand", sum(bSend))
  const q2 = await get("/api/admin/support", { jar: agent.jar })
  const bRow = q2.json?.items?.find((x) => x.id === bConv?.id)
  check("S40 the queue shows the brand party (name and handle)", bRow?.party.kind === "brand" && bRow.party.handle, sum(q2))
  const bReply = await post(`/api/admin/support/${bConv?.id}/messages`, { clientId: cid(), body: "Hi! Open Drops in Studio and choose New drop. Happy to help." }, { jar: agent.jar })
  const bThread = await get("/api/studio/support/conversation/messages", { jar: brand.jar })
  check("S41 the brand sees Yard Support's reply", bReply.status === 201 && bThread.json?.messages?.at(-1)?.side === "support" && bThread.json.conversation.unread === 1, sum(bThread))
  const bNotes = await notes("brand", brand.jar)
  check("S42 brand notification: 'Yard Support replied', href /studio/support", bNotes.some((n) => n.key === `support:${bConv?.id}` && n.href === "/studio/support" && n.title === "Yard Support replied"), bNotes.slice(0, 3))
  const studioList = await get("/api/studio/inbox/conversations", { jar: brand.jar })
  check("S43 the Studio inbox never lists the support thread", studioList.status === 200 && !studioList.json.items.some((c) => c.id === bConv?.id), sum(studioList))
  const bRead = await post("/api/studio/support/conversation/read", { upToSeq: 1e9 }, { jar: brand.jar })
  check("S44 Studio read → 204", bRead.status === 204, sum(bRead))

  // ===== Account: name ==========================================================================
  const acc = await get("/api/account?as=shopper", { jar: A.jar })
  check("A1 GET /api/account → name, email, hasPassword, no pending change", acc.status === 200 && acc.json.account.email === A.email && acc.json.account.hasPassword === true && acc.json.account.pendingEmail === null, sum(acc))
  const nEmpty = await patch("/api/account?as=shopper", { name: "  " }, { jar: A.jar })
  check("A2 an empty name → 400 fields.name", nEmpty.status === 400 && fields(nEmpty).name, sum(nEmpty))
  const nBad = await patch("/api/account?as=shopper", { name: "Ada <b>" }, { jar: A.jar })
  check("A3 a name with < > → 400 (sign-up rules)", nBad.status === 400 && fields(nBad).name, sum(nBad))
  const nLong = await patch("/api/account?as=shopper", { name: "x".repeat(81) }, { jar: A.jar })
  check("A4 a name over 80 characters → 400", nLong.status === 400, sum(nLong))
  const nOk = await patch("/api/account?as=shopper", { name: "Kit Ada Renamed" }, { jar: A.jar })
  const sess = await get("/api/session", { jar: A.jar })
  check("A5 a valid name saves at once (and /api/session shows it)", nOk.status === 200 && nOk.json.account.name === "Kit Ada Renamed" && sess.json?.shopper?.name === "Kit Ada Renamed", sum(nOk))

  // ===== Account: email =========================================================================
  const newA = email("a-new")
  const ePw = await post("/api/account/email?as=shopper", { email: newA }, { jar: A.jar })
  check("A6 no current password → 400 fields.currentPassword", ePw.status === 400 && fields(ePw).currentPassword, sum(ePw))
  const eWrong = await post("/api/account/email?as=shopper", { email: newA, currentPassword: "Wrong-password-1" }, { jar: A.jar })
  check("A7 a wrong password → 400 fields.currentPassword", eWrong.status === 400 && fields(eWrong).currentPassword, sum(eWrong))
  const eSame = await post("/api/account/email?as=shopper", { email: A.email.toUpperCase(), currentPassword: PW }, { jar: A.jar })
  check("A8 the current email → 400 fields.email", eSame.status === 400 && fields(eSame).email, sum(eSame))
  const eTaken = await post("/api/account/email?as=shopper", { email: B.email, currentPassword: PW }, { jar: A.jar })
  const takenMsg = fields(eTaken).email ?? ""
  check("A9 another account's email → 400, generic wording", eTaken.status === 400 && /can't be used/.test(takenMsg) && !takenMsg.includes(B.email), sum(eTaken))
  const eOk = await post("/api/account/email?as=shopper", { email: newA, currentPassword: PW }, { jar: A.jar })
  check("A10 request → 200 with pendingEmail; the email itself unchanged", eOk.status === 200 && eOk.json.account.pendingEmail?.email === newA && eOk.json.account.email === A.email, sum(eOk))
  const tok1 = await latestToken(newA, "email_change")
  check("A11 the link goes to the NEW address (template email_change)", !!tok1)
  const cancel = await del("/api/account/email?as=shopper", { jar: A.jar })
  check("A12 cancel → pendingEmail null", cancel.status === 200 && cancel.json.account.pendingEmail === null, sum(cancel))
  const dead = await post("/api/auth/change-email/confirm", { token: tok1 })
  check("A13 the cancelled link → 400", dead.status === 400, sum(dead))
  await post("/api/account/email?as=shopper", { email: newA, currentPassword: PW }, { jar: A.jar })
  const tok2 = await latestToken(newA, "email_change")
  // B asks for the same new address; whoever confirms second is refused.
  const newShared = email("shared")
  const bReq = await post("/api/account/email?as=shopper", { email: newShared, currentPassword: PW }, { jar: B.jar })
  const bTok = await latestToken(newShared, "email_change")
  const confirm = await post("/api/auth/change-email/confirm", { token: tok2 })
  check("A14 opening the link (no session needed) → 200 changed", confirm.status === 200 && confirm.json.status === "changed" && confirm.json.email === newA, sum(confirm))
  const acc2 = await get("/api/account?as=shopper", { jar: A.jar })
  check("A15 the account email is now the new one, verified, nothing pending", acc2.json?.account?.email === newA && acc2.json.account.emailVerified && acc2.json.account.pendingEmail === null, sum(acc2))
  const oldMail = await outbox(A.email)
  check("A16 the OLD address got the 'email changed' notice", oldMail.some((m) => m.template === "email_changed" && m.vars.email === newA))
  const reuse = await post("/api/auth/change-email/confirm", { token: tok2 })
  check("A17 the same link again → 400", reuse.status === 400, sum(reuse))
  const siNew = await post("/api/auth/sign-in", { email: newA, password: PW })
  const siOld = await post("/api/auth/sign-in", { email: A.email, password: PW })
  check("A18 sign-in works with the new email, not the old one", siNew.json?.status === "signed_in" && siOld.status === 401, `${sum(siNew)} | ${sum(siOld)}`)
  // A now takes the shared address first; B's later confirmation is refused.
  await post("/api/account/email?as=shopper", { email: newShared, currentPassword: PW }, { jar: A.jar })
  const aTok = await latestToken(newShared, "email_change")
  const aConfirm = await post("/api/auth/change-email/confirm", { token: aTok })
  const bConfirm = await post("/api/auth/change-email/confirm", { token: bTok })
  check("A19 two accounts racing for one address: the second confirmation → 409 conflict", bReq.status === 200 && aConfirm.status === 200 && bConfirm.status === 409 && code(bConfirm) === "conflict", `${sum(aConfirm)} | ${sum(bConfirm)}`)
  const bAcc = await get("/api/account?as=shopper", { jar: B.jar })
  check("A20 the refused account keeps its email", bAcc.json?.account?.email === B.email, sum(bAcc))
  const brandAcc = await get("/api/account?as=brand", { jar: brand.jar })
  const brandEmail = await post("/api/account/email?as=brand", { email: email("brand-new") }, { jar: brand.jar })
  check("A21 a demo brand member reads its account; changing a demo email → 422", brandAcc.status === 200 && brandAcc.json.account.demo === true && brandEmail.status === 422, `${sum(brandAcc)} | ${sum(brandEmail)}`)

  // ===== Cleanup ================================================================================
  const finalA = newShared
  const d1 = await dev({ op: "delete-support", email: finalA })
  const d2 = await dev({ op: "delete-support", brandId: BRAND_ID })
  check("Z1 cleanup: this run's support threads deleted", d1.json?.deleted === 1 && d2.json?.deleted === 1, `${sum(d1)} | ${sum(d2)}`)
  let ok = 0
  for (const c of [{ email: finalA }, { email: B.email }]) {
    const j = new Jar("cleanup")
    const si = await post("/api/auth/sign-in", { email: c.email, password: PW }, { jar: j })
    if (si.json?.status !== "signed_in") continue
    const r = await post("/api/auth/account/delete", { confirm: "DELETE" }, { jar: j })
    if (r.status === 200) ok++
  }
  await dev({ op: "run-erasures" })
  check("Z2 cleanup: this run's shopper accounts deleted and erased", ok === 2, { ok })
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
