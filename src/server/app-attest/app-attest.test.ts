import assert from "node:assert/strict"
import { generateKeyPairSync, sign, X509Certificate } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { encodeCBOR } from "@levischuck/tiny-cbor"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { appAttestChallenges } from "../db/schema/app-attest"
import { APPLE_APP_ATTEST_ROOT_PEM, verifyAssertion, verifyAttestation } from "./apple"
import { attestConfig, attestMode, attestStartupLine, normaliseCertDigest } from "./config"
import { checkPlayVerdict, decodeIntegrityToken, GoogleUnavailable, type PlayPayload } from "./play-integrity"
import { clientData, clientDataHash, decide, encodeAttestHeader, parseAttestHeader, sha256, sha256Hex, verdictEvent, type AttestVerdict } from "./request"
import { advanceCounter, consumeChallenge, getKey, issueChallenge, saveKey, type Db } from "./store"

/* App attestation (src/server/app-attest, docs/APP.md "App attestation"): Play Integrity verdicts,
 * App Attest attestation and assertions, the request binding, single-use challenges and the
 * monitor/enforce decision. Database steps run on PGlite with every migration applied. */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(path.join(HERE, "fixtures/attestation.json"), "utf8")) as { appId: string; environment: "development"; challenge: string; keyId: string; attestation: string; rootPem: string }

/* ---------- configuration ---------- */

const CERT_HEX = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89"
const CERT_B64URL = Buffer.from(CERT_HEX.replace(/:/g, ""), "hex").toString("base64url")
const FULL_ENV = {
  PLAY_INTEGRITY_PACKAGE_NAME: "space.yardstore.app",
  GOOGLE_APPLICATION_CREDENTIALS_PLAY: "/etc/yard/play.json",
  PLAY_INTEGRITY_CERT_SHA256: CERT_HEX,
  PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: "123456789012",
  APP_ATTEST_TEAM_ID: "ABCDE12345",
  APP_ATTEST_BUNDLE_ID: "space.yardstore.app",
}

describe("configuration", () => {
  it("defaults to monitor; reads off and enforce; anything else is monitor", () => {
    assert.equal(attestMode({}), "monitor")
    assert.equal(attestMode({ YARD_APP_ATTEST: "off" }), "off")
    assert.equal(attestMode({ YARD_APP_ATTEST: " Enforce " }), "enforce")
    assert.equal(attestMode({ YARD_APP_ATTEST: "block" }), "monitor")
  })
  it("a platform with missing settings is off, and says what is missing", () => {
    const c = attestConfig({ APP_ATTEST_TEAM_ID: "ABCDE12345" })
    assert.equal(c.android, null)
    assert.equal(c.ios, null)
    assert.deepEqual(c.missing.ios, ["APP_ATTEST_BUNDLE_ID"])
    assert.ok(c.missing.android.includes("GOOGLE_APPLICATION_CREDENTIALS_PLAY"))
    assert.match(attestStartupLine(c), /monitor; Android Play Integrity off \(set .*\); iOS App Attest off \(set APP_ATTEST_BUNDLE_ID\)/)
  })
  it("a complete configuration turns both platforms on", () => {
    const c = attestConfig({ ...FULL_ENV, APP_ATTEST_ENV: "development" })
    assert.deepEqual(c.android, { packageName: "space.yardstore.app", credentialsPath: "/etc/yard/play.json", certDigests: [CERT_B64URL], cloudProjectNumber: "123456789012" })
    assert.deepEqual(c.ios, { teamId: "ABCDE12345", bundleId: "space.yardstore.app", appId: "ABCDE12345.space.yardstore.app", environment: "development" })
    assert.equal(attestConfig(FULL_ENV).ios?.environment, "production")
  })
  it("certificate digests: Play Console hex, base64url or base64 read the same; junk is ignored", () => {
    assert.equal(normaliseCertDigest(CERT_HEX), CERT_B64URL)
    assert.equal(normaliseCertDigest(CERT_HEX.replace(/:/g, "").toLowerCase()), CERT_B64URL)
    assert.equal(normaliseCertDigest(CERT_B64URL), CERT_B64URL)
    assert.equal(normaliseCertDigest(Buffer.from(CERT_HEX.replace(/:/g, ""), "hex").toString("base64")), CERT_B64URL)
    assert.equal(normaliseCertDigest("abc"), null)
    assert.equal(attestConfig({ ...FULL_ENV, PLAY_INTEGRITY_CERT_SHA256: "nope" }).android, null)
  })
})

/* ---------- request binding and header ---------- */

