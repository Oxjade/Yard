import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import {
  bachsAmountToMinor,
  bachsCorridorsFor,
  bachsMethodsFor,
  channelFromBachs,
  isPrivateOrigin,
  mapBachsChargeStatus,
  mapBachsRefundStatus,
  minorToBachsAmount,
  signBachsPayload,
  verifyBachsSignatureV2,
} from "./bachs-core"

/* ---------- Amounts ---------- */

test("minor units become a decimal string at the currency's precision", () => {
  assert.equal(minorToBachsAmount(7_500_000, "NGN"), "75000.00")
  assert.equal(minorToBachsAmount(2_900, "USD"), "29.00")
  assert.equal(minorToBachsAmount(1, "GHS"), "0.01")
  assert.equal(minorToBachsAmount(10, "KES"), "0.10")
  assert.equal(minorToBachsAmount(0, "USD"), "0.00")
  assert.equal(minorToBachsAmount(123_456_789_01, "NGN"), "123456789.01")
})

test("amount conversion refuses fractions, negatives and currencies Bachs can't charge", () => {
  assert.throws(() => minorToBachsAmount(1.5, "NGN"))
  assert.throws(() => minorToBachsAmount(-1, "NGN"))
  assert.throws(() => minorToBachsAmount(Number.NaN, "NGN"))
  assert.throws(() => minorToBachsAmount(100, "ZAR"))
})

test("Bachs decimal strings become minor units exactly", () => {
  assert.equal(bachsAmountToMinor("75000.00", "NGN"), 7_500_000)
  assert.equal(bachsAmountToMinor("19", "USD"), 1_900)
  assert.equal(bachsAmountToMinor("19.5", "USD"), 1_950)
  assert.equal(bachsAmountToMinor("0.01", "GHS"), 1)
  assert.equal(bachsAmountToMinor("100000.000000000000000000", "NGN"), 10_000_000)
  // A value that floats would round wrongly ("0.29" * 100 = 28.999…) stays exact.
  assert.equal(bachsAmountToMinor("0.29", "USD"), 29)
  assert.equal(bachsAmountToMinor("1234.57", "KES"), 123_457)
})

test("round trip is exact for every amount", () => {
  for (const n of [0, 1, 9, 10, 99, 100, 101, 2_999, 7_500_000, 999_999_999]) assert.equal(bachsAmountToMinor(minorToBachsAmount(n, "NGN"), "NGN"), n)
})

test("Bachs amounts that aren't whole minor units, or aren't amounts, are refused", () => {
  assert.throws(() => bachsAmountToMinor("19.005", "USD"))
  assert.throws(() => bachsAmountToMinor("-5.00", "USD"))
  assert.throws(() => bachsAmountToMinor("1e3", "USD"))
  assert.throws(() => bachsAmountToMinor("", "USD"))
  assert.throws(() => bachsAmountToMinor(null, "USD"))
  assert.throws(() => bachsAmountToMinor("12.00", "ZAR"))
})

/* ---------- Signatures ---------- */

const SECRET = "whsec_test_0123456789abcdef"
const BODY = '{"id":"evt_1","type":"collection.succeeded","data":{"amount":"75000.00"}}'
const NOW = 1_790_000_000

const digest = (secret: string, t: number, body: string) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")

test("a valid V2 signature verifies", () => {
  const header = `t=${NOW},v1=${digest(SECRET, NOW, BODY)}`
  assert.deepEqual(verifyBachsSignatureV2(BODY, header, [SECRET], { nowSec: NOW + 10 }), { ok: true })
  assert.equal(signBachsPayload(BODY, SECRET, NOW), header)
})

test("any matching v1 value is accepted (secret rotation sends two)", () => {
  const header = `t=${NOW},v1=${digest("whsec_old_secret_aaaaaaaa", NOW, BODY)},v1=${digest(SECRET, NOW, BODY)}`
  assert.deepEqual(verifyBachsSignatureV2(BODY, header, [SECRET], { nowSec: NOW }), { ok: true })
})

test("a tampered body or a wrong secret is refused", () => {
  const header = `t=${NOW},v1=${digest(SECRET, NOW, BODY)}`
  assert.deepEqual(verifyBachsSignatureV2(BODY.replace("75000.00", "1.00"), header, [SECRET], { nowSec: NOW }), { ok: false, reason: "mismatch" })
  assert.deepEqual(verifyBachsSignatureV2(BODY + " ", header, [SECRET], { nowSec: NOW }), { ok: false, reason: "mismatch" })
  assert.deepEqual(verifyBachsSignatureV2(BODY, header, ["whsec_some_other_secret_x"], { nowSec: NOW }), { ok: false, reason: "mismatch" })
  // The timestamp is part of what is signed: moving it breaks the signature.
  assert.deepEqual(verifyBachsSignatureV2(BODY, `t=${NOW + 1},v1=${digest(SECRET, NOW, BODY)}`, [SECRET], { nowSec: NOW }), { ok: false, reason: "mismatch" })
})

test("an expired (or far-future) timestamp is refused even with a valid digest", () => {
  const header = `t=${NOW},v1=${digest(SECRET, NOW, BODY)}`
  assert.deepEqual(verifyBachsSignatureV2(BODY, header, [SECRET], { nowSec: NOW + 301 }), { ok: false, reason: "expired" })
  assert.deepEqual(verifyBachsSignatureV2(BODY, header, [SECRET], { nowSec: NOW - 301 }), { ok: false, reason: "expired" })
  assert.deepEqual(verifyBachsSignatureV2(BODY, header, [SECRET], { nowSec: NOW + 300 }), { ok: true })
})

