#!/usr/bin/env node
// A LOCAL MOCK of the Auth0 endpoints Yard uses for OpenID Connect sign-in. Never talks to Auth0.
//
//   node scripts/auth0-mock.mjs [port]                 (standalone; default 3291)
//   import { startAuth0Mock } from "./auth0-mock.mjs"  (scripts/auth0-e2e.mjs runs it in-process)
//
//   GET  /authorize                 checks client_id / redirect_uri / PKCE, then 302 to
//                                   redirect_uri?code=&state= for the "next user" (see below)
//   POST /oauth/token               authorization_code + client_secret + code_verifier → { id_token } (RS256)
//   GET  /.well-known/jwks.json     the signing key
//
// Test controls (in-process): mock.nextUser({ sub, email, email_verified, name, aud?, nonce?, iss? }) sets
// who "signs in" next; aud/nonce/iss override the token's claims so a kit can check Yard refuses them.
import http from "node:http"
import { createHash, generateKeyPairSync, randomBytes, createSign } from "node:crypto"
import { pathToFileURL } from "node:url"

export async function startAuth0Mock({ port = 3291, clientId = "mock-client-id", clientSecret = "mock-client-secret" } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const kid = `mock-${randomBytes(4).toString("hex")}`
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }
  const issuer = `http://127.0.0.1:${port}/`
  const state = { next: null, codes: new Map(), requests: [] }

  const sign = (claims) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
    const input = `${enc({ alg: "RS256", typ: "JWT", kid })}.${enc(claims)}`
    const s = createSign("SHA256")
    s.update(input)
    return `${input}.${s.sign(privateKey).toString("base64url")}`
  }
  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(JSON.stringify(body))
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) })
    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") return json(res, 200, { keys: [jwk] })
    if (req.method === "GET" && url.pathname === "/authorize") {
      const q = url.searchParams
      if (q.get("client_id") !== clientId) return json(res, 400, { error: "invalid_client" })
      if (q.get("response_type") !== "code" || !q.get("redirect_uri") || !q.get("state") || !q.get("nonce")) return json(res, 400, { error: "invalid_request" })
      if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return json(res, 400, { error: "pkce_required" })
      if (!/\bopenid\b/.test(q.get("scope") ?? "")) return json(res, 400, { error: "invalid_scope" })
      const user = state.next
      if (!user) return json(res, 400, { error: "no_user", detail: "call nextUser() first" })
      const code = randomBytes(16).toString("hex")
      state.codes.set(code, { user, nonce: q.get("nonce"), challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), connection: q.get("connection") })
      const to = new URL(q.get("redirect_uri"))
      to.searchParams.set("code", code)
      to.searchParams.set("state", q.get("state"))
      res.writeHead(302, { location: to.toString() })
      return res.end()
    }
    if (req.method === "POST" && url.pathname === "/oauth/token") {
      let raw = ""
      for await (const c of req) raw += c
      const f = new URLSearchParams(raw)
      if (f.get("grant_type") !== "authorization_code") return json(res, 400, { error: "unsupported_grant_type" })
      if (f.get("client_id") !== clientId || f.get("client_secret") !== clientSecret) return json(res, 401, { error: "access_denied" })
      const entry = state.codes.get(f.get("code") ?? "")
      state.codes.delete(f.get("code") ?? "")
      if (!entry) return json(res, 403, { error: "invalid_grant" })
      if (entry.redirectUri !== f.get("redirect_uri")) return json(res, 403, { error: "invalid_grant", detail: "redirect_uri" })
      const verifier = f.get("code_verifier") ?? ""
      if (createHash("sha256").update(verifier).digest("base64url") !== entry.challenge) return json(res, 403, { error: "invalid_grant", detail: "pkce" })
      const now = Math.floor(Date.now() / 1000)
      const u = entry.user
      const claims = {
        iss: u.iss ?? issuer,
        sub: u.sub,
        aud: u.aud ?? clientId,
        iat: now,
        exp: now + 600,
        nonce: u.nonce ?? entry.nonce,
        ...(u.email !== undefined ? { email: u.email } : {}),
        ...(u.email_verified !== undefined ? { email_verified: u.email_verified } : {}),
        ...(u.name ? { name: u.name } : {}),
      }
      return json(res, 200, { access_token: randomBytes(8).toString("hex"), id_token: sign(claims), token_type: "Bearer", expires_in: 86400 })
    }
    json(res, 404, { error: "not_found" })
  })
  await new Promise((r) => server.listen(port, "127.0.0.1", r))
  return {
    port,
    issuer,
    clientId,
    clientSecret,
    state,
    nextUser(u) {
      state.next = u
    },
    close: () => new Promise((r) => server.close(r)),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = await startAuth0Mock({ port: Number(process.argv[2] ?? 3291) })
  m.nextUser({ sub: "google-oauth2|mock-1", email: "mock.user@example.com", email_verified: true, name: "Mock User" })
  console.log(`auth0 mock on http://127.0.0.1:${m.port} (client ${m.clientId})`)
}