describe("request binding and X-Yard-Attest", () => {
  const body = sha256Hex('{"email":"ada@gmail.com"}')
  it("clientData names the method, path, body hash and challenge", () => {
    assert.equal(clientData("post", "/api/auth/magic-link", body, "c".repeat(43)), `yard-attest/v1\nPOST\n/api/auth/magic-link\n${body}\n${"c".repeat(43)}`)
    assert.notDeepEqual(clientDataHash("POST", "/api/auth/magic-link", body, "c".repeat(43)), clientDataHash("POST", "/api/auth/sign-up", body, "c".repeat(43)))
    assert.notDeepEqual(clientDataHash("POST", "/api/auth/sign-up", body, "c".repeat(43)), clientDataHash("POST", "/api/auth/sign-up", sha256Hex("{}"), "c".repeat(43)))
  })
  it("round-trips both platforms' headers", () => {
    const a = { platform: "android" as const, challenge: "a".repeat(43), token: "eyJ.token.x" }
    assert.deepEqual(parseAttestHeader(encodeAttestHeader(a)), a)
    const i = { platform: "ios" as const, challenge: "b".repeat(43), keyId: fixture.keyId, assertion: Buffer.from([1, 2, 3]) }
    assert.deepEqual(parseAttestHeader(encodeAttestHeader(i)), i)
  })
  it("absent is null; unreadable is malformed", () => {
    assert.equal(parseAttestHeader(null), null)
    assert.equal(parseAttestHeader("  "), null)
    assert.equal(parseAttestHeader("not-base64-json"), "malformed")
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
    assert.equal(parseAttestHeader(enc({ v: 2, p: "android", c: "a".repeat(43), t: "x" })), "malformed")
    assert.equal(parseAttestHeader(enc({ v: 1, p: "android", c: "short", t: "x" })), "malformed")
    assert.equal(parseAttestHeader(enc({ v: 1, p: "web", c: "a".repeat(43) })), "malformed")
    assert.equal(parseAttestHeader(enc({ v: 1, p: "ios", c: "a".repeat(43), k: "k!", a: "AQID" })), "malformed")
  })
})

/* ---------- monitor vs enforce ---------- */

describe("monitor vs enforce", () => {
  const both = { android: true, ios: true }
  const verdicts: AttestVerdict[] = [{ result: "pass", platform: "android" }, { result: "fail", platform: "ios", reason: "signature" }, { result: "missing" }, { result: "skipped", platform: "ios" }, { result: "unavailable", platform: "android" }]
  it("off and monitor never block", () => {
    for (const v of verdicts) {
      assert.equal(decide("off", v, both), "allow")
      assert.equal(decide("monitor", v, both), "allow")
    }
  })
  it("enforce blocks a failed attestation", () => {
    assert.equal(decide("enforce", { result: "fail", platform: "android", reason: "device" }, both), "block")
    assert.equal(decide("enforce", { result: "fail", platform: null, reason: "malformed" }, { android: true, ios: false }), "block")
  })
  it("enforce blocks a missing header only once both platforms are configured", () => {
    assert.equal(decide("enforce", { result: "missing" }, both), "block")
    assert.equal(decide("enforce", { result: "missing" }, { android: true, ios: false }), "allow")
    assert.equal(decide("enforce", { result: "missing" }, { android: false, ios: false }), "allow")
  })
  it("enforce lets a pass, an unconfigured platform and a Google outage through", () => {
    assert.equal(decide("enforce", { result: "pass", platform: "ios" }, both), "allow")
    assert.equal(decide("enforce", { result: "skipped", platform: "android" }, both), "allow")
    assert.equal(decide("enforce", { result: "unavailable", platform: "android" }, both), "allow")
  })
  it("each verdict has its metrics event", () => {
    assert.deepEqual(verdicts.map(verdictEvent), ["app_attest.pass.android", "app_attest.fail.ios", "app_attest.missing", "app_attest.skipped.ios", "app_attest.unavailable.android"])
  })
})

/* ---------- Play Integrity ---------- */

