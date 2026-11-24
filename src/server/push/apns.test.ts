import assert from "node:assert/strict"
import { createVerify, generateKeyPairSync, type KeyObject } from "node:crypto"
import http2 from "node:http2"
import type { AddressInfo } from "node:net"
import { after, before, describe, it } from "node:test"
import { ApnsClient } from "./apns"
import {
  apnsTokenGone,
  buildLiveActivityPayload,
  buildProviderToken,
  contentState,
  liveActivityTopic,
  PROVIDER_TOKEN_TTL_MS,
  ProviderTokenCache,
  pushDecision,
  readApnsConfig,
  REFERENCE_DATE_UNIX,
} from "./apns-core"

/*
 * APNs Live Activity sender (apns-core.ts, apns.ts). Apple's servers can't be reached with real keys
 * from CI, so the HTTP/2 sender runs against a local HTTP/2 mock of the APNs endpoint (h2c on
 * 127.0.0.1) that checks the headers and answers like APNs does.
 */

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const CONF = { keyId: "ABC123DEFG", teamId: "TEAM123456", key: privateKey as KeyObject }

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>
function verifyJwt(jwt: string) {
  const [h, c, s] = jwt.split(".")
  return createVerify("SHA256").update(`${h}.${c}`).end().verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"))
}

describe("APNs settings", () => {
  const env = { APNS_KEY_PATH: "/etc/yard/apns.p8", APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "TEAM123456", APNS_BUNDLE_ID: "space.yardstore.app" }
  it("all set: production by default, the liveactivity topic", () => {
    const r = readApnsConfig(env, () => PEM)
    assert.equal(r.problem, null)
    assert.equal(r.config?.origin, "https://api.push.apple.com")
    assert.equal(r.config?.topic, "space.yardstore.app.push-type.liveactivity")
    assert.equal(liveActivityTopic("x.y"), "x.y.push-type.liveactivity")
  })
  it("development uses the sandbox", () => {
    assert.equal(readApnsConfig({ ...env, APNS_ENV: "development" }, () => PEM).config?.origin, "https://api.sandbox.push.apple.com")
  })
  it("missing or bad settings mean off, with a reason that never holds the key", () => {
    assert.match(readApnsConfig({ ...env, APNS_KEY_ID: "" }, () => PEM).problem!, /APNS_KEY_ID not set/)
    assert.match(readApnsConfig({ ...env, APNS_ENV: "staging" }, () => PEM).problem!, /APNS_ENV/)
    assert.match(
      readApnsConfig(env, () => {
        throw new Error("EACCES")
      }).problem!,
      /can't be read/,
    )
    const bad = readApnsConfig(env, () => "not a key")
    assert.equal(bad.config, null)
    assert.doesNotMatch(bad.problem!, /not a key$/)
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    assert.match(readApnsConfig(env, () => rsa).problem!, /EC P-256/)
  })
})

describe("Provider token (JWT)", () => {
  it("ES256 with kid, iss and iat, verifiable with the key's public half", () => {
    const jwt = buildProviderToken(CONF, 1_800_000_000)
    const [h, c] = jwt.split(".")
    assert.deepEqual(decode(h!), { alg: "ES256", kid: "ABC123DEFG" })
    assert.deepEqual(decode(c!), { iss: "TEAM123456", iat: 1_800_000_000 })
    assert.equal(Buffer.from(jwt.split(".")[2]!, "base64url").length, 64) // raw r||s, as JWS wants
    assert.equal(verifyJwt(jwt), true)
  })
  it("is cached under an hour (50 minutes), then re-signed; reset forces a new one", () => {
    const cache = new ProviderTokenCache(CONF)
    const t0 = 1_800_000_000_000
    const a = cache.get(t0)
    assert.equal(cache.get(t0 + 49 * 60_000), a)
    assert.ok(PROVIDER_TOKEN_TTL_MS < 60 * 60_000 && PROVIDER_TOKEN_TTL_MS > 20 * 60_000)
    const b = cache.get(t0 + PROVIDER_TOKEN_TTL_MS)
    assert.notEqual(b, a)
    assert.equal(decode(b.split(".")[1]!).iat, Math.floor((t0 + PROVIDER_TOKEN_TTL_MS) / 1000))
    cache.reset()
    assert.notEqual(cache.get(t0 + PROVIDER_TOKEN_TTL_MS + 1000), b)
  })
})

