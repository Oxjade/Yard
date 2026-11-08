import assert from "node:assert/strict"
import test from "node:test"
import { decideResend, matchProviderRefund, refundEventChange, refundIdFromNote, refundNote, type ProviderRefund } from "./refund-recovery"

const created = new Date("2026-11-08T10:00:00Z")
const rf = (attempts: number) => ({ id: "rf_t_v3_checkout_a1", amountMinor: 30_000, currency: "NGN", attempts, createdAt: created })
const pr = (o: Partial<ProviderRefund>): ProviderRefund => ({ id: "991", transactionId: "555", amountMinor: 30_000, currency: "NGN", status: "pending", note: null, createdAt: new Date(created.getTime() + 5_000), ...o })
const ctx = { transactionId: "555", takenRefs: new Set<string>() }
const never = async (): Promise<ProviderRefund[]> => {
  throw new Error("the first attempt must not look anything up")
}

test("first attempt sends without a lookup", async () => {
  assert.deepEqual(await decideResend(rf(0), never, ctx), { action: "send" })
})

test("a retry after an unknown outcome adopts the refund Paystack already created (no second POST /refund)", async () => {
  const d = await decideResend(rf(1), async () => [pr({ note: refundNote("Damaged item", "rf_t_v3_checkout_a1") })], ctx)
  assert.deepEqual(d, { action: "adopt", providerRef: "991", status: "pending" })
})

test("a retry adopts an untagged refund on the same transaction for the same amount", async () => {
  assert.equal((await decideResend(rf(2), async () => [pr({})], ctx)).action, "adopt")
})

test("a retry never resends blind: lookup failure (timeout, 5xx, no keys) waits", async () => {
  const d = await decideResend(rf(1), async () => {
    throw new Error("Paystack unreachable: timeout")
  }, ctx)
  assert.equal(d.action, "wait")
})

test("a retry sends again only when Paystack has no matching refund", async () => {
  assert.deepEqual(await decideResend(rf(1), async () => [], ctx), { action: "send" })
  // A different amount, another Yard refund's tag, a refund another row already holds, an older or failed one: not ours.
  const others = [pr({ id: "1", amountMinor: 10_000 }), pr({ id: "2", note: "x [yard:rf_other]" }), pr({ id: "3" }), pr({ id: "4", createdAt: new Date(created.getTime() - 3_600_000) }), pr({ id: "5", status: "failed" }), pr({ id: "6", transactionId: "777" })]
  assert.deepEqual(await decideResend(rf(1), async () => others, { transactionId: "555", takenRefs: new Set(["3"]) }), { action: "send" })
})

test("without the Paystack transaction id only the note tag can match", () => {
  assert.equal(matchProviderRefund(rf(1), [pr({})], { transactionId: null, takenRefs: new Set() }), null)
  assert.equal(matchProviderRefund(rf(1), [pr({ note: refundNote("r", "rf_t_v3_checkout_a1") })], { transactionId: null, takenRefs: new Set() })?.id, "991")
})

test("the merchant note keeps the refund id whole within Paystack's 200 characters", () => {
  const n = refundNote("x".repeat(500), "rf_t_v3_checkout_a1")
  assert.ok(n.length <= 200)
  assert.equal(refundIdFromNote(n), "rf_t_v3_checkout_a1")
  assert.equal(refundIdFromNote(null), null)
})

test("refund.pending / refund.processing for a pending row records the provider reference", () => {
  assert.deepEqual(refundEventChange({ status: "pending", providerRef: null }, "pending", "991"), { kind: "ref", providerRef: "991" })
  assert.deepEqual(refundEventChange({ status: "pending", providerRef: "991" }, "pending", "991"), { kind: "none" })
  assert.deepEqual(refundEventChange({ status: "pending", providerRef: null }, "succeeded", "991"), { kind: "final" })
  assert.deepEqual(refundEventChange({ status: "succeeded", providerRef: "991" }, "failed", "991"), { kind: "ignored" })
})