describe("Play Integrity verdicts", () => {
  const now = 1_795_600_000_000
  const hash = clientDataHash("POST", "/api/auth/sign-up", sha256Hex("{}"), "c".repeat(43)).toString("hex")
  const cfg = { packageName: "space.yardstore.app", certDigests: [CERT_B64URL] }
  // The documented standard-request payload (developer.android.com › Play Integrity › Integrity verdicts), with our values.
  const payload = (): PlayPayload =>
    JSON.parse(
      JSON.stringify({
        requestDetails: { requestPackageName: "space.yardstore.app", requestHash: hash, timestampMillis: String(now - 2_000) },
        appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "space.yardstore.app", certificateSha256Digest: [CERT_B64URL], versionCode: "1" },
        deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
        accountDetails: { appLicensingVerdict: "LICENSED" },
      }),
    )
  const check = (p: PlayPayload) => checkPlayVerdict(p, cfg, hash, now)

  it("passes a recognised app on a genuine device for this request", () => assert.deepEqual(check(payload()), { ok: true }))
  it("also passes a device that meets strong integrity too", () => {
    const p = payload()
    p.deviceIntegrity = { deviceRecognitionVerdict: ["MEETS_BASIC_INTEGRITY", "MEETS_DEVICE_INTEGRITY", "MEETS_STRONG_INTEGRITY"] }
    assert.deepEqual(check(p), { ok: true })
  })
  it("refuses an app Play doesn't recognise (sideloaded or re-signed)", () => {
    for (const v of ["UNRECOGNIZED_VERSION", "UNEVALUATED"]) {
      const p = payload()
      p.appIntegrity!.appRecognitionVerdict = v
      assert.deepEqual(check(p), { ok: false, reason: `app_${v.toLowerCase()}` })
    }
  })
  it("refuses another package or signing certificate", () => {
    const p = payload()
    p.appIntegrity!.packageName = "com.example.clone"
    assert.equal((check(p) as { reason: string }).reason, "app_package")
    const q = payload()
    q.requestDetails!.requestPackageName = "com.example.clone"
    assert.equal((check(q) as { reason: string }).reason, "request_package")
    const r = payload()
    r.appIntegrity!.certificateSha256Digest = ["6a6a1474b5cbbb2b1aa57e0bc3"]
    assert.equal((check(r) as { reason: string }).reason, "certificate")
  })
  it("refuses an emulator or rooted device (basic integrity only, or nothing)", () => {
    for (const verdict of [["MEETS_BASIC_INTEGRITY"], [], undefined]) {
      const p = payload()
      p.deviceIntegrity = verdict ? { deviceRecognitionVerdict: verdict } : {}
      assert.equal((check(p) as { reason: string }).reason, "device")
    }
  })
  it("refuses a token made for another request", () => {
    const p = payload()
    p.requestDetails!.requestHash = clientDataHash("POST", "/api/auth/magic-link", sha256Hex("{}"), "c".repeat(43)).toString("hex")
    assert.equal((check(p) as { reason: string }).reason, "request_hash")
    const q = payload()
    delete q.requestDetails!.requestHash
    q.requestDetails!.nonce = hash
    assert.equal((check(q) as { reason: string }).reason, "request_hash")
  })
  it("refuses a stale or future token", () => {
    const p = payload()
    p.requestDetails!.timestampMillis = String(now - 6 * 60_000)
    assert.equal((check(p) as { reason: string }).reason, "stale")
    p.requestDetails!.timestampMillis = String(now + 6 * 60_000)
    assert.equal((check(p) as { reason: string }).reason, "stale")
  })
})

describe("decodeIntegrityToken (Google, faked)", () => {
  let dir: string
  let saPath: string
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "play-sa-"))
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
    saPath = path.join(dir, "sa.json")
    writeFileSync(saPath, JSON.stringify({ type: "service_account", client_email: "yard-play@example.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: "https://oauth2.googleapis.com/token" }))
  })
  after(() => rmSync(dir, { recursive: true, force: true }))

  it("signs in as the service account, then decodes the token", async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.includes("oauth2")) return Response.json({ access_token: "at-1", expires_in: 3600 })
      return Response.json({ tokenPayloadExternal: { requestDetails: { requestHash: "h" } } })
    }) as unknown as typeof fetch
    const out = await decodeIntegrityToken("tok", { packageName: "space.yardstore.app", credentialsPath: saPath }, fake)
    assert.deepEqual(out, { requestDetails: { requestHash: "h" } })
    const assertion = new URLSearchParams(String(calls[0]!.init.body)).get("assertion")!
    const claims = JSON.parse(Buffer.from(assertion.split(".")[1]!, "base64url").toString())
    assert.equal(claims.iss, "yard-play@example.iam.gserviceaccount.com")
    assert.equal(claims.scope, "https://www.googleapis.com/auth/playintegrity")
    assert.equal(calls[1]!.url, "https://playintegrity.googleapis.com/v1/space.yardstore.app:decodeIntegrityToken")
    assert.equal((calls[1]!.init.headers as Record<string, string>).Authorization, "Bearer at-1")
    assert.deepEqual(JSON.parse(String(calls[1]!.init.body)), { integrity_token: "tok" })
  })
  it("a token Google refuses is null; an outage throws GoogleUnavailable", async () => {
    const refusing = (async (url: string) => (url.includes("oauth2") ? Response.json({ access_token: "at-2", expires_in: 3600 }) : new Response("{}", { status: 400 }))) as unknown as typeof fetch
    assert.equal(await decodeIntegrityToken("bad", { packageName: "space.yardstore.app", credentialsPath: saPath }, refusing), null)
    const down = (async (url: string) => (url.includes("oauth2") ? Response.json({ access_token: "at-3", expires_in: 3600 }) : new Response("", { status: 503 }))) as unknown as typeof fetch
    await assert.rejects(decodeIntegrityToken("tok", { packageName: "space.yardstore.app", credentialsPath: saPath }, down), GoogleUnavailable)
    const offline = (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch
    await assert.rejects(decodeIntegrityToken("tok", { packageName: "space.yardstore.app", credentialsPath: saPath }, offline), GoogleUnavailable)
  })
})

