import { test } from "node:test"
import assert from "node:assert/strict"
import { isPlacedOrderId } from "./order-ids"

test("placed-order ids: server-minted or_* and pre-v2 mo_cg_* pass, anything else fails", () => {
  assert.equal(isPlacedOrderId("or_mhovq2k1Ab3_x-9Z"), true)
  assert.equal(isPlacedOrderId("mo_cg_k3x9_1"), true)
  assert.equal(isPlacedOrderId("or_"), false)
  assert.equal(isPlacedOrderId("or_short"), false)
  assert.equal(isPlacedOrderId("or_../../etc/passwd"), false)
  assert.equal(isPlacedOrderId("mo_lagos_static_901x"), false)
  assert.equal(isPlacedOrderId("cg_mhovq2k1Ab3_x-9Z"), false)
})
