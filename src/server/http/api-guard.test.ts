import assert from "node:assert/strict"
import test from "node:test"
import { clientIpFrom, guardConfigFrom, guardRequest, TokenBuckets } from "./api-guard"
import { requestLine, requestLogEnabled } from "./request-log"

const cfg = { apiPerMin: 5, authPerMin: 2, maxBodyBytes: 1024, hops: 1 }
const req = (path: string, ip = "203.0.113.7", extra: Partial<{ method: string; contentLength: string; contentType: string }> = {}) => ({
  method: extra.method ?? "GET",
  path,
  forwardedFor: ip,
  contentLength: extra.contentLength ?? null,
  contentType: extra.contentType ?? null,
})

test("config: defaults, env overrides, invalid values fall back", () => {
  assert.deepEqual(guardConfigFrom({ NODE_ENV: "production" }), { apiPerMin: 300, authPerMin: 60, maxBodyBytes: 1048576, hops: 0, dev: false })
  assert.deepEqual(guardConfigFrom({ NODE_ENV: "production", YARD_RATE_API_PER_MIN: "120", YARD_RATE_AUTH_PER_MIN: "10", YARD_TRUSTED_PROXY_HOPS: "1" }), { apiPerMin: 120, authPerMin: 10, maxBodyBytes: 1048576, hops: 1, dev: false })
  assert.deepEqual(guardConfigFrom({}), { apiPerMin: 3000, authPerMin: 600, maxBodyBytes: 1048576, hops: 0, dev: true })
  assert.equal(guardConfigFrom({ YARD_RATE_AUTH_PER_MIN: "60" }).authPerMin, 60)
  assert.equal(guardConfigFrom({ NODE_ENV: "production", YARD_RATE_API_PER_MIN: "lots" }).apiPerMin, 300)
  assert.equal(guardConfigFrom({ YARD_TRUSTED_PROXY_HOPS: "9" }).hops, 0)
})

test("client IP follows the trusted-hops rule and ignores what a client prepends", () => {
  assert.equal(clientIpFrom("198.51.100.1, 203.0.113.7", 1), "203.0.113.7")
  assert.equal(clientIpFrom("198.51.100.1, 203.0.113.7", 2), "198.51.100.1")
  assert.equal(clientIpFrom("203.0.113.7", 0), null)
  assert.equal(clientIpFrom("203.0.113.7", 2), null)
  assert.equal(clientIpFrom("not-an-ip", 1), null)
  assert.equal(clientIpFrom("::ffff:203.0.113.7", 1), "203.0.113.7")
})

test("past the per-minute budget: 429 with Retry-After; refills over time", () => {
  const b = new TokenBuckets()
  const t0 = 1_000_000
  for (let i = 0; i < 5; i++) assert.equal(guardRequest(b, cfg, req("/api/catalog/products"), t0).ok, true)
  const v = guardRequest(b, cfg, req("/api/catalog/products"), t0)
  assert.equal(v.ok, false)
  assert.ok(!v.ok && v.status === 429 && v.retryAfter >= 1 && v.retryAfter <= 12)
  // Another address has its own bucket.
  assert.equal(guardRequest(b, cfg, req("/api/catalog/products", "203.0.113.8"), t0).ok, true)
  // 5/min refills one token every 12 s.
  assert.equal(guardRequest(b, cfg, req("/api/catalog/products"), t0 + 12_000).ok, true)
})

test("auth paths have their own smaller bucket; health and webhooks are never counted", () => {
  const b = new TokenBuckets()
  const t0 = 2_000_000
  assert.equal(guardRequest(b, cfg, req("/api/auth/sign-in", undefined, { method: "POST" }), t0).ok, true)
  assert.equal(guardRequest(b, cfg, req("/api/auth/sign-in", undefined, { method: "POST" }), t0).ok, true)
  const v = guardRequest(b, cfg, req("/api/auth/sign-in", undefined, { method: "POST" }), t0)
  assert.ok(!v.ok && v.status === 429)
  for (let i = 0; i < 50; i++) {
    assert.equal(guardRequest(b, cfg, req("/api/health"), t0).ok, true)
    assert.equal(guardRequest(b, cfg, req("/api/webhooks/paystack", undefined, { method: "POST" }), t0).ok, true)
    assert.equal(guardRequest(b, cfg, req("/api/media/m_1"), t0).ok, true)
  }
})

test("dev-only test hooks are counted in production only", () => {
  const b = new TokenBuckets()
  for (let i = 0; i < 20; i++) assert.equal(guardRequest(b, { ...cfg, dev: true }, req("/api/auth/dev"), 4_000_000).ok, true)
  const prod = { ...cfg, dev: false }
  for (let i = 0; i < 2; i++) assert.equal(guardRequest(b, prod, req("/api/auth/dev"), 4_000_000).ok, true)
  assert.equal(guardRequest(b, prod, req("/api/auth/dev"), 4_000_000).ok, false)
})

test("unknown client IP is not counted (no shared bucket to lock everyone out)", () => {
  const b = new TokenBuckets()
  const c0 = { ...cfg, hops: 0 }
  for (let i = 0; i < 50; i++) assert.equal(guardRequest(b, c0, req("/api/search"), 3_000_000).ok, true)
  assert.equal(b.size, 0)
})

test("a declared JSON body over the cap is 413; multipart is left to the upload route", () => {
  const b = new TokenBuckets()
  const big = guardRequest(b, cfg, req("/api/cart/lines", undefined, { method: "POST", contentLength: "2048", contentType: "application/json" }))
  assert.ok(!big.ok && big.status === 413)
  assert.equal(guardRequest(b, cfg, req("/api/x", undefined, { method: "POST", contentLength: "2048", contentType: "multipart/form-data; boundary=x" })).ok, true)
  assert.equal(guardRequest(b, cfg, req("/api/cart/lines", undefined, { method: "POST", contentLength: "512", contentType: "application/json" })).ok, true)
})

test("the key space is bounded and sweeps refilled buckets", () => {
  const b = new TokenBuckets(3)
  for (let i = 0; i < 10; i++) b.take(`k${i}`, 5, 0)
  assert.equal(b.size, 3)
  b.sweep(() => 5, 60_000)
  assert.equal(b.size, 0)
})

test("request log: on in production, off in development unless asked; never a query string", () => {
  assert.equal(requestLogEnabled({ NODE_ENV: "production" }), true)
  assert.equal(requestLogEnabled({ NODE_ENV: "development" }), false)
  assert.equal(requestLogEnabled({ NODE_ENV: "development", YARD_REQUEST_LOG: "1" }), true)
  assert.equal(requestLogEnabled({ NODE_ENV: "production", YARD_REQUEST_LOG: "0" }), false)
  const line = JSON.parse(requestLine({ id: "abc123", method: "GET", path: "/api/search", status: 200, ms: 12.6 }))
  assert.deepEqual(line, { t: "req", id: "abc123", m: "GET", p: "/api/search", s: 200, ms: 13 })
})