describe("Payload (matches YardOrderActivityAttributes.ContentState's Codable)", () => {
  const eta = Date.parse("2026-11-22T20:00:00.000Z")
  const state = { step: "outForDelivery" as const, etaMs: eta, progress: 0.86, statusLine: "Out for delivery in London" }
  it("content-state keys and the Swift default Date encoding (seconds since 2001-01-01)", () => {
    const cs = contentState(state)
    assert.deepEqual(Object.keys(cs).sort(), ["etaDate", "progress", "statusLine", "step"])
    assert.equal(cs.etaDate, eta / 1000 - 978_307_200)
    assert.equal(cs.etaDate, 817_070_400) // 2026-11-22T20:00:00Z as Date(timeIntervalSinceReferenceDate:)
    assert.equal(REFERENCE_DATE_UNIX, Date.UTC(2001, 0, 1) / 1000)
    assert.equal("etaDate" in contentState({ ...state, etaMs: null }), false)
  })
  it("update: timestamp, event, content-state, stale-date, relevance-score (Unix seconds)", () => {
    const now = Date.parse("2026-11-21T10:00:00.500Z")
    const p = buildLiveActivityPayload({ event: "update", state, nowMs: now, staleMs: now + 8 * 3_600_000, relevance: 100 })
    assert.deepEqual(p, {
      aps: {
        timestamp: Math.floor(now / 1000),
        event: "update",
        "content-state": { step: "outForDelivery", etaDate: 817_070_400, progress: 0.86, statusLine: "Out for delivery in London" },
        "relevance-score": 100,
        "stale-date": Math.floor(now / 1000) + 8 * 3600,
      },
    })
  })
  it("end: dismissal-date, no stale-date", () => {
    const now = 1_800_000_000_000
    const p = buildLiveActivityPayload({ event: "end", state: { step: "delivered", etaMs: null, progress: 1, statusLine: "Delivered" }, nowMs: now, dismissalMs: now + 7_200_000, relevance: 60 })
    assert.equal(p.aps["dismissal-date"], 1_800_000_000 + 7200)
    assert.equal("stale-date" in p.aps, false)
    assert.deepEqual(p.aps["content-state"], { step: "delivered", progress: 1, statusLine: "Delivered" })
  })
  it("start: attributes-type, attributes, alert", () => {
    const p = buildLiveActivityPayload({
      event: "start",
      state,
      nowMs: 1_800_000_000_000,
      staleMs: 1_800_028_800_000,
      relevance: 100,
      attributes: { orderId: "or_1", brandName: "B", brandCity: "Lagos", deliveryCity: "London" },
      alert: { title: "B shipped your order", body: "On its way" },
    })
    assert.equal(p.aps["attributes-type"], "YardOrderActivityAttributes")
    assert.deepEqual(p.aps.attributes, { orderId: "or_1", brandName: "B", brandCity: "Lagos", deliveryCity: "London" })
    assert.deepEqual(p.aps.alert, { title: "B shipped your order", body: "On its way" })
  })
  it("gone tokens: 410, BadDeviceToken, DeviceTokenNotForTopic; not a throttle or a server error", () => {
    assert.equal(apnsTokenGone(410, "Unregistered"), true)
    assert.equal(apnsTokenGone(400, "BadDeviceToken"), true)
    assert.equal(apnsTokenGone(400, "DeviceTokenNotForTopic"), true)
    assert.equal(apnsTokenGone(400, "BadTopic"), false)
    assert.equal(apnsTokenGone(429, "TooManyRequests"), false)
    assert.equal(apnsTokenGone(500, null), false)
  })
  it("push decision: first and step changes now; same state not again; refresh after 6 h or a move", () => {
    const now = 1_800_000_000_000
    const s = { step: "shipped" as const, etaMs: 1, progress: 0.4, statusLine: "On its way" }
    assert.deepEqual(pushDecision(null, s, null, now, false), { send: true, priority: 10 })
    assert.deepEqual(pushDecision(s, { ...s, step: "arrivingSoon" }, now, now, false), { send: true, priority: 10 })
    assert.deepEqual(pushDecision(s, { ...s, statusLine: "Running late — new estimate" }, now, now, false), { send: true, priority: 5 })
    assert.equal(pushDecision(s, s, now, now, false).send, false)
    assert.equal(pushDecision(s, { ...s, progress: 0.41 }, now, now, false).send, true)
    assert.equal(pushDecision(s, { ...s, progress: 0.41 }, now, now + 60_000, true).send, false)
    assert.equal(pushDecision(s, { ...s, progress: 0.46 }, now, now + 60_000, true).send, true)
    assert.equal(pushDecision(s, s, now, now + 6 * 3_600_000, true).send, true)
  })
})

