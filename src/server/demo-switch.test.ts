import assert from "node:assert/strict"
import { test } from "node:test"
import { seedDemoFrom } from "./demo-switch"

test("demo switch: on in development and test, off in production unless YARD_SEED_DEMO=1", () => {
  assert.equal(seedDemoFrom({ NODE_ENV: "development" }), true)
  assert.equal(seedDemoFrom({ NODE_ENV: "test" }), true)
  assert.equal(seedDemoFrom({}), true)
  assert.equal(seedDemoFrom({ NODE_ENV: "production" }), false)
  assert.equal(seedDemoFrom({ NODE_ENV: "production", YARD_SEED_DEMO: "0" }), false)
  assert.equal(seedDemoFrom({ NODE_ENV: "production", YARD_SEED_DEMO: "" }), false)
  assert.equal(seedDemoFrom({ NODE_ENV: "production", YARD_SEED_DEMO: "1" }), true)
  assert.equal(seedDemoFrom({ NODE_ENV: "production", YARD_SEED_DEMO: " 1 " }), true)
})
