import assert from "node:assert/strict"
import { createVerify, generateKeyPairSync } from "node:crypto"
import test from "node:test"
import { buildAssertion, buildFcmMessage, fcmSendUrl, fcmTokenGone, FCM_SCOPE, parseServiceAccount, pushPath, tokenCacheMs, tokenRequestBody } from "./fcm-core"

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
const keyFile = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "service_account", project_id: "yard-test", client_email: "push@yard-test.iam.gserviceaccount.com", private_key: pem, token_uri: "https://oauth2.googleapis.com/token", ...over })

test("a service-account file gives the project, email and key", () => {
  const sa = parseServiceAccount(keyFile())
  assert.ok(sa)
  assert.equal(sa.projectId, "yard-test")
  assert.equal(sa.clientEmail, "push@yard-test.iam.gserviceaccount.com")
  assert.equal(parseServiceAccount("not json"), null)
  assert.equal(parseServiceAccount(keyFile({ type: "authorized_user" })), null)
  assert.equal(parseServiceAccount(keyFile({ project_id: "" })), null)
  assert.equal(parseServiceAccount(keyFile({ token_uri: "https://evil.example/token" })), null)
})

test("the JWT assertion is RS256-signed with the scope, audience and an hour's lifetime", () => {
  const sa = parseServiceAccount(keyFile())!
  const jwt = buildAssertion(sa, 1_800_000_000)
  const [h, c, s] = jwt.split(".")
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" })
  const claims = JSON.parse(Buffer.from(c, "base64url").toString())
  assert.deepEqual(claims, { iss: sa.clientEmail, scope: FCM_SCOPE, aud: "https://oauth2.googleapis.com/token", iat: 1_800_000_000, exp: 1_800_003_600 })
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url")))
  const form = new URLSearchParams(tokenRequestBody(jwt))
  assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer")
  assert.equal(form.get("assertion"), jwt)
})

test("access tokens are cached until five minutes before they expire", () => {
  assert.equal(tokenCacheMs(3599), 3299_000)
  assert.equal(tokenCacheMs(120), 60_000)
  assert.equal(tokenCacheMs(Number.NaN), 3300_000)
})

test("the FCM message carries the notification, its link and the Android channel", () => {
  const m = buildFcmMessage("tok", { id: "nt_1", kind: "delivery_update", title: "Shipped", body: "Arrives soon.", url: "/orders/abc" })
  assert.deepEqual(m, {
    message: {
      token: "tok",
      notification: { title: "Shipped", body: "Arrives soon." },
      data: { url: "/orders/abc", kind: "delivery_update", id: "nt_1" },
      android: { priority: "high", notification: { channel_id: "yard_updates", color: "#F5FF00", tag: "nt_1" } },
    },
  })
  assert.equal(fcmSendUrl("yard-test"), "https://fcm.googleapis.com/v1/projects/yard-test/messages:send")
  const long = buildFcmMessage("tok", { id: "x", kind: "k", title: "t".repeat(500), body: "b".repeat(500), url: "/" })
  assert.equal(long.message.notification.title.length, 120)
  assert.equal(long.message.notification.body.length, 240)
})

test("push links are Yard paths only", () => {
  assert.equal(pushPath("/orders/abc"), "/orders/abc")
  assert.equal(pushPath(null), "/")
  assert.equal(pushPath(null, "/studio"), "/studio")
  assert.equal(pushPath("https://evil.example/"), "/")
  assert.equal(pushPath("//evil.example/"), "/")
})

test("dead tokens are recognised from FCM's error", () => {
  assert.equal(fcmTokenGone(404, null), true)
  assert.equal(fcmTokenGone(400, { error: { status: "INVALID_ARGUMENT" } }), true)
  assert.equal(fcmTokenGone(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), true)
  assert.equal(fcmTokenGone(403, { error: { status: "PERMISSION_DENIED", details: [{ errorCode: "UNREGISTERED" }] } }), true)
  assert.equal(fcmTokenGone(500, { error: { status: "INTERNAL" } }), false)
  assert.equal(fcmTokenGone(429, { error: { status: "RESOURCE_EXHAUSTED", details: [{ errorCode: "QUOTA_EXCEEDED" }] } }), false)
})
