#!/usr/bin/env node
// Auth0 (generic OIDC) end-to-end kit. Runs the local Auth0 mock (auth0-mock.mjs) in-process:
// NOTHING here talks to Auth0. Plain Node 22, no deps.
//
//   node scripts/auth0-e2e.mjs
//
// Needs a DEVELOPMENT Yard server (throwaway YARD_DATA_DIR) started with:
//   AUTH0_DOMAIN=mock.auth0.test
//   AUTH0_ISSUER_BASE=http://127.0.0.1:3291      (the mock; dev/test only, refused in production)
//   AUTH0_CLIENT_ID=mock-client-id
//   AUTH0_CLIENT_SECRET=mock-client-secret
//   AUTH0_CONNECTIONS=google-oauth2,facebook
//   YARD_TRUSTED_PROXY_HOPS=1
// Env for the kit: YARD_BASE (server origin, default http://localhost:3210), AUTH0_MOCK_PORT (3291).
import { randomBytes } from "node:crypto"
import { startAuth0Mock } from "./auth0-mock.mjs"

const BASE = (process.env.YARD_BASE ?? "http://localhost:3210").replace(/\/$/, "")
const MOCK_PORT = Number(process.env.AUTH0_MOCK_PORT ?? 3291)
const RUN = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`
const IP = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`

let passed = 0
let failed = 0
const check = (name, ok, detail = "") => {
  if (ok) passed++
  else failed++
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400)}` : ""}`)
  return ok
}

class Jar {
  c = new Map()
  take(res) {
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = sc.split(";")
      const i = pair.indexOf("=")
      const k = pair.slice(0, i).trim()
      const v = pair.slice(i + 1).trim()
      if (v === "" || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) this.c.delete(k)
      else this.c.set(k, v)
    }
  }
  header() {
    return [...this.c].map(([k, v]) => `${k}=${v}`).join("; ")
  }
}

async function yard(method, path, { body, jar } = {}) {
  const h = { "X-Forwarded-For": IP }
  if (method !== "GET") Object.assign(h, { Origin: BASE, "X-Yard-Client": "1" })
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
  return { status: res.status, json, location: res.headers.get("location") }
}

/** start → mock /authorize → Yard callback. Returns the /auth/complete URL and the jar. */
async function signIn(user, { connection = "google-oauth2", jar = new Jar(), callbackJar, mode = "signin" } = {}) {
  mock.nextUser(user)
  const start = await yard("POST", "/api/auth/oauth/auth0/start", { body: { mode, actor: "shopper", connection }, jar })
  if (start.status !== 200 || !start.json?.url) return { start, jar }
  const auth = await fetch(start.json.url, { redirect: "manual" })
  const cbUrl = auth.headers.get("location")
  if (auth.status !== 302 || !cbUrl) return { start, jar, authorize: auth.status }
  const cb = new URL(cbUrl)
  const back = await yard("GET", cb.pathname + cb.search, { jar: callbackJar ?? jar })
  const done = back.location ? new URL(back.location) : null
  return { start, jar, url: start.json.url, callback: cb, back, result: done?.searchParams.get("result") ?? null }
}

const session = async (jar) => (await yard("GET", "/api/session", { jar })).json

