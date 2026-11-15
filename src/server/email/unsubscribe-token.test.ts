import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { describe, it } from "node:test"
import { decodeUnsubscribeToken, encodeUnsubscribeToken } from "./unsubscribe-token"

const CATS = ["drops", "price_drops", "back_in_stock", "brand_news", "marketing"] as const
const key = randomBytes(32)

describe("unsubscribe tokens", () => {
  it("round-trips the address (lower-cased), category and campaign", () => {
    const t = encodeUnsubscribeToken(key, " Ada@Example.com ", "marketing", "nlc_abc123")
    assert.deepEqual(decodeUnsubscribeToken(key, t, CATS), { email: "ada@example.com", category: "marketing", ref: "nlc_abc123" })
  })

  it("works without a campaign, and for 'all'", () => {
    assert.deepEqual(decodeUnsubscribeToken(key, encodeUnsubscribeToken(key, "a@b.co", "all"), CATS), { email: "a@b.co", category: "all" })
  })

  it("reads tokens minted before campaigns existed (same payload, same MAC)", () => {
    const payload = Buffer.from(JSON.stringify({ e: "old@example.com", c: "drops" })).toString("base64url")
    const fresh = encodeUnsubscribeToken(key, "old@example.com", "drops")
    assert.equal(fresh.split(".")[0], payload)
    assert.equal(decodeUnsubscribeToken(key, fresh, CATS)?.category, "drops")
  })

  it("refuses a tampered payload, a wrong key, an unknown category and junk", () => {
    const t = encodeUnsubscribeToken(key, "a@b.co", "marketing", "nlc_1")
    const [p, m] = t.split(".")
    const forged = Buffer.from(JSON.stringify({ e: "victim@b.co", c: "marketing" })).toString("base64url")
    assert.equal(decodeUnsubscribeToken(key, `${forged}.${m}`, CATS), null)
    assert.equal(decodeUnsubscribeToken(randomBytes(32), t, CATS), null)
    assert.equal(decodeUnsubscribeToken(key, `${p}.${m}.x`, CATS), null)
    assert.equal(decodeUnsubscribeToken(key, encodeUnsubscribeToken(key, "a@b.co", "orders"), CATS), null)
    assert.equal(decodeUnsubscribeToken(key, "nope", CATS), null)
    assert.equal(decodeUnsubscribeToken(key, "x".repeat(700), CATS), null)
  })

  it("drops a campaign id that isn't a plain id", () => {
    const t = encodeUnsubscribeToken(key, "a@b.co", "marketing", "nlc_1'; drop table x")
    assert.equal(decodeUnsubscribeToken(key, t, CATS)?.ref, undefined)
  })
})
