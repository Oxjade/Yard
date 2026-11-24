import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { fromWebBrowser, MIN_FILL_MS, screen, turnstileKeys } from "./human-check-core"

describe("bot check (honeypot, fill time, Turnstile switch)", () => {
  const now = 1_800_000_000_000
  it("a filled honeypot is a bot", () => assert.deepEqual(screen({ hp: "http://spam" }, "signup", now), { verdict: "bot", reason: "honeypot" }))
  it("a form sent faster than a person types is a bot", () => {
    assert.deepEqual(screen({ formStartedAt: now - 300 }, "signup", now), { verdict: "bot", reason: "too_fast" })
    assert.deepEqual(screen({ formStartedAt: now - MIN_FILL_MS.signup - 1 }, "signup", now), { verdict: "ok" })
  })
  it("the app sends none of the fields and passes", () => assert.deepEqual(screen({}, "apply", now), { verdict: "ok" }))
  it("a clock off by more than a day is ignored, not trusted", () => assert.deepEqual(screen({ formStartedAt: now + 3 * 86_400_000 }, "reset", now), { verdict: "ok" }))
  it("Turnstile is on only with both keys", () => {
    assert.equal(turnstileKeys({}), null)
    assert.equal(turnstileKeys({ TURNSTILE_SITE_KEY: "x" }), null)
    assert.equal(turnstileKeys({ TURNSTILE_SITE_KEY: " ", TURNSTILE_SECRET_KEY: "y" }), null)
    assert.deepEqual(turnstileKeys({ TURNSTILE_SITE_KEY: "x", TURNSTILE_SECRET_KEY: "y" }), { siteKey: "x", secret: "y" })
  })
  it("browsers send Sec-Fetch headers; the app's native client doesn't", () => {
    assert.equal(fromWebBrowser(new Headers({ "sec-fetch-site": "same-origin" })), true)
    assert.equal(fromWebBrowser(new Headers({ "user-agent": "okhttp/4.12.0" })), false)
  })
})