describe("HTTP/2 sender against a local APNs mock", () => {
  type Seen = { headers: http2.IncomingHttpHeaders; body: string }
  const seen: Seen[] = []
  let answer: (s: Seen, n: number) => { status: number; reason?: string } = () => ({ status: 200 })
  let server: http2.Http2Server
  let origin = ""
  const clients: ApnsClient[] = []
  const track = (c: ApnsClient) => (clients.push(c), c)

  before(async () => {
    server = http2.createServer()
    server.on("stream", (stream, headers) => {
      const chunks: Buffer[] = []
      stream.on("data", (c: Buffer) => chunks.push(c))
      stream.on("end", () => {
        const s = { headers, body: Buffer.concat(chunks).toString("utf8") }
        seen.push(s)
        const a = answer(s, seen.length)
        stream.respond({ ":status": a.status, "apns-id": `id-${seen.length}`, ...(a.reason ? { "content-type": "application/json" } : {}) })
        stream.end(a.reason ? JSON.stringify({ reason: a.reason }) : undefined)
      })
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(() => {
    for (const c of clients) c.close()
    server.close()
  })

  const TOKEN = "a1".repeat(32)
  const payload = buildLiveActivityPayload({ event: "update", state: { step: "shipped", etaMs: null, progress: 0.3, statusLine: "On its way" }, nowMs: 1_800_000_000_000, staleMs: 1_800_028_800_000, relevance: 40 })

  it("POST /3/device/<token> with the liveactivity headers, bearer JWT and the JSON body", async () => {
    seen.length = 0
    answer = () => ({ status: 200 })
    const c = track(new ApnsClient({ ...CONF, origin, topic: "space.yardstore.app.push-type.liveactivity" }))
    const a = await c.send(TOKEN, payload, 10)
    assert.deepEqual(a, { status: 200, reason: null, apnsId: "id-1" })
    const h = seen[0]!.headers
    assert.equal(h[":method"], "POST")
    assert.equal(h[":path"], `/3/device/${TOKEN}`)
    assert.equal(h["apns-push-type"], "liveactivity")
    assert.equal(h["apns-topic"], "space.yardstore.app.push-type.liveactivity")
    assert.equal(h["apns-priority"], "10")
    const auth = String(h.authorization)
    assert.match(auth, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/)
    assert.equal(verifyJwt(auth.slice(7)), true)
    assert.deepEqual(JSON.parse(seen[0]!.body), payload)
    // A second push reuses the connection and the cached token.
    await c.send(TOKEN, payload, 5)
    assert.equal(seen[1]!.headers.authorization, h.authorization)
    assert.equal(seen[1]!.headers["apns-priority"], "5")
    c.close()
  })

  it("410 Unregistered comes back as gone", async () => {
    seen.length = 0
    answer = () => ({ status: 410, reason: "Unregistered" })
    const c = track(new ApnsClient({ ...CONF, origin, topic: "t.push-type.liveactivity" }))
    const a = await c.send(TOKEN, payload, 10)
    assert.equal(a.status, 410)
    assert.equal(a.reason, "Unregistered")
    assert.equal(apnsTokenGone(a.status, a.reason), true)
    c.close()
  })

  it("403 ExpiredProviderToken: re-signs and retries once", async () => {
    seen.length = 0
    answer = (_s, n) => (n === 1 ? { status: 403, reason: "ExpiredProviderToken" } : { status: 200 })
    let clock = 1_800_000_000_000
    const c = track(new ApnsClient({ ...CONF, origin, topic: "t.push-type.liveactivity" }, () => clock))
    c.tokens.get(clock) // cached token from "earlier"
    clock += 1000
    const a = await c.send(TOKEN, payload, 10)
    assert.equal(a.status, 200)
    assert.equal(seen.length, 2)
    assert.notEqual(seen[0]!.headers.authorization, seen[1]!.headers.authorization)
    c.close()
  })
})
