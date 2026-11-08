#!/usr/bin/env node
// v3 AUTH live acceptance kit. Plain Node 22 (fetch, node:crypto), no dependencies.
//   node scripts/checks/v3-auth.mjs            (YARD_BASE overrides http://localhost:3000)
// Prints one PASS/FAIL line per check and exits non-zero when any check fails.
// Every record it creates carries this run's tag (emails contain "t_v3_auth_<run>"); it reads
// emails and inspects accounts through the dev-only /api/auth/dev route (404 in production), and
// at the end deletes the shopper/brand accounts it made (account deletion + erasure) and retires
// the real admins it made.
import { createHmac, randomBytes } from "node:crypto"

const BASE = process.env.YARD_BASE ?? "http://localhost:3000"
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`
const TAG = `t_v3_auth_${RUN}`
// The dev server trusts one proxy hop: a per-run client IP gives this run its own rate-limit buckets.
const IP = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`
const PW = "Correct-horse-battery-9"
const PW2 = "Another-good-passphrase-7"
const PW3 = "Third-strong-passphrase-5"

let failed = 0
let passed = 0
const check = (name, ok, detail = "") => {
  if (ok) passed++
  else failed++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}` : ""}`)
  return ok
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const email = (who) => `${TAG}_${who}@example.com`

// ---------------------------------------------------------------------------------------------
// HTTP with per-browser cookie jars

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
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || v === ""
      if (expired) this.c.delete(k)
      else this.c.set(k, v)
    }
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ")
  }
  has(name) {
    return this.c.has(name)
  }
}

async function call(method, path, { body, jar, headers = {}, origin = true, redirect = "manual" } = {}) {
  const h = { "X-Forwarded-For": IP, ...headers }
  if (origin && method !== "GET") Object.assign(h, { Origin: BASE, "X-Yard-Client": "1" })
  if (body !== undefined) h["Content-Type"] = "application/json"
  if (jar?.c.size) h.cookie = jar.header()
  const deadline = Date.now() + 120_000
  for (;;) {
    try {
      const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect })
      jar?.take(res)
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = { _raw: text.slice(0, 200) }
      }
      return { status: res.status, json, headers: res.headers }
    } catch (e) {
      if (Date.now() > deadline) throw e
      await sleep(3000) // the guard restarts a dead dev server; wait for it
    }
  }
}
const get = (path, o) => call("GET", path, o)
const post = (path, body, o = {}) => call("POST", path, { ...o, body })
const del = (path, o) => call("DELETE", path, o)
const sum = (r) => `${r.status} ${JSON.stringify(r.json).slice(0, 300)}`
const code = (r) => r.json?.error?.code
const fields = (r) => r.json?.error?.fields ?? {}

const session = async (jar) => (await get("/api/session", { jar })).json ?? {}

// Dev helpers (test-only route)
const outbox = async (to) => (await get(`/api/auth/dev?op=outbox&email=${encodeURIComponent(to)}`)).json?.emails ?? []
const inspect = async (q) => (await get(`/api/auth/dev?op=inspect&${q.includes("@") ? "email" : "userId"}=${encodeURIComponent(q)}`)).json
const dev = (body) => post("/api/auth/dev", body)
const tokenFromUrl = (u) => new URL(u).searchParams.get("token")
async function latestToken(to, template) {
  const m = (await outbox(to)).find((e) => e.template === template)
  return m ? tokenFromUrl(String(m.vars.url)) : null
}

// TOTP (RFC 6238, SHA-1, 6 digits, 30 s)
function b32(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = 0
  let val = 0
  const out = []
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, "")) {
    val = (val << 5) | A.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}
function hotp(secret, counter) {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac("sha1", b32(secret)).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0")
}
const stepNow = () => Math.floor(Date.now() / 30_000)
/** A code the server hasn't seen yet for this admin (steps now and now+1 are always inside its window); waits for a new step when both are used. */
async function freshCode(admin) {
  for (;;) {
    const now = stepNow()
    for (const s of [now, now + 1])
      if (s > (admin.lastStep ?? 0)) {
        admin.lastStep = s
        return hotp(admin.secret, s)
      }
    await sleep(30_000 - (Date.now() % 30_000) + 200)
  }
}

async function signUpAndVerify(who, name = `Kit ${who}`) {
  const em = email(who)
  const jar = new Jar(who)
  const r = await post("/api/auth/sign-up", { name, email: em, password: PW })
  const tok = await latestToken(em, "verification")
  const v = tok ? await post("/api/auth/verify-email/confirm", { token: tok }, { jar }) : null
  return { email: em, jar, ok: r.status === 200 && v?.status === 200, userId: v?.json?.profile?.id, r, v }
}

const cleanup = { shoppers: [], admins: [] }

