import { test } from "node:test"
import assert from "node:assert/strict"
import { accountRefusalReason } from "./refusal"

const live = "Bachs POST /v1/checkout-sessions: ACCOUNT_NOT_ACTIVATED: This account is not yet approved to accept live payments."

test("the live Bachs answer is an account refusal", () => {
  const r = accountRefusalReason({ definitive: true, httpStatus: 403, code: "ACCOUNT_NOT_ACTIVATED", message: live })
  assert.match(r ?? "", /not yet approved/)
})

test("a rejected key is an account refusal", () => {
  assert.match(accountRefusalReason({ definitive: true, httpStatus: 401, message: "Bachs POST: HTTP 401" }) ?? "", /key/)
})

test("network failures and 5xx are not", () => {
  assert.equal(accountRefusalReason({ definitive: false, message: "Bachs unreachable: fetch failed" }), null)
  assert.equal(accountRefusalReason({ definitive: false, httpStatus: 503, code: "ACCOUNT_NOT_ACTIVATED", message: "x" }), null)
})

test("a refused order (bad amount) is not an account problem", () => {
  assert.equal(accountRefusalReason({ definitive: true, httpStatus: 422, code: "INVALID_AMOUNT", message: "amount too small" }), null)
})
