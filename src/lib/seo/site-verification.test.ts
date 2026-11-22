import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { googleVerificationFile, indexNowKey, siteFileBody, siteVerification, siteVerificationWarnings, verificationTokens } from "./site-verification"

describe("site verification meta tags", () => {
  it("renders nothing without the variables", () => {
    assert.equal(siteVerification({}), undefined)
    assert.equal(siteVerification({ GOOGLE_SITE_VERIFICATION: "  ", BING_SITE_VERIFICATION: "" }), undefined)
  })

  it("gives Next's verification field google and msvalidate.01", () => {
    assert.deepEqual(siteVerification({ GOOGLE_SITE_VERIFICATION: "abc123_-XYZ" }), { google: "abc123_-XYZ" })
    assert.deepEqual(siteVerification({ BING_SITE_VERIFICATION: "0123456789ABCDEF" }), { other: { "msvalidate.01": "0123456789ABCDEF" } })
    assert.deepEqual(siteVerification({ GOOGLE_SITE_VERIFICATION: "one, two ,one", BING_SITE_VERIFICATION: "B1,B2" }), { google: ["one", "two"], other: { "msvalidate.01": ["B1", "B2"] } })
  })

  it("drops tokens a meta tag can't carry, and warns", () => {
    assert.deepEqual(verificationTokens(`good,"><script>,has space`), ["good"])
    const w = siteVerificationWarnings({ GOOGLE_SITE_VERIFICATION: `good,"><script>` })
    assert.equal(w.length, 1)
    assert.match(w[0], /GOOGLE_SITE_VERIFICATION has 1 token/)
  })
})

describe("site files", () => {
  const env = { GOOGLE_SITE_VERIFICATION_FILE: "google1a2b3c4d5e6f.html", INDEXNOW_KEY: "0123456789abcdef0123456789abcdef" }

  it("serves the Google HTML file only under its exact name", () => {
    assert.equal(siteFileBody("google", "google1a2b3c4d5e6f.html", env), "google-site-verification: google1a2b3c4d5e6f.html")
    assert.equal(siteFileBody("google", "google0000.html", env), null)
    assert.equal(siteFileBody("google", "google1a2b3c4d5e6f.html", {}), null)
  })

  it("serves the IndexNow key only at /<key>.txt", () => {
    assert.equal(siteFileBody("indexnow", "0123456789abcdef0123456789abcdef.txt", env), env.INDEXNOW_KEY)
    assert.equal(siteFileBody("indexnow", "deadbeefdeadbeef.txt", env), null)
    assert.equal(siteFileBody("indexnow", "0123456789abcdef0123456789abcdef.txt", {}), null)
  })

  it("ignores malformed values (and says so) instead of serving them", () => {
    assert.equal(googleVerificationFile({ GOOGLE_SITE_VERIFICATION_FILE: "../etc/passwd" }), null)
    assert.equal(googleVerificationFile({ GOOGLE_SITE_VERIFICATION_FILE: "google.html" }), null)
    assert.equal(indexNowKey({ INDEXNOW_KEY: "short" }), null)
    assert.equal(indexNowKey({ INDEXNOW_KEY: "not-hex-not-hex-not" }), null)
    assert.equal(indexNowKey({ INDEXNOW_KEY: "a".repeat(129) }), null)
    assert.equal(indexNowKey({ INDEXNOW_KEY: "A1b2C3d4" }), "A1b2C3d4")
    assert.equal(siteVerificationWarnings({ GOOGLE_SITE_VERIFICATION_FILE: "nope.html", INDEXNOW_KEY: "xyz" }).length, 2)
  })
})