/* ---------- App Attest ---------- */

/** A moment inside the fixture chain's validity (it was issued for 100 years). */
const FIXTURE_NOW = new Date(Date.parse(new X509Certificate(fixture.rootPem).validFrom) + 86_400_000)

describe("App Attest attestation", () => {
  const now = FIXTURE_NOW
  const base = () => ({ attestation: Buffer.from(fixture.attestation, "base64"), keyId: fixture.keyId, challenge: fixture.challenge, appId: fixture.appId, environment: fixture.environment, rootPem: fixture.rootPem, now })

  it("Apple's embedded root is the self-signed App Attestation Root CA", () => {
    const root = new X509Certificate(APPLE_APP_ATTEST_ROOT_PEM)
    assert.match(root.subject, /CN=Apple App Attestation Root CA/)
    assert.ok(root.verify(root.publicKey))
    assert.equal(root.fingerprint256, "1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32")
  })
  it("verifies a well-formed attestation and returns the key with counter 0", () => {
    const r = verifyAttestation(base())
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.counter, 0)
    assert.match(r.publicKeyPem, /BEGIN PUBLIC KEY/)
    assert.equal(r.receipt?.toString(), "test-receipt")
  })
  it("refuses a chain that doesn't end at the trusted root (Apple's, here)", () => {
    assert.deepEqual(verifyAttestation({ ...base(), rootPem: APPLE_APP_ATTEST_ROOT_PEM }), { ok: false, reason: "chain" })
  })
  it("refuses another challenge (nonce)", () => assert.deepEqual(verifyAttestation({ ...base(), challenge: "another-challenge-0123456789abcd" }), { ok: false, reason: "nonce" }))
  it("refuses another app (rpIdHash)", () => assert.deepEqual(verifyAttestation({ ...base(), appId: "ZZZZZ99999.space.yardstore.app" }), { ok: false, reason: "app_id" }))
  it("refuses the other environment (aaguid)", () => assert.deepEqual(verifyAttestation({ ...base(), environment: "production" }), { ok: false, reason: "environment" }))
  it("refuses a key id that isn't this key's", () => assert.deepEqual(verifyAttestation({ ...base(), keyId: Buffer.alloc(32, 7).toString("base64") }), { ok: false, reason: "key_id" }))
  it("refuses a chain outside its dates, and garbage", () => {
    assert.deepEqual(verifyAttestation({ ...base(), now: new Date(FIXTURE_NOW.getTime() - 2 * 86_400_000) }), { ok: false, reason: "chain_dates" })
    assert.deepEqual(verifyAttestation({ ...base(), attestation: Buffer.from("not cbor") }), { ok: false, reason: "cbor" })
  })
})

/** An App Attest-style assertion: CBOR { signature, authenticatorData } over sha256(authData ‖ clientDataHash). */
function makeAssertion(privateKey: Parameters<typeof sign>[2], appId: string, counter: number, cdh: Buffer) {
  const c = Buffer.alloc(4)
  c.writeUInt32BE(counter)
  const authenticatorData = Buffer.concat([sha256(appId), Buffer.from([0x40]), c])
  const signature = sign("sha256", sha256(Buffer.concat([authenticatorData, cdh])), privateKey)
  return Buffer.from(encodeCBOR(new Map([["signature", new Uint8Array(signature)], ["authenticatorData", new Uint8Array(authenticatorData)]])))
}

