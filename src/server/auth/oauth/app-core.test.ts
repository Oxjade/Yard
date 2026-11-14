import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import test from "node:test"
import { APP_CHALLENGE_RE, APP_CODE_RE, appCompleteUrl, challengeOf, hashHandoffCode, isAppClient, newHandoffCode, verifierMatches } from "./app-core"

const verifier = () => randomBytes(32).toString("base64url")

test("the challenge is base64url(sha256(verifier)), 43 characters, no padding", () => {
  const v = verifier()
  const c = challengeOf(v)
  assert.equal(c, createHash("sha256").update(v).digest("base64url"))
  assert.equal(c.length, 43)
  assert.match(c, APP_CHALLENGE_RE)
  assert.ok(!c.includes("="))
})

test("a verifier matches only its own challenge", () => {
  const v = verifier()
  assert.equal(verifierMatches(v, challengeOf(v)), true)
  assert.equal(verifierMatches(verifier(), challengeOf(v)), false)
  assert.equal(verifierMatches(v, challengeOf(v).slice(0, 42)), false)
  assert.equal(verifierMatches("short", challengeOf("short")), false)
  assert.equal(verifierMatches(`${v}!`, challengeOf(`${v}!`)), false)
})

test("hand-off codes are 32 random bytes, stored as sha256 only", () => {
  const a = newHandoffCode()
  const b = newHandoffCode()
  assert.match(a.code, APP_CODE_RE)
  assert.notEqual(a.code, b.code)
  assert.equal(a.hash, createHash("sha256").update(a.code).digest("hex"))
  assert.equal(hashHandoffCode(a.code), a.hash)
  assert.ok(!a.hash.includes(a.code))
})

test("the app's completion URL carries a code only on success", () => {
  const ok = new URL(appCompleteUrl({ code: "c".repeat(43), result: "signed_in", provider: "google", mode: "signin", actor: "shopper" }))
  assert.equal(ok.protocol, "yard:")
  assert.equal(ok.host, "auth")
  assert.equal(ok.pathname, "/complete")
  assert.deepEqual(Object.fromEntries(ok.searchParams), { code: "c".repeat(43), result: "signed_in", provider: "google", mode: "signin", actor: "shopper" })
  const fail = new URL(appCompleteUrl({ result: "cancelled", provider: "apple", mode: "signin", actor: "shopper" }))
  assert.deepEqual(Object.fromEntries(fail.searchParams), { result: "cancelled", provider: "apple" })
  assert.equal(appCompleteUrl({ result: "not_configured", provider: "auth0" }), "yard://auth/complete?result=not_configured&provider=auth0")
})

test("only android and ios are app clients", () => {
  assert.equal(isAppClient("android"), true)
  assert.equal(isAppClient("ios"), true)
  assert.equal(isAppClient("web"), false)
})
