import { test } from "node:test"
import assert from "node:assert/strict"
import { auth0ConnectionLabel, auth0ConnectionOfSubject, auth0IssuerBase, normaliseAuth0Domain, parseAuth0Connections, parseReauthProviders, socialButtons } from "./auth0"

test("connection labels: known names and capitalised fallbacks", () => {
  assert.equal(auth0ConnectionLabel("google-oauth2"), "Google")
  assert.equal(auth0ConnectionLabel("facebook"), "Facebook")
  assert.equal(auth0ConnectionLabel("apple"), "Apple")
  assert.equal(auth0ConnectionLabel("twitter"), "X")
  assert.equal(auth0ConnectionLabel("windowslive"), "Microsoft")
  assert.equal(auth0ConnectionLabel("linkedin"), "LinkedIn")
  assert.equal(auth0ConnectionLabel("github"), "GitHub")
  assert.equal(auth0ConnectionLabel("discord"), "Discord")
  assert.equal(auth0ConnectionLabel("my-sso_conn"), "My Sso Conn")
})

test("AUTH0_CONNECTIONS parsing: default, trimming, duplicates, invalid names", () => {
  assert.deepEqual(parseAuth0Connections(undefined), { connections: [{ name: "google-oauth2", label: "Google" }], invalid: [] })
  assert.deepEqual(parseAuth0Connections("  "), { connections: [{ name: "google-oauth2", label: "Google" }], invalid: [] })
  const p = parseAuth0Connections(" google-oauth2, facebook ,apple,,facebook, bad name, x/y ")
  assert.deepEqual(
    p.connections.map((c) => c.name),
    ["google-oauth2", "facebook", "apple"],
  )
  assert.deepEqual(p.invalid, ["bad name", "x/y"])
})

test("AUTH0_DOMAIN normalisation", () => {
  assert.equal(normaliseAuth0Domain("dev-6jwzxkq64prgvqkh.us.auth0.com"), "dev-6jwzxkq64prgvqkh.us.auth0.com")
  assert.equal(normaliseAuth0Domain(" https://Tenant.EU.auth0.com/ "), "tenant.eu.auth0.com")
  assert.equal(normaliseAuth0Domain(""), null)
  assert.equal(normaliseAuth0Domain("http://tenant.auth0.com"), null)
  assert.equal(normaliseAuth0Domain("tenant.auth0.com/path"), null)
  assert.equal(normaliseAuth0Domain("localhost"), null)
})

test("issuer base: https by default, http://localhost override only outside production", () => {
  assert.deepEqual(auth0IssuerBase("t.auth0.com", undefined, true), { base: "https://t.auth0.com" })
  assert.deepEqual(auth0IssuerBase("t.auth0.com", "http://localhost:4123/", false), { base: "http://localhost:4123" })
  assert.ok("error" in auth0IssuerBase("t.auth0.com", "http://localhost:4123", true))
  assert.ok("error" in auth0IssuerBase("t.auth0.com", "http://evil.example", false))
  assert.deepEqual(auth0IssuerBase("t.auth0.com", "https://login.example.com", true), { base: "https://login.example.com" })
})

test("subject connection prefix", () => {
  assert.equal(auth0ConnectionOfSubject("google-oauth2|1234"), "google-oauth2")
  assert.equal(auth0ConnectionOfSubject("auth0|abc"), "auth0")
  assert.equal(auth0ConnectionOfSubject("plain"), "plain")
})

test("social buttons: one Google button, direct wins", () => {
  const conns = [
    { name: "google-oauth2", label: "Google" },
    { name: "facebook", label: "Facebook" },
    { name: "apple", label: "Apple" },
  ]
  const viaAuth0 = socialButtons({ google: false, apple: false, auth0: true, auth0Connections: conns })
  assert.deepEqual(
    viaAuth0.map((b) => [b.key, b.mark]),
    [
      ["auth0:google-oauth2", "google"],
      ["auth0:facebook", "generic"],
      ["auth0:apple", "apple"],
    ],
  )
  const both = socialButtons({ google: true, apple: false, auth0: true, auth0Connections: conns })
  assert.deepEqual(
    both.map((b) => b.key),
    ["google", "auth0:facebook", "auth0:apple"],
  )
  assert.equal(both.filter((b) => b.label === "Google").length, 1)
  assert.deepEqual(socialButtons({ google: false, apple: false, auth0: false, auth0Connections: conns }), [])
})

test("reauth providers parse google/apple/auth0:<connection>", () => {
  const r = parseReauthProviders("apple,auth0:google-oauth2,auth0:bad name,google,apple")
  assert.deepEqual(
    r.map((p) => [p.provider, p.connection, p.label]),
    [
      ["apple", null, "Apple"],
      ["auth0", "google-oauth2", "Google"],
      ["google", null, "Google"],
    ],
  )
})