describe("App Attest assertions", () => {
  const appId = "ABCDE12345.space.yardstore.app"
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" })
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString()
  const cdh = clientDataHash("POST", "/api/auth/sign-up", sha256Hex("{}"), "c".repeat(43))

  it("verifies a signed assertion with a higher counter", () => {
    assert.deepEqual(verifyAssertion({ assertion: makeAssertion(privateKey, appId, 1, cdh), clientDataHash: cdh, publicKeyPem, storedCounter: 0, appId }), { ok: true, counter: 1 })
  })
  it("refuses a replay (counter not above the stored one)", () => {
    const a = makeAssertion(privateKey, appId, 5, cdh)
    assert.deepEqual(verifyAssertion({ assertion: a, clientDataHash: cdh, publicKeyPem, storedCounter: 5, appId }), { ok: false, reason: "counter_replay" })
    assert.deepEqual(verifyAssertion({ assertion: a, clientDataHash: cdh, publicKeyPem, storedCounter: 9, appId }), { ok: false, reason: "counter_replay" })
  })
  it("refuses an assertion for another request, key or app", () => {
    const a = makeAssertion(privateKey, appId, 2, cdh)
    const other = clientDataHash("POST", "/api/auth/magic-link", sha256Hex("{}"), "c".repeat(43))
    assert.deepEqual(verifyAssertion({ assertion: a, clientDataHash: other, publicKeyPem, storedCounter: 0, appId }), { ok: false, reason: "signature" })
    const stranger = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString()
    assert.deepEqual(verifyAssertion({ assertion: a, clientDataHash: cdh, publicKeyPem: stranger, storedCounter: 0, appId }), { ok: false, reason: "signature" })
    const elsewhere = makeAssertion(privateKey, "ZZZZZ99999.space.yardstore.app", 2, cdh)
    assert.deepEqual(verifyAssertion({ assertion: elsewhere, clientDataHash: cdh, publicKeyPem, storedCounter: 0, appId }), { ok: false, reason: "app_id" })
  })
})

/* ---------- database: challenges and keys ---------- */

describe("challenges and keys (PGlite, migrations)", () => {
  let pg: PGlite
  let d: Db
  before(async () => {
    pg = new PGlite()
    const x = drizzle(pg)
    await migrate(x, { migrationsFolder: "drizzle" })
    d = x as unknown as Db
  })
  after(async () => pg.close())

  it("a challenge works once, for its purpose, and is stored only as a hash", async () => {
    const { challenge, expiresAt } = await issueChallenge(d, "request")
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/)
    assert.ok(expiresAt.getTime() - Date.now() > 4 * 60_000)
    const rows = await d.select().from(appAttestChallenges)
    assert.ok(rows.every((r) => r.hash !== challenge))
    assert.equal(await consumeChallenge(d, challenge, "register"), false, "another purpose")
    assert.equal(await consumeChallenge(d, challenge, "request"), true)
    assert.equal(await consumeChallenge(d, challenge, "request"), false, "single use")
    assert.equal(await consumeChallenge(d, "never-issued-challenge-000000", "request"), false)
  })
  it("an expired challenge is refused and swept", async () => {
    const past = new Date(Date.now() - 10 * 60_000)
    const { challenge } = await issueChallenge(d, "register", past)
    assert.equal(await consumeChallenge(d, challenge, "register"), false)
    await issueChallenge(d, "register")
    assert.equal((await d.select().from(appAttestChallenges).where(eq(appAttestChallenges.hash, sha256Hex(challenge)))).length, 0)
  })
  it("a registered key keeps its counter; the counter only moves up, once per value", async () => {
    const att = verifyAttestation({ attestation: Buffer.from(fixture.attestation, "base64"), keyId: fixture.keyId, challenge: fixture.challenge, appId: fixture.appId, environment: fixture.environment, rootPem: fixture.rootPem, now: FIXTURE_NOW })
    assert.ok(att.ok)
    if (!att.ok) return
    assert.equal(await saveKey(d, { keyId: fixture.keyId, publicKey: att.publicKeyPem, environment: "development", userId: null }), "created")
    assert.equal(await advanceCounter(d, fixture.keyId, 1, null), true)
    assert.equal(await advanceCounter(d, fixture.keyId, 1, null), false, "the same assertion twice")
    assert.equal(await advanceCounter(d, fixture.keyId, 0, null), false, "a lower counter")
    assert.equal(await saveKey(d, { keyId: fixture.keyId, publicKey: att.publicKeyPem, environment: "development", userId: null }), "exists")
    assert.equal((await getKey(d, fixture.keyId))?.counter, 1, "re-attesting never resets the counter")
    assert.equal(await advanceCounter(d, fixture.keyId, 3, null), true)
    assert.equal(await getKey(d, "missing"), null)
  })
})