test("missing, malformed or unverifiable headers are refused", () => {
  assert.deepEqual(verifyBachsSignatureV2(BODY, null, [SECRET]), { ok: false, reason: "missing" })
  assert.deepEqual(verifyBachsSignatureV2(BODY, "", [SECRET]), { ok: false, reason: "missing" })
  assert.deepEqual(verifyBachsSignatureV2(BODY, digest(SECRET, NOW, BODY), [SECRET], { nowSec: NOW }), { ok: false, reason: "malformed" })
  assert.deepEqual(verifyBachsSignatureV2(BODY, `t=${NOW}`, [SECRET], { nowSec: NOW }), { ok: false, reason: "malformed" })
  assert.deepEqual(verifyBachsSignatureV2(BODY, `t=abc,v1=${digest(SECRET, NOW, BODY)}`, [SECRET], { nowSec: NOW }), { ok: false, reason: "malformed" })
  assert.deepEqual(verifyBachsSignatureV2(BODY, `t=${NOW},v1=zz`, [SECRET], { nowSec: NOW }), { ok: false, reason: "malformed" })
  assert.deepEqual(verifyBachsSignatureV2(BODY, `t=${NOW},v1=${digest(SECRET, NOW, BODY)}`, [], { nowSec: NOW }), { ok: false, reason: "no_secret" })
})

/* ---------- Statuses ---------- */

test("Bachs charge statuses map onto Yard's charge states", () => {
  assert.deepEqual(mapBachsChargeStatus("succeeded"), { status: "success", review: false })
  assert.deepEqual(mapBachsChargeStatus("SUCCEEDED"), { status: "success", review: false })
  assert.deepEqual(mapBachsChargeStatus("OVERPAID"), { status: "success", review: false })
  assert.deepEqual(mapBachsChargeStatus("accepted"), { status: "success", review: true })
  assert.deepEqual(mapBachsChargeStatus("partially_refunded"), { status: "success", review: false })
  assert.deepEqual(mapBachsChargeStatus("refunded"), { status: "success", review: false })
  assert.deepEqual(mapBachsChargeStatus("open"), { status: "pending", review: false })
  assert.deepEqual(mapBachsChargeStatus("underpaid"), { status: "pending", review: false })
  assert.deepEqual(mapBachsChargeStatus("processing"), { status: "pending", review: false })
  assert.deepEqual(mapBachsChargeStatus("incomplete"), { status: "failed", review: false })
  assert.deepEqual(mapBachsChargeStatus("FAILED"), { status: "failed", review: false })
  assert.deepEqual(mapBachsChargeStatus("EXPIRED"), { status: "failed", review: false })
  assert.deepEqual(mapBachsChargeStatus("something_new"), { status: "pending", review: false })
  assert.deepEqual(mapBachsChargeStatus(undefined), { status: "pending", review: false })
})

test("Bachs refund statuses map onto Yard's refund states", () => {
  assert.equal(mapBachsRefundStatus("processing"), "pending")
  assert.equal(mapBachsRefundStatus("success"), "succeeded")
  assert.equal(mapBachsRefundStatus("failed"), "failed")
  assert.equal(mapBachsRefundStatus(null), "pending")
})

/* ---------- Methods ---------- */

test("methods and corridors follow what Bachs takes in each currency", () => {
  assert.deepEqual(bachsMethodsFor("NGN"), ["card", "bank_transfer"])
  assert.deepEqual(bachsMethodsFor("USD"), ["card"])
  assert.deepEqual(bachsMethodsFor("GHS"), ["mobile_money"])
  assert.deepEqual(bachsMethodsFor("KES"), ["mobile_money"])
  assert.deepEqual(bachsMethodsFor("ZAR"), [])
  assert.deepEqual(bachsCorridorsFor("card", "NGN"), ["NGN_CARD"])
  assert.deepEqual(bachsCorridorsFor("bank_transfer", "NGN"), ["NGN_BANK_TRANSFER"])
  assert.deepEqual(bachsCorridorsFor("card", "USD"), ["USD_CARD"])
  assert.deepEqual(bachsCorridorsFor("mobile_money", "GHS"), ["MOMO_GHS"])
  assert.deepEqual(bachsCorridorsFor("mobile_money", "KES"), ["MOMO_KES"])
  assert.equal(bachsCorridorsFor("card", "GHS"), undefined)
  assert.equal(bachsCorridorsFor("ussd", "NGN"), undefined)
  assert.equal(bachsCorridorsFor(undefined, "NGN"), undefined)
  assert.equal(channelFromBachs("CARD"), "card")
  assert.equal(channelFromBachs("NGN_BANK_TRANSFER"), "bank_transfer")
  assert.equal(channelFromBachs(null, "bank_transfer"), "bank_transfer")
  assert.equal(channelFromBachs("MOMO_KES"), "mobile_money")
  assert.equal(channelFromBachs(null), null)
})

test("local and private origins are recognised (Bachs refuses them as return URLs)", () => {
  assert.equal(isPrivateOrigin("http://localhost:3000/x"), true)
  assert.equal(isPrivateOrigin("http://127.0.0.1:3200"), true)
  assert.equal(isPrivateOrigin("http://192.168.1.4"), true)
  assert.equal(isPrivateOrigin("http://10.0.0.2"), true)
  assert.equal(isPrivateOrigin("https://yard.example.com/checkout"), false)
  assert.equal(isPrivateOrigin("https://8.8.8.8"), false)
})