let mock
async function main() {
  // Providers list
  const p = await yard("GET", "/api/auth/providers")
  check("providers: auth0 on with its connections", p.status === 200 && p.json.auth0 === true && JSON.stringify(p.json.auth0Connections) === JSON.stringify([{ name: "google-oauth2", label: "Google" }, { name: "facebook", label: "Facebook" }]), p.json)
  check("providers: google/apple stay off (no keys)", p.json.google === false && p.json.apple === false, p.json)

  // Start: authorize URL shape, connection allow-list
  const s1 = await yard("POST", "/api/auth/oauth/auth0/start", { body: { mode: "signin", actor: "shopper", connection: "facebook" }, jar: new Jar() })
  const u = s1.json?.url ? new URL(s1.json.url) : null
  check(
    "start: authorize URL at the issuer with PKCE, state, nonce, scope, connection",
    s1.status === 200 &&
      u?.origin === `http://127.0.0.1:${MOCK_PORT}` &&
      u.pathname === "/authorize" &&
      u.searchParams.get("scope") === "openid email profile" &&
      u.searchParams.get("code_challenge_method") === "S256" &&
      !!u.searchParams.get("state") &&
      !!u.searchParams.get("nonce") &&
      u.searchParams.get("connection") === "facebook" &&
      u.searchParams.get("redirect_uri") === `${BASE}/api/auth/oauth/auth0/callback`,
    s1,
  )
  const s2 = await yard("POST", "/api/auth/oauth/auth0/start", { body: { mode: "signin", actor: "shopper", connection: "myspace" }, jar: new Jar() })
  check("start: an unconfigured connection is refused (400)", s2.status === 400, s2)

  const email = `t_auth0_${RUN}@example.com`
  // New user
  const a = await signIn({ sub: `google-oauth2|${RUN}1`, email, email_verified: true, name: "Auth Zero" })
  const sa = await session(a.jar)
  check("new user: callback → /auth/complete result=signed_in", a.result === "signed_in" && a.back.status === 302, { result: a.result, status: a.back?.status, start: a.start?.status })
  check("new user: session set for a new shopper with that email", sa?.shopper?.email === email && !sa.shopper.demo, sa)
  const userId = sa?.shopper?.id

  // Second sign-in, fresh browser → same account
  const b = await signIn({ sub: `google-oauth2|${RUN}1`, email, email_verified: true, name: "Auth Zero" })
  const sb = await session(b.jar)
  check("second sign-in: same Yard account", b.result === "signed_in" && !!userId && sb?.shopper?.id === userId, { result: b.result, id: sb?.shopper?.id, userId })

  // Another connection, same verified email → linked to the same account
  const c = await signIn({ sub: `facebook|${RUN}1`, email, email_verified: true }, { connection: "facebook" })
  const sc = await session(c.jar)
  check("another connection (facebook), same verified email: same Yard account", c.result === "signed_in" && sc?.shopper?.id === userId, { result: c.result, id: sc?.shopper?.id })

  // Re-auth through Auth0 (same session): the identity's own connection confirms; a stranger doesn't.
  const r1 = await signIn({ sub: `google-oauth2|${RUN}1`, email, email_verified: true }, { mode: "reauth", jar: a.jar })
  check("reauth with the linked Auth0 identity: reauthed", r1.result === "reauthed", { result: r1.result, start: r1.start?.status })
  const r2 = await signIn({ sub: `google-oauth2|${RUN}9`, email: `t_auth0_${RUN}_x@example.com`, email_verified: true }, { mode: "reauth", jar: a.jar })
  check("reauth with another person's identity: reauth_mismatch", r2.result === "reauth_mismatch", r2.result)

  // Refusals
  const n = await signIn({ sub: `google-oauth2|${RUN}1`, email, email_verified: true, nonce: "not-the-nonce" })
  check("wrong nonce: refused (result=error), no session", n.result === "error" && !(await session(n.jar))?.shopper, n.result)
  const au = await signIn({ sub: `google-oauth2|${RUN}1`, email, email_verified: true, aud: "someone-else" })
  check("wrong aud: refused (result=error), no session", au.result === "error" && !(await session(au.jar))?.shopper, au.result)
  const is = await signIn({ sub: `google-oauth2|${RUN}1`, email, email_verified: true, iss: "https://evil.example/" })
  check("wrong iss: refused (result=error), no session", is.result === "error" && !(await session(is.jar))?.shopper, is.result)
  const uv = await signIn({ sub: `google-oauth2|${RUN}2`, email: `t_auth0_${RUN}_uv@example.com`, email_verified: false })
  check("email_verified false: refused (result=email_unverified), no session", uv.result === "email_unverified" && !(await session(uv.jar))?.shopper, uv.result)
  const mv = await signIn({ sub: `facebook|${RUN}3`, email: `t_auth0_${RUN}_mv@example.com` }, { connection: "facebook" })
  check("email_verified missing: refused (result=email_unverified)", mv.result === "email_unverified", mv.result)
  const ne = await signIn({ sub: `twitter|${RUN}4` })
  check("no email: refused (result=email_required)", ne.result === "email_required", ne.result)
  const uvExisting = await signIn({ sub: `google-oauth2|${RUN}5`, email, email_verified: false })
  check("unverified email matching an existing account: refused, no session", uvExisting.result === "email_unverified" && !(await session(uvExisting.jar))?.shopper, uvExisting.result)

  // State / browser binding
  const other = await signIn({ sub: `google-oauth2|${RUN}1`, email, email_verified: true }, { callbackJar: new Jar() })
  check("callback in another browser (no binding cookie): invalid_state", other.result === "invalid_state", other.result)
  if (a.callback) {
    const replay = await yard("GET", a.callback.pathname + a.callback.search, { jar: a.jar })
    const r = replay.location ? new URL(replay.location).searchParams.get("result") : null
    check("replayed callback (state used): invalid_state", r === "invalid_state", r)
  }
}

mock = await startAuth0Mock({ port: MOCK_PORT })
try {
  await main()
} catch (e) {
  check("kit ran to the end", false, String(e?.stack ?? e).slice(0, 600))
}
await mock.close()
console.log(`# ${passed} passed, ${failed} failed (run ${RUN})`)
process.exit(failed ? 1 : 0)