// ---------------------------------------------------------------------------------------------
async function main() {
  console.log(`# v3 AUTH kit — run ${RUN}, base ${BASE}, client ip ${IP}`)

  // ===== Providers, OAuth not configured, CSRF ==================================================
  {
    const p = await get("/api/auth/providers")
    check("A1 providers: password+magicLink on, google/apple off (no keys)", p.status === 200 && p.json.password === true && p.json.magicLink === true && p.json.google === false && p.json.apple === false && typeof p.json.demo?.shopper === "boolean", sum(p))
    for (const prov of ["google", "apple"]) {
      const s = await post(`/api/auth/oauth/${prov}/start`, { mode: "signin", actor: "shopper" })
      check(`A2 oauth ${prov} start → 503 not_configured`, s.status === 503 && code(s) === "not_configured", sum(s))
    }
    const bad = await post("/api/auth/oauth/github/start", { mode: "signin" })
    check("A3 oauth unknown provider → 400", bad.status === 400, sum(bad))
    const badMode = await post("/api/auth/oauth/google/start", { mode: "steal" })
    check("A4 oauth start bad mode → 400", badMode.status === 400 && code(badMode) === "validation", sum(badMode))
    const cb = await get("/api/auth/oauth/google/callback?code=x&state=nope")
    const loc = cb.headers.get("location") ?? ""
    check("A5 oauth callback with unknown state → 302 /auth/complete result=invalid_state", cb.status === 302 && loc.includes("/auth/complete") && loc.includes("result=invalid_state"), `${cb.status} ${loc}`)
    const ap = await call("POST", "/api/auth/oauth/apple/callback", { origin: false, headers: { "Content-Type": "application/x-www-form-urlencoded" } })
    check("A6 apple form_post callback re-enters as 303", ap.status === 303 && (ap.headers.get("location") ?? "").includes("/api/auth/oauth/apple/callback"), `${ap.status} ${ap.headers.get("location")}`)
    const noOrigin = await call("POST", "/api/auth/sign-up", { origin: false, body: { name: "x", email: email("csrf"), password: PW } })
    check("A7 mutation without Origin/X-Yard-Client → 403 csrf", noOrigin.status === 403 && code(noOrigin) === "csrf", sum(noOrigin))
    const noClient = await call("POST", "/api/auth/sign-in", { origin: false, headers: { Origin: BASE }, body: { email: email("csrf"), password: PW } })
    check("A8 mutation with Origin but no X-Yard-Client → 403 csrf", noClient.status === 403 && code(noClient) === "csrf", sum(noClient))
  }

  // ===== Sign-up, verification, sign-in =========================================================
  const S = { email: email("shop"), jar: new Jar("S"), jar2: new Jar("S2") }
  {
    const v1 = await post("/api/auth/sign-up", { name: "Kit Shopper", email: S.email, password: "short" })
    check("B1 sign-up short password → 400 fields.password", v1.status === 400 && fields(v1).password, sum(v1))
    const v2 = await post("/api/auth/sign-up", { name: "Kit Shopper", email: "not-an-email", password: PW })
    check("B2 sign-up bad email → 400 fields.email", v2.status === 400 && fields(v2).email, sum(v2))
    const v3 = await post("/api/auth/sign-up", { name: "Kit Shopper", email: S.email, password: PW, admin: true })
    check("B3 sign-up unknown field → 400 (strict)", v3.status === 400, sum(v3))
    const v4 = await post("/api/auth/sign-up", { name: "Kit Shopper", email: S.email, password: "password123" })
    check("B4 sign-up guessable password → 400 fields.password", v4.status === 400 && fields(v4).password, sum(v4))
    const v5 = await post("/api/auth/sign-up", { name: "Kit <b>", email: S.email, password: PW })
    check("B5 sign-up name with markup → 400 fields.name", v5.status === 400 && fields(v5).name, sum(v5))

    const r = await post("/api/auth/sign-up", { name: "Kit Shopper", email: S.email.toUpperCase(), password: PW })
    check("B6 sign-up → 200 {status: verify_email}", r.status === 200 && r.json.status === "verify_email", sum(r))
    const mails = await outbox(S.email)
    const ver = mails.find((m) => m.template === "verification")
    check("B7 verification email queued to the normalised address with a /auth/verify link", !!ver && String(ver.vars.url).includes("/auth/verify?token="), mails)
    S.firstToken = ver ? tokenFromUrl(String(ver.vars.url)) : null

    const again = await post("/api/auth/sign-up", { name: "Someone Else", email: S.email, password: PW2 })
    check("B8 sign-up with an existing email → same answer (no enumeration)", again.status === 200 && again.json.status === "verify_email", sum(again))
    const after = await outbox(S.email)
    check("B9 existing account gets a sign-in link email instead of a second account", after.some((m) => m.template === "magic_link"), after.map((m) => m.template))
    const ins = await inspect(S.email)
    check("B10 one account, unverified, password stored as hash only", ins?.user?.kind === "shopper" && ins.user.demo === false && ins.credentials?.hasPassword === true && !ins.credentials.emailVerifiedAt, ins)
    S.userId = ins?.user?.id

    const early = await post("/api/auth/sign-in", { email: S.email, password: PW })
    check("B11 sign-in before verifying → {status: verify_email}, no cookie", early.status === 200 && early.json.status === "verify_email" && !S.jar.has("yard_s"), sum(early))
    const wrong = await post("/api/auth/sign-in", { email: S.email, password: "Wrong-password-123" })
    const unknown = await post("/api/auth/sign-in", { email: email("nobody"), password: "Wrong-password-123" })
    check("B12 wrong password → 401 unauthenticated", wrong.status === 401 && code(wrong) === "unauthenticated", sum(wrong))
    check("B13 unknown email → same 401 and message as a wrong password", unknown.status === 401 && unknown.json?.error?.message === wrong.json?.error?.message, sum(unknown))

    const garbage = await post("/api/auth/verify-email/confirm", { token: randomBytes(32).toString("base64url") })
    check("B14 verify with an unknown token → 400", garbage.status === 400, sum(garbage))
    const short = await post("/api/auth/verify-email/confirm", { token: "abc" })
    check("B15 verify with a malformed token → 400 validation", short.status === 400 && code(short) === "validation", sum(short))

    // The early sign-in re-sent verification (replacing the first token).
    const newest = await latestToken(S.email, "verification")
    check("B16 sign-in before verifying re-sent a new verification link", !!newest && newest !== S.firstToken, { newest, first: S.firstToken })
    if (S.firstToken && newest !== S.firstToken) {
      const old = await post("/api/auth/verify-email/confirm", { token: S.firstToken })
      check("B17 the replaced verification link no longer works", old.status === 400, sum(old))
    }
    const ok = await post("/api/auth/verify-email/confirm", { token: newest ?? "x".repeat(43) }, { jar: S.jar })
    check("B18 verify → verified + signed in as shopper (cookie set)", ok.status === 200 && ok.json.status === "verified" && ok.json.signedIn === true && ok.json.profile?.id === S.userId && S.jar.has("yard_s"), sum(ok))
    const reuse = await post("/api/auth/verify-email/confirm", { token: newest ?? "x".repeat(43) })
    check("B19 verification link is single-use", reuse.status === 400, sum(reuse))
    const me = await session(S.jar)
    check("B20 /api/session shows the real shopper (demo false)", me.shopper?.id === S.userId && me.shopper?.demo === false, me)
    const sec = await get("/api/auth/security?as=shopper", { jar: S.jar })
    check("B21 security: method email_verification, verified, has password, fresh reauth", sec.status === 200 && sec.json.method === "email_verification" && sec.json.emailVerified === true && sec.json.hasPassword === true && sec.json.reauthAgeSec !== null && sec.json.reauthAgeSec < 60, sum(sec))
    const secAnon = await get("/api/auth/security?as=shopper")
    check("B22 security without a session → 401", secAnon.status === 401, sum(secAnon))
    const secBad = await get("/api/auth/security?as=root", { jar: S.jar })
    check("B23 security with as=root → 400", secBad.status === 400, sum(secBad))
    const reqVerified = await post("/api/auth/verify-email/request", { email: S.email })
    check("B24 verify-email/request for a verified account → ok (no new email)", reqVerified.status === 200 && reqVerified.json.ok === true, sum(reqVerified))

    const si = await post("/api/auth/sign-in", { email: `  ${S.email.toUpperCase()} `, password: PW }, { jar: S.jar2 })
    check("B25 sign-in (case/space-insensitive email) → signed_in shopper", si.status === 200 && si.json.status === "signed_in" && si.json.actor === "shopper" && si.json.profile?.id === S.userId && S.jar2.has("yard_s"), sum(si))
    const asAdmin = await post("/api/auth/sign-in", { email: S.email, password: PW, actor: "admin" })
    check("B26 shopper signing in as admin → 403", asAdmin.status === 403, sum(asAdmin))
    const asBrand = await post("/api/auth/sign-in", { email: S.email, password: PW, actor: "brand" })
    check("B27 shopper signing in as brand (no membership) → 403", asBrand.status === 403, sum(asBrand))
    const auths = (await inspect(S.email))?.sessionAuth ?? []
    check("B28 real sessions carry session_auth rows (email_verification + password)", auths.some((a) => a.method === "email_verification") && auths.some((a) => a.method === "password"), auths)
  }

  // ===== Enumeration-safe email endpoints + per-email send limit ===============================
  {
    const n = email("ghost")
    const f = await post("/api/auth/password/forgot", { email: n })
    const m = await post("/api/auth/magic-link", { email: n })
    const vr = await post("/api/auth/verify-email/request", { email: n })
    check("C1 forgot/magic-link/verify-request for an unknown email → 200 ok", [f, m, vr].every((x) => x.status === 200 && x.json.ok === true), [f, m, vr].map(sum))
    check("C2 no email is queued for an unknown address", (await outbox(n)).length === 0)
    const f2 = await post("/api/auth/password/forgot", { email: n })
    const f3 = await post("/api/auth/password/forgot", { email: n })
    const f4 = await post("/api/auth/password/forgot", { email: n })
    check("C3 4th reset request for one email within an hour → 429 (same for unknown emails)", f2.status === 200 && f3.status === 200 && f4.status === 429 && f4.headers.get("retry-after"), [f2, f3, f4].map(sum))
    const badEmail = await post("/api/auth/password/forgot", { email: "nope" })
    check("C4 forgot with a malformed email → 400", badEmail.status === 400, sum(badEmail))
  }

  // ===== Password change =======================================================================
  {
    const anon = await post("/api/auth/password/change?as=shopper", { currentPassword: PW, newPassword: PW2 })
    check("D1 password change without a session → 401", anon.status === 401, sum(anon))
    const asAdmin = await post("/api/auth/password/change?as=admin", { currentPassword: PW, newPassword: PW2 }, { jar: S.jar })
    check("D2 password change as=admin → 400 (not allowed)", asAdmin.status === 400, sum(asAdmin))
    const noCur = await post("/api/auth/password/change?as=shopper", { newPassword: PW2 }, { jar: S.jar })
    check("D3 change without the current password → 400 fields.currentPassword", noCur.status === 400 && fields(noCur).currentPassword, sum(noCur))
    const wrongCur = await post("/api/auth/password/change?as=shopper", { currentPassword: "Not-the-password-1", newPassword: PW2 }, { jar: S.jar })
    check("D4 change with a wrong current password → 400 fields.currentPassword", wrongCur.status === 400 && fields(wrongCur).currentPassword, sum(wrongCur))
    const weak = await post("/api/auth/password/change?as=shopper", { currentPassword: PW, newPassword: "qwertyuiop" }, { jar: S.jar })
    check("D5 change to a guessable password → 400 fields.newPassword", weak.status === 400 && fields(weak).newPassword, sum(weak))
    const ok = await post("/api/auth/password/change?as=shopper", { currentPassword: PW, newPassword: PW2 }, { jar: S.jar })
    check("D6 password change → ok", ok.status === 200 && ok.json.ok === true, sum(ok))
    check("D7 this session stays signed in", (await session(S.jar)).shopper?.id === S.userId)
    check("D8 the account's other session is ended", (await session(S.jar2)).shopper == null)
    const old = await post("/api/auth/sign-in", { email: S.email, password: PW })
    check("D9 old password no longer signs in", old.status === 401, sum(old))
    const nw = await post("/api/auth/sign-in", { email: S.email, password: PW2 }, { jar: S.jar2 })
    check("D10 new password signs in", nw.status === 200 && nw.json.status === "signed_in", sum(nw))
    check("D11 password_changed email queued", (await outbox(S.email)).some((m) => m.template === "password_changed"))
  }

  // ===== Password reset ========================================================================
  {
    const f = await post("/api/auth/password/forgot", { email: S.email })
    const tok = await latestToken(S.email, "reset")
    check("E1 forgot → ok + reset email with /auth/reset link", f.status === 200 && !!tok, sum(f))
    const weak = await post("/api/auth/password/reset", { token: tok, password: "password123" })
    check("E2 reset to a guessable password → 400 fields.password", weak.status === 400 && fields(weak).password, sum(weak))
    const ok = await post("/api/auth/password/reset", { token: tok, password: PW3 })
    check("E3 the same link still works after a refused password (no burn on 400) → ok", ok.status === 200 && ok.json.ok === true, sum(ok))
    check("E4 reset ends every session of the account", (await session(S.jar)).shopper == null && (await session(S.jar2)).shopper == null)
    const reuse = await post("/api/auth/password/reset", { token: tok, password: PW2 })
    check("E5 reset link is single-use", reuse.status === 400, sum(reuse))
    const si = await post("/api/auth/sign-in", { email: S.email, password: PW3 }, { jar: S.jar })
    check("E6 the new password signs in", si.status === 200 && si.json.status === "signed_in", sum(si))
    await post("/api/auth/password/forgot", { email: S.email })
    const t2 = await latestToken(S.email, "reset")
    const exp = await dev({ op: "expire-tokens", email: S.email, purpose: "reset_password" })
    const late = await post("/api/auth/password/reset", { token: t2, password: PW2 })
    check("E7 an expired reset link → 400", exp.json?.expired >= 1 && late.status === 400, sum(late))
  }

  // ===== Lockout ===============================================================================
  {
    const L = await signUpAndVerify("lock")
    check("F0 lockout account signed up and verified", L.ok, L.v ? sum(L.v) : sum(L.r))
    cleanup.shoppers.push({ email: L.email, password: PW })
    const statuses = []
    for (let i = 0; i < 10; i++) statuses.push((await post("/api/auth/sign-in", { email: L.email, password: `Wrong-password-${i}x` })).status)
    check("F1 ten wrong passwords → 401 each", statuses.every((s) => s === 401), statuses)
    const ins = await inspect(L.email)
    check("F2 the account is locked (locked_until in the future)", ins?.credentials?.lockedUntil && new Date(ins.credentials.lockedUntil).getTime() > Date.now(), ins?.credentials)
    const right = await post("/api/auth/sign-in", { email: L.email, password: PW })
    check("F3 the right password while locked → 429 with Retry-After", right.status === 429 && right.headers.get("retry-after"), sum(right))
    await post("/api/auth/password/forgot", { email: L.email })
    const tok = await latestToken(L.email, "reset")
    const rs = await post("/api/auth/password/reset", { token: tok, password: PW2 })
    const ins2 = await inspect(L.email)
    check("F4 a password reset clears the lockout", rs.status === 200 && !ins2?.credentials?.lockedUntil && ins2?.credentials?.failedCount === 0, ins2?.credentials)
    const after = await post("/api/auth/sign-in", { email: L.email, password: PW2 }, { jar: L.jar })
    check("F5 after a reset the new password signs in at once (not still rate-limited)", after.status === 200 && after.json.status === "signed_in", sum(after))
    cleanup.shoppers[cleanup.shoppers.length - 1].password = PW2
  }

  // ===== Magic link ============================================================================
  {
    const r = await post("/api/auth/magic-link", { email: S.email })
    const tok = await latestToken(S.email, "magic_link")
    check("G1 magic-link → ok + email with /auth/magic link", r.status === 200 && !!tok, sum(r))
    const jarA = new Jar("mA")
    const jarB = new Jar("mB")
    const [a, b] = await Promise.all([post("/api/auth/magic-link/consume", { token: tok }, { jar: jarA }), post("/api/auth/magic-link/consume", { token: tok }, { jar: jarB })])
    const wins = [a, b].filter((x) => x.status === 200)
    check("G2 two parallel consumes of one link → exactly one session", wins.length === 1 && [a, b].some((x) => x.status === 400), [a, b].map(sum))
    const winner = a.status === 200 ? jarA : jarB
    check("G3 magic-link session is a real shopper session (method magic_link)", (await session(winner)).shopper?.id === S.userId && ((await inspect(S.email))?.sessionAuth ?? []).some((x) => x.method === "magic_link"))
    const reuse = await post("/api/auth/magic-link/consume", { token: tok })
    check("G4 magic link is single-use", reuse.status === 400, sum(reuse))
  }

  // ===== Demo sign-in still works, and only opens demo accounts ================================
  const demoShop = new Jar("demoShop")
  const demoAdmin = new Jar("demoAdmin")
  {
    const d1 = await post("/api/auth/demo", { actor: "shopper", account: "u_ada" }, { jar: demoShop })
    check("H1 demo shopper sign-in (u_ada) still works", d1.status === 200 && d1.json.profile?.id === "u_ada" && (await session(demoShop)).shopper?.id === "u_ada", sum(d1))
    const d2 = await post("/api/auth/demo", { actor: "shopper", account: S.userId ?? "u_missing" })
    check("H2 demo sign-in to a REAL account → 404", d2.status === 404, sum(d2))
    const d3 = await post("/api/auth/demo", { actor: "admin", account: "adm_1" }, { jar: demoAdmin })
    check("H3 demo admin sign-in (adm_1) still works, no TOTP", d3.status === 200 && (await session(demoAdmin)).admin?.id === "adm_1", sum(d3))
    const sec = await get("/api/auth/security?as=admin", { jar: demoAdmin })
    check("H4 demo admin security: method demo, demo true", sec.status === 200 && sec.json.method === "demo" && sec.json.demo === true, sum(sec))
    const dsi = await post("/api/auth/sign-in", { email: d1.json?.profile?.email ?? "ada@example.com", password: PW })
    check("H5 password sign-in never opens a demo account → 401", dsi.status === 401, sum(dsi))

    // requireRecentReauth with demo sessions (development: an explicit demo confirm passes it)
    const del0 = await post("/api/auth/account/delete", { confirm: "DELETE" }, { jar: demoShop })
    check("H6 demo shopper delete without re-auth → 403 fields.reauth=required", del0.status === 403 && fields(del0).reauth === "required", sum(del0))
    const rpw = await post("/api/auth/reauth?as=shopper", { password: PW }, { jar: demoShop })
    check("H7 demo session re-auth with a password → 422 (demo confirm only)", rpw.status === 422, sum(rpw))
    const rd = await post("/api/auth/reauth?as=shopper", { demo: true }, { jar: demoShop })
    check("H8 demo session re-auth {demo:true} in development → ok method demo", rd.status === 200 && rd.json.method === "demo", sum(rd))
    const del1 = await post("/api/auth/account/delete", { confirm: "DELETE" }, { jar: demoShop })
    check("H9 demo account deletion → 422 (demo accounts can't be deleted)", del1.status === 422, sum(del1))
    check("H10 demo shopper still signed in after the refused delete", (await session(demoShop)).shopper?.id === "u_ada")

    const mk0 = await post("/api/auth/admins", { email: email("nope"), name: "Nope", role: "support" }, { jar: demoAdmin })
    check("H11 demo admin create-admin without re-auth → 403 reauth required", mk0.status === 403 && fields(mk0).reauth === "required", sum(mk0))
    await post("/api/auth/reauth?as=admin", { demo: true }, { jar: demoAdmin })
    const mk1 = await post("/api/auth/admins", { email: email("nope"), name: "Nope", role: "support" }, { jar: demoAdmin })
    check("H12 demo admin can't create real admins → 422", mk1.status === 422, sum(mk1))
    const rc = await post("/api/auth/mfa/recovery-codes", undefined, { jar: demoAdmin })
    check("H13 demo admin recovery codes → 409 (no TOTP set up)", rc.status === 409, sum(rc))
    await post("/api/auth/sign-out?actor=admin", undefined, { jar: demoAdmin })
    check("H14 sign-out ends the demo admin session", (await session(demoAdmin)).admin == null)
    const so = await post("/api/auth/sign-out?actor=shopper", undefined, { jar: demoShop })
    check("H15 sign-out (shopper) → ok and cookie cleared", so.status === 200 && (await session(demoShop)).shopper == null && !demoShop.has("yard_s"), sum(so))
    const soBad = await post("/api/auth/sign-out?actor=root", undefined)
    check("H16 sign-out with a bad actor → 400", soBad.status === 400, sum(soBad))
  }

  // ===== Admin TOTP ============================================================================
  const A1 = { email: email("own"), jar: new Jar("A1") }
  const A2 = { email: email("sup"), jar: new Jar("A2") }
  {
    const bad = await dev({ op: "bootstrap-admin", email: "someone@example.com", name: "X", role: "owner" })
    check("I0 dev helper refuses untagged emails", bad.status === 400, sum(bad))
    const b = await dev({ op: "bootstrap-admin", email: A1.email, name: "Kit Owner", role: "owner" })
    check("I1 bootstrap a real owner admin (createAdminAccount(null))", b.status === 200 && b.json.admin?.id, sum(b))
    A1.userId = b.json?.admin?.id
    cleanup.admins.push(A1.email)
    const tok = await latestToken(A1.email, "reset")
    const noPw = await post("/api/auth/sign-in", { email: A1.email, password: PW, actor: "admin" })
    check("I2 admin without a password yet → 401", noPw.status === 401, sum(noPw))
    const rs = await post("/api/auth/password/reset", { token: tok, password: PW })
    check("I3 admin sets a password from the 72 h onboarding link", rs.status === 200, sum(rs))
    const demoTry = await post("/api/auth/demo", { actor: "admin", account: A1.userId ?? "x" })
    check("I4 demo sign-in to a real admin → 404", demoTry.status === 404, sum(demoTry))
    const asShop = await post("/api/auth/sign-in", { email: A1.email, password: PW, actor: "shopper" })
    check("I5 admin account signing in as shopper → 403", asShop.status === 403, sum(asShop))

    const si = await post("/api/auth/sign-in", { email: A1.email, password: PW, actor: "admin" }, { jar: A1.jar })
    check("I6 admin password sign-in → mfa_enrol_required + challenge, no cookie", si.status === 200 && si.json.status === "mfa_enrol_required" && si.json.challenge && !A1.jar.has("yard_a"), sum(si))
    const ch = si.json?.challenge
    const vWrongStage = await post("/api/auth/mfa/verify", { challenge: ch, code: "123456" })
    check("I7 mfa/verify with an enrol challenge → 409", vWrongStage.status === 409, sum(vWrongStage))
    const enBad = await post("/api/auth/mfa/enrol", { challenge: randomBytes(32).toString("base64url") })
    check("I8 mfa/enrol with an unknown challenge → 400", enBad.status === 400, sum(enBad))
    const en = await post("/api/auth/mfa/enrol", { challenge: ch })
    check("I9 mfa/enrol → secret + otpauth URL", en.status === 200 && /^[A-Z2-7]{32}$/.test(en.json.secret ?? "") && String(en.json.otpauthUrl).startsWith("otpauth://totp/"), sum(en))
    A1.secret = en.json?.secret
    const cWrong = await post("/api/auth/mfa/enrol/confirm", { challenge: ch, code: hotp(A1.secret, stepNow() + 5) })
    check("I10 enrol confirm with a wrong code → 400 fields.code", cWrong.status === 400 && fields(cWrong).code, sum(cWrong))
    const cBad = await post("/api/auth/mfa/enrol/confirm", { challenge: ch, code: "12ab56" })
    check("I11 enrol confirm with a non-numeric code → 400 validation", cBad.status === 400 && code(cBad) === "validation", sum(cBad))
    const conf = await post("/api/auth/mfa/enrol/confirm", { challenge: ch, code: await freshCode(A1) }, { jar: A1.jar })
    check("I12 enrol confirm → admin session + 10 recovery codes", conf.status === 200 && conf.json.status === "signed_in" && conf.json.recoveryCodes?.length === 10 && A1.jar.has("yard_a"), sum(conf))
    A1.recovery = conf.json?.recoveryCodes ?? []
    const me = await session(A1.jar)
    check("I13 /api/session shows the real owner admin", me.admin?.id === A1.userId && me.admin?.demo === false && me.admin?.role === "owner", me)
    const sec = await get("/api/auth/security?as=admin", { jar: A1.jar })
    check("I14 security: mfa enrolled, 10 recovery codes left", sec.status === 200 && sec.json.mfa?.enrolled === true && sec.json.mfa?.recoveryCodesLeft === 10 && sec.json.method === "password", sum(sec))
    const reuseCh = await post("/api/auth/mfa/enrol", { challenge: ch })
    check("I15 the redeemed challenge can't be used again → 400", reuseCh.status === 400, sum(reuseCh))
    const authRow = ((await inspect(A1.email))?.sessionAuth ?? []).find((x) => x.mfaAt)
    check("I16 admin session_auth has mfa_at", !!authRow, (await inspect(A1.email))?.sessionAuth)

    // Owner creates a second (support) admin
    const mk = await post("/api/auth/admins", { email: A2.email, name: "Kit Support", role: "support" }, { jar: A1.jar })
    check("I17 owner creates a real support admin → 201", mk.status === 201 && mk.json.admin?.id, sum(mk))
    A2.userId = mk.json?.admin?.id
    if (A2.userId) cleanup.admins.push(A2.email)
    const dup = await post("/api/auth/admins", { email: A2.email, name: "Kit Support", role: "support" }, { jar: A1.jar })
    check("I18 creating an admin with an existing email → 400 fields.email", dup.status === 400 && fields(dup).email, sum(dup))
    const badRole = await post("/api/auth/admins", { email: email("x"), name: "X", role: "god" }, { jar: A1.jar })
    check("I19 create admin with a bad role → 400", badRole.status === 400, sum(badRole))
    const anonMk = await post("/api/auth/admins", { email: email("x"), name: "X", role: "support" })
    check("I20 create admin without a session → 401", anonMk.status === 401, sum(anonMk))

    // Recovery codes + re-auth window
    const rc = await post("/api/auth/mfa/recovery-codes", undefined, { jar: A1.jar })
    check("I21 regenerate recovery codes right after sign-in (fresh re-auth) → 10 new codes", rc.status === 200 && rc.json.recoveryCodes?.length === 10 && rc.json.recoveryCodes[0] !== A1.recovery[0], sum(rc))
    const oldCodes = A1.recovery
    A1.recovery = rc.json?.recoveryCodes ?? []
    await dev({ op: "age-reauth", email: A1.email, seconds: 400 })
    const rcOld = await post("/api/auth/mfa/recovery-codes", undefined, { jar: A1.jar })
    check("I22 re-auth older than 5 min → 403 fields.reauth=required", rcOld.status === 403 && fields(rcOld).reauth === "required", sum(rcOld))
    const raPw = await post("/api/auth/reauth?as=admin", { password: PW }, { jar: A1.jar })
    check("I23 admin re-auth with a password → 400 (TOTP required)", raPw.status === 400 && fields(raPw).code, sum(raPw))
    const raWrong = await post("/api/auth/reauth?as=admin", { code: hotp(A1.secret, stepNow() + 7) }, { jar: A1.jar })
    check("I24 admin re-auth with a wrong code → 400", raWrong.status === 400, sum(raWrong))
    const c = await freshCode(A1)
    const ra = await post("/api/auth/reauth?as=admin", { code: c }, { jar: A1.jar })
    check("I25 admin re-auth with a TOTP code → ok", ra.status === 200 && ra.json.method === "totp", sum(ra))
    const replay = await post("/api/auth/reauth?as=admin", { code: c }, { jar: A1.jar })
    check("I26 the same TOTP code can't be replayed → 400", replay.status === 400, sum(replay))
    const raOldRc = await post("/api/auth/reauth?as=admin", { recoveryCode: oldCodes[0] }, { jar: A1.jar })
    check("I27 a replaced recovery code is invalid → 400", raOldRc.status === 400, sum(raOldRc))
    const raRc = await post("/api/auth/reauth?as=admin", { recoveryCode: A1.recovery[0] }, { jar: A1.jar })
    check("I28 admin re-auth with a recovery code → ok (method recovery)", raRc.status === 200 && raRc.json.method === "recovery", sum(raRc))
    const raRc2 = await post("/api/auth/reauth?as=admin", { recoveryCode: A1.recovery[0] }, { jar: A1.jar })
    check("I29 recovery codes are single-use → 400", raRc2.status === 400, sum(raRc2))
    const sec2 = await get("/api/auth/security?as=admin", { jar: A1.jar })
    check("I30 recovery codes left = 9", sec2.json?.mfa?.recoveryCodesLeft === 9, sum(sec2))

    // Sign-out, sign in again: mfa_required, recovery-code sign-in
    await post("/api/auth/sign-out?actor=admin", undefined, { jar: A1.jar })
    check("I31 sign-out ends the real admin session", (await session(A1.jar)).admin == null)
    const si2 = await post("/api/auth/sign-in", { email: A1.email, password: PW, actor: "admin" })
    check("I32 enrolled admin sign-in → mfa_required", si2.status === 200 && si2.json.status === "mfa_required" && si2.json.challenge, sum(si2))
    const enAgain = await post("/api/auth/mfa/enrol", { challenge: si2.json?.challenge })
    check("I33 mfa/enrol with a verify challenge → 409", enAgain.status === 409, sum(enAgain))
    const both = await post("/api/auth/mfa/verify", { challenge: si2.json?.challenge, code: "123456", recoveryCode: A1.recovery[1] })
    check("I34 mfa/verify with both a code and a recovery code → 400", both.status === 400, sum(both))
    const vr = await post("/api/auth/mfa/verify", { challenge: si2.json?.challenge, recoveryCode: A1.recovery[1].toUpperCase() }, { jar: A1.jar })
    check("I35 mfa/verify with a recovery code (any case) → admin session, 8 left", vr.status === 200 && vr.json.status === "signed_in" && vr.json.recoveryCodesLeft === 8 && (await session(A1.jar)).admin?.id === A1.userId, sum(vr))

    // A2: onboarding, enrol, five wrong codes kill a challenge
    const t2 = await latestToken(A2.email, "reset")
    check("I36 new admin got a set-password email", !!t2)
    await post("/api/auth/password/reset", { token: t2, password: PW })
    const s2 = await post("/api/auth/sign-in", { email: A2.email, password: PW, actor: "admin" })
    const en2 = await post("/api/auth/mfa/enrol", { challenge: s2.json?.challenge })
    A2.secret = en2.json?.secret
    const cf2 = A2.secret ? await post("/api/auth/mfa/enrol/confirm", { challenge: s2.json?.challenge, code: await freshCode(A2) }, { jar: A2.jar }) : en2
    check("I37 second admin enrols and signs in", cf2.status === 200 && (await session(A2.jar)).admin?.id === A2.userId, sum(cf2))
    await post("/api/auth/sign-out?actor=admin", undefined, { jar: A2.jar })
    const s3 = await post("/api/auth/sign-in", { email: A2.email, password: PW, actor: "admin" })
    const wrongs = []
    for (let i = 0; i < 5; i++) wrongs.push((await post("/api/auth/mfa/verify", { challenge: s3.json?.challenge, code: hotp(A2.secret, stepNow() + 9 + i) })).status)
    const dead = await post("/api/auth/mfa/verify", { challenge: s3.json?.challenge, code: await freshCode(A2) })
    check("I38 five wrong codes end the challenge (the right code is then refused)", wrongs.every((s) => s === 400) && dead.status === 400, { wrongs, dead: sum(dead) })
    const s4 = await post("/api/auth/sign-in", { email: A2.email, password: PW, actor: "admin" })
    const v4 = await post("/api/auth/mfa/verify", { challenge: s4.json?.challenge, code: await freshCode(A2) }, { jar: A2.jar })
    check("I39 a new challenge with a fresh TOTP code → admin session", v4.status === 200 && (await session(A2.jar)).admin?.id === A2.userId, sum(v4))
    const a2mk = await post("/api/auth/admins", { email: email("x2"), name: "X", role: "support" }, { jar: A2.jar })
    check("I40 non-owner admin can't create admins → 403", a2mk.status === 403 && !fields(a2mk).reauth, sum(a2mk))
    const a2reset = await post("/api/auth/mfa/reset", { userId: A1.userId, reason: "kit check" }, { jar: A2.jar })
    check("I41 non-owner admin can't reset another admin's TOTP → 403", a2reset.status === 403, sum(a2reset))

    // Owner resets A2's TOTP
    const selfReset = await post("/api/auth/mfa/reset", { userId: A1.userId, reason: "kit check" }, { jar: A1.jar })
    check("I42 owner can't reset their own TOTP → 422", selfReset.status === 422, sum(selfReset))
    const noReason = await post("/api/auth/mfa/reset", { userId: A2.userId }, { jar: A1.jar })
    check("I43 mfa/reset without a reason → 400", noReason.status === 400, sum(noReason))
    const ghost = await post("/api/auth/mfa/reset", { userId: "u_not_an_admin", reason: "kit check" }, { jar: A1.jar })
    check("I44 mfa/reset of a non-admin → 404", ghost.status === 404, sum(ghost))
    const reset = await post("/api/auth/mfa/reset", { userId: A2.userId, reason: "kit check: lost phone" }, { jar: A1.jar })
    check("I45 owner resets another admin's TOTP → ok", reset.status === 200 && reset.json.ok === true, sum(reset))
    check("I46 the reset admin's sessions are ended", (await session(A2.jar)).admin == null)
    const s5 = await post("/api/auth/sign-in", { email: A2.email, password: PW, actor: "admin" })
    check("I47 after a reset, sign-in asks to enrol again", s5.status === 200 && s5.json.status === "mfa_enrol_required", sum(s5))
  }

  // ===== Brand invites =========================================================================
  const T = new Jar("tobi") // owner, b_lagos_static
  const K = new Jar("kemi") // fulfilment, b_lagos_static
  const M = new Jar("minji") // owner, b_null_form
  const V = new Jar("viewer") // viewer, b_lagos_static
  {
    const signs = await Promise.all([
      post("/api/auth/demo", { actor: "brand", account: "u_b_tobi", brandId: "b_lagos_static" }, { jar: T }),
      post("/api/auth/demo", { actor: "brand", account: "u_b_kemi", brandId: "b_lagos_static" }, { jar: K }),
      post("/api/auth/demo", { actor: "brand", account: "u_b_minji", brandId: "b_null_form" }, { jar: M }),
      post("/api/auth/demo", { actor: "brand", account: "u_b_viewer", brandId: "b_lagos_static" }, { jar: V }),
    ])
    check("J0 demo brand sign-ins (owner, fulfilment, other-brand owner, viewer)", signs.every((s) => s.status === 200), signs.map(sum))
    const anon = await get("/api/auth/invites")
    check("J1 list invites without a brand session → 401", anon.status === 401, sum(anon))
    const kList = await get("/api/auth/invites", { jar: K })
    check("J2 any member can list invites", kList.status === 200 && Array.isArray(kList.json.invites), sum(kList))
    const kMk = await post("/api/auth/invites", { email: email("inv_k"), role: "viewer" }, { jar: K })
    check("J3 fulfilment member can't invite → 403", kMk.status === 403, sum(kMk))
    const vMk = await post("/api/auth/invites", { email: email("inv_v"), role: "viewer" }, { jar: V })
    check("J4 viewer can't invite → 403", vMk.status === 403, sum(vMk))
    const badRole = await post("/api/auth/invites", { email: email("inv_x"), role: "emperor" }, { jar: T })
    check("J5 invite with a bad role → 400", badRole.status === 400, sum(badRole))
    const badEmail = await post("/api/auth/invites", { email: "nope", role: "viewer" }, { jar: T })
    check("J6 invite with a bad email → 400", badEmail.status === 400, sum(badEmail))
    // Existing member
    const kemiShop = new Jar("kemiShop")
    const ks = await post("/api/auth/demo", { actor: "shopper", account: "u_b_kemi" }, { jar: kemiShop })
    if (ks.status === 200 && ks.json.profile?.email) {
      const mem = await post("/api/auth/invites", { email: ks.json.profile.email, role: "viewer" }, { jar: T })
      check("J7 inviting someone already on the team → 400 fields.email", mem.status === 400 && fields(mem).email, sum(mem))
    } else check("J7 inviting someone already on the team → 400 fields.email", false, sum(ks))

    // New person invited as brand admin
    const I1 = { email: email("badm"), jar: new Jar("I1") }
    const inv = await post("/api/auth/invites", { email: I1.email, role: "admin" }, { jar: T })
    check("J8 owner invites a brand admin → 201", inv.status === 201 && inv.json.invite?.status === "pending" && inv.json.invite.role === "admin", sum(inv))
    const dup = await post("/api/auth/invites", { email: I1.email.toUpperCase(), role: "viewer" }, { jar: T })
    check("J9 a second pending invite for the same email → 409", dup.status === 409, sum(dup))
    const tok = await latestToken(I1.email, "team_invite")
    check("J10 team_invite email queued with a /auth/invite link", !!tok)
    const pv = await post("/api/auth/invites/preview", { token: tok })
    check("J11 preview: brand, role, masked email, hasAccount false", pv.status === 200 && pv.json.brand?.name && pv.json.role === "admin" && !pv.json.email.includes(TAG) && pv.json.hasAccount === false, sum(pv))
    const pvBad = await post("/api/auth/invites/preview", { token: randomBytes(32).toString("base64url") })
    check("J12 preview of an unknown token → 404", pvBad.status === 404, sum(pvBad))
    const noName = await post("/api/auth/invites/accept", { token: tok })
    check("J13 accept without name/password for a new person → 400", noName.status === 400, sum(noName))
    const weak = await post("/api/auth/invites/accept", { token: tok, name: "Kit Brand Admin", password: "1234567890" })
    check("J14 accept with a guessable password → 400 fields.password", weak.status === 400 && fields(weak).password, sum(weak))
    const mList = await get("/api/auth/invites", { jar: M })
    check("J15 another brand's owner doesn't see this invite", mList.status === 200 && !mList.json.invites.some((x) => x.id === inv.json?.invite?.id), sum(mList))
    const mDel = await del(`/api/auth/invites/${inv.json?.invite?.id}`, { jar: M })
    check("J16 another brand's owner revoking it → 404", mDel.status === 404, sum(mDel))
    const acc = await post("/api/auth/invites/accept", { token: tok, name: "Kit Brand Admin", password: PW }, { jar: I1.jar })
    check("J17 accept → brand session on the inviting brand with role admin", acc.status === 200 && acc.json.actor === "brand" && acc.json.profile?.role === "admin" && acc.json.profile?.brand?.id === "b_lagos_static" && I1.jar.has("yard_b"), sum(acc))
    const accAgain = await post("/api/auth/invites/accept", { token: tok, name: "Kit Brand Admin", password: PW })
    check("J18 accepted invite is single-use → 404", accAgain.status === 404, sum(accAgain))
    const ins = await inspect(I1.email)
    check("J19 invitee account: brand_staff, verified, active admin membership", ins?.user?.kind === "brand_staff" && !!ins.credentials?.emailVerifiedAt && ins.brandMembers?.some((m) => m.brandId === "b_lagos_static" && m.role === "admin" && m.status === "active"), ins)
    cleanup.shoppers.push({ email: I1.email, password: PW })
    const tList = await get("/api/auth/invites", { jar: T })
    check("J20 owner's list shows the invite as accepted", tList.json?.invites?.find((x) => x.id === inv.json?.invite?.id)?.status === "accepted", sum(tList))
    const revAcc = await del(`/api/auth/invites/${inv.json?.invite?.id}`, { jar: T })
    check("J21 revoking an accepted invite → 409", revAcc.status === 409, sum(revAcc))

    // Brand admin's role rules
    const bsi = await post("/api/auth/sign-in", { email: I1.email, password: PW, actor: "brand" }, { jar: I1.jar })
    check("J22 brand admin password sign-in (actor brand) → signed_in", bsi.status === 200 && bsi.json.status === "signed_in" && bsi.json.profile?.role === "admin", sum(bsi))
    const otherBrand = await post("/api/auth/sign-in", { email: I1.email, password: PW, actor: "brand", brandId: "b_null_form" })
    check("J23 brand sign-in for a brand you're not in → 400 fields.brandId", otherBrand.status === 400 && fields(otherBrand).brandId, sum(otherBrand))
    const aOwner = await post("/api/auth/invites", { email: email("inv_o"), role: "owner" }, { jar: I1.jar })
    const aAdmin = await post("/api/auth/invites", { email: email("inv_a"), role: "admin" }, { jar: I1.jar })
    check("J24 brand admin can't invite owners or admins → 403", aOwner.status === 403 && aAdmin.status === 403, [aOwner, aAdmin].map(sum))
    const aDes = await post("/api/auth/invites", { email: email("inv_d"), role: "designer" }, { jar: I1.jar })
    check("J25 brand admin can invite a designer → 201", aDes.status === 201, sum(aDes))
    const dTok = await latestToken(email("inv_d"), "team_invite")
    const rev = await del(`/api/auth/invites/${aDes.json?.invite?.id}`, { jar: I1.jar })
    check("J26 brand admin revokes the designer invite → revoked", rev.status === 200 && rev.json.invite?.status === "revoked", sum(rev))
    const rev2 = await del(`/api/auth/invites/${aDes.json?.invite?.id}`, { jar: I1.jar })
    check("J27 revoking twice → 409", rev2.status === 409, sum(rev2))
    const pvRev = await post("/api/auth/invites/preview", { token: dTok })
    const acRev = await post("/api/auth/invites/accept", { token: dTok, name: "X Y", password: PW })
    check("J28 a revoked invite can't be previewed or accepted → 404", pvRev.status === 404 && acRev.status === 404, [pvRev, acRev].map(sum))
    const oInv = await post("/api/auth/invites", { email: email("inv_o2"), role: "owner" }, { jar: T })
    const aRevOwner = await del(`/api/auth/invites/${oInv.json?.invite?.id}`, { jar: I1.jar })
    check("J29 brand admin can't revoke an owner invite → 403", oInv.status === 201 && aRevOwner.status === 403, [oInv, aRevOwner].map(sum))
    const kRev = await del(`/api/auth/invites/${oInv.json?.invite?.id}`, { jar: K })
    check("J30 fulfilment member can't revoke → 403", kRev.status === 403, sum(kRev))
    const tRev = await del(`/api/auth/invites/${oInv.json?.invite?.id}`, { jar: T })
    check("J31 owner revokes the owner invite", tRev.status === 200 && tRev.json.invite?.status === "revoked", sum(tRev))
    const reinv = await post("/api/auth/invites", { email: email("inv_o2"), role: "viewer" }, { jar: T })
    check("J32 after a revoke the same email can be invited again", reinv.status === 201, sum(reinv))
    if (reinv.json?.invite?.id) await del(`/api/auth/invites/${reinv.json.invite.id}`, { jar: T })

    // Brand-side session features: identities, re-auth, password change
    const ids = await get("/api/auth/identities?as=brand", { jar: I1.jar })
    check("J33a identities (brand): none linked, providers off", ids.status === 200 && Array.isArray(ids.json.identities) && ids.json.identities.length === 0 && ids.json.providers?.google === false, sum(ids))
    const unl = await del("/api/auth/identities/oid_nope?as=brand", { jar: I1.jar })
    check("J33b unlink an unknown identity → 404", unl.status === 404, sum(unl))
    const idsAnon = await get("/api/auth/identities?as=shopper")
    check("J33c identities without a session → 401", idsAnon.status === 401, sum(idsAnon))
    const bra = await post("/api/auth/reauth?as=brand", { password: PW }, { jar: I1.jar })
    check("J33d brand re-auth with the password → ok", bra.status === 200 && bra.json.method === "password", sum(bra))
    const bpc = await post("/api/auth/password/change?as=brand", { currentPassword: PW, newPassword: PW2 }, { jar: I1.jar })
    check("J33e brand password change → ok, brand session kept", bpc.status === 200 && (await session(I1.jar)).brand?.userId === ins?.user?.id, sum(bpc))
    cleanup.shoppers[cleanup.shoppers.length - 1].password = PW2

    // Brand switch
    const sw = await post("/api/auth/brand/switch", { brandId: "b_null_form" }, { jar: I1.jar })
    check("J33 switch to a brand you're not in → 400", sw.status === 400, sum(sw))
    const swOk = await post("/api/auth/brand/switch", { brandId: "b_lagos_static" }, { jar: I1.jar })
    check("J34 switch to your own brand → ok (token rotates, still signed in)", swOk.status === 200 && (await session(I1.jar)).brand?.brand?.id === "b_lagos_static", sum(swOk))

    // Invite to an existing real shopper (S)
    const sInv = await post("/api/auth/invites", { email: S.email, role: "viewer" }, { jar: T })
    const sTok = await latestToken(S.email, "team_invite")
    const sPv = await post("/api/auth/invites/preview", { token: sTok })
    check("J35 invite to an existing account: preview says hasAccount", sInv.status === 201 && sPv.status === 200 && sPv.json.hasAccount === true, [sInv, sPv].map(sum))
    const sAnon = await post("/api/auth/invites/accept", { token: sTok, name: "Hijack", password: PW })
    check("J36 accepting it without signing in (or by creating an account) → 401", sAnon.status === 401, sum(sAnon))
    const sOther = await post("/api/auth/invites/accept", { token: sTok }, { jar: (await (async () => { const j = new Jar("L2"); await post("/api/auth/sign-in", { email: email("lock"), password: PW2 }, { jar: j }); return j })()) })
    check("J37 accepting it signed in as a different account → 401", sOther.status === 401, sum(sOther))
    const sJar = new Jar("S3")
    await post("/api/auth/sign-in", { email: S.email, password: PW3 }, { jar: sJar })
    const sAcc = await post("/api/auth/invites/accept", { token: sTok }, { jar: sJar })
    check("J38 accepting it signed in as the invited shopper → brand session (viewer)", sAcc.status === 200 && sAcc.json.profile?.role === "viewer" && sJar.has("yard_b"), sum(sAcc))

    for (const j of [T, K, M, V]) await post("/api/auth/sign-out?actor=brand", undefined, { jar: j })
    await post("/api/auth/sign-out?actor=shopper", undefined, { jar: kemiShop })
  }

  // ===== Reauth + account deletion + erasure ===================================================
  {
    const D = await signUpAndVerify("del", "Kit Deleter")
    check("K0 deletion account signed up and verified", D.ok, D.v ? sum(D.v) : sum(D.r))
    const st0 = await get("/api/auth/account/delete", { jar: D.jar })
    check("K1 deletion status → none", st0.status === 200 && st0.json.deletion === null, sum(st0))
    const anon = await post("/api/auth/account/delete", { confirm: "DELETE" })
    check("K2 delete without a session → 401", anon.status === 401, sum(anon))
    const noConfirm = await post("/api/auth/account/delete", { confirm: "yes" }, { jar: D.jar })
    check("K3 delete without typing DELETE → 400", noConfirm.status === 400, sum(noConfirm))
    await dev({ op: "age-reauth", email: D.email, seconds: 700 })
    const stale = await post("/api/auth/account/delete", { confirm: "DELETE" }, { jar: D.jar })
    check("K4 delete with a re-auth older than 10 min → 403 fields.reauth=required", stale.status === 403 && fields(stale).reauth === "required", sum(stale))
    const rNo = await post("/api/auth/reauth?as=shopper", {}, { jar: D.jar })
    check("K5 re-auth with no password → 400", rNo.status === 400 && fields(rNo).password, sum(rNo))
    const rDemo = await post("/api/auth/reauth?as=shopper", { demo: true }, { jar: D.jar })
    check("K6 real session can't use the demo confirm → 400", rDemo.status === 400, sum(rDemo))
    const rWrong = await post("/api/auth/reauth?as=shopper", { password: "Wrong-password-xx" }, { jar: D.jar })
    check("K7 re-auth with a wrong password → 400", rWrong.status === 400, sum(rWrong))
    const rAnon = await post("/api/auth/reauth?as=shopper", { password: PW })
    check("K8 re-auth without a session → 401", rAnon.status === 401, sum(rAnon))
    const rOk = await post("/api/auth/reauth?as=shopper", { password: PW }, { jar: D.jar })
    check("K9 re-auth with the password → ok", rOk.status === 200 && rOk.json.method === "password", sum(rOk))
    const sec = await get("/api/auth/security?as=shopper", { jar: D.jar })
    check("K10 security reauthAgeSec is fresh after re-auth", sec.json?.reauthAgeSec !== null && sec.json.reauthAgeSec < 30, sum(sec))
    const other = new Jar("D2")
    await post("/api/auth/sign-in", { email: D.email, password: PW }, { jar: other })
    const go = await post("/api/auth/account/delete", { confirm: "DELETE" }, { jar: D.jar })
    check("K11 delete → ok with a request id, cookie cleared", go.status === 200 && go.json.ok === true && go.json.requestId && !D.jar.has("yard_s"), sum(go))
    check("K12 every session of the account is ended", (await session(D.jar)).shopper == null && (await session(other)).shopper == null)
    const si = await post("/api/auth/sign-in", { email: D.email, password: PW })
    check("K13 the deleted account can't sign in → 401", si.status === 401, sum(si))
    const ml = await post("/api/auth/magic-link", { email: D.email })
    check("K14 magic link for a deleted account → ok but nothing sent", ml.status === 200 && !(await outbox(D.email)).some((m) => m.template === "magic_link"), sum(ml))
    check("K15 account_deleted email queued", (await outbox(D.email)).some((m) => m.template === "account_deleted"))
    let ins = null
    for (let i = 0; i < 10; i++) {
      ins = await inspect(D.userId ?? "none")
      if (ins?.deletions?.[0]?.status === "completed") break
      await dev({ op: "run-erasures" })
      await sleep(500)
    }
    const dl = ins?.deletions?.[0]
    check("K16 erasure job completed", dl?.status === "completed", ins)
    check("K17 users row anonymised (name, email) and suspended", ins?.user?.name === "Deleted shopper" && ins.user.email === `deleted+${D.userId}@deleted.invalid` && ins.user.status === "suspended", ins?.user)
    check("K18 credentials, sessions, tokens and memberships removed", ins?.credentials === null && ins.sessions.length === 0 && ins.liveTokens.length === 0 && ins.brandMembers.length === 0, ins)
    console.log(`# info: erasure hooks ran ${JSON.stringify(dl?.meta?.hooksRan)} missing ${JSON.stringify(dl?.meta?.hooksMissing)}`)
    const su = await post("/api/auth/sign-up", { name: "Kit Again", email: D.email, password: PW })
    check("K19 the freed email can sign up again", su.status === 200 && (await inspect(D.email))?.user?.id !== D.userId, sum(su))
    const again = await inspect(D.email)
    if (again?.user?.id) {
      const t = await latestToken(D.email, "verification")
      const j = new Jar("D3")
      await post("/api/auth/verify-email/confirm", { token: t }, { jar: j })
      cleanup.shoppers.push({ email: D.email, password: PW })
    }
  }

  // ===== Cleanup: delete this run's shopper/brand accounts, retire its admins ===================
  {
    cleanup.shoppers.push({ email: S.email, password: PW3 })
    let ok = 0
    for (const c of cleanup.shoppers) {
      const j = new Jar("cleanup")
      const si = await post("/api/auth/sign-in", { email: c.email, password: c.password }, { jar: j })
      if (si.json?.status !== "signed_in") continue
      const r = await post("/api/auth/account/delete", { confirm: "DELETE" }, { jar: j })
      if (r.status === 200) ok++
    }
    await dev({ op: "run-erasures" })
    let retired = 0
    for (const em of cleanup.admins) if ((await dev({ op: "retire-admin", email: em })).status === 200) retired++
    check("Z1 cleanup: this run's shopper/brand accounts deleted and erased", ok === cleanup.shoppers.length, { ok, of: cleanup.shoppers.length })
    check("Z2 cleanup: this run's real admins retired", retired === cleanup.admins.length, { retired, of: cleanup.admins.length })
  }
}

try {
  await main()
} catch (e) {
  failed++
  console.log(`FAIL kit crashed — ${e?.stack ?? e}`)
}
console.log(`# ${passed} passed, ${failed} failed (run ${RUN})`)
process.exit(failed ? 1 : 0)
