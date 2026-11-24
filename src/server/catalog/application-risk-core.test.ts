import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { riskFrom } from "./application-risk-core"

describe("application risk signals", () => {
  const submittedAt = new Date("2026-11-20T12:00:00Z")
  const old = new Date("2026-09-01T00:00:00Z")
  it("an established account with a normal email from a quiet network is low risk", () => {
    assert.deepEqual(riskFrom({ email: "ada@gmail.com", accountCreatedAt: old, submittedAt, sameIpAttempts: 1 }), { level: "low", reasons: [] })
  })
  it("each signal flags the application as risky, with its reason", () => {
    assert.equal(riskFrom({ email: "x@tempbox-mail.net", accountCreatedAt: old, submittedAt, sameIpAttempts: 0 }).level, "high")
    assert.equal(riskFrom({ email: "ada@gmail.com", accountCreatedAt: new Date(submittedAt.getTime() - 3_600_000), submittedAt, sameIpAttempts: 0 }).level, "high")
    const many = riskFrom({ email: "ada@gmail.com", accountCreatedAt: old, submittedAt, sameIpAttempts: 4 })
    assert.deepEqual(many, { level: "high", reasons: ["4 applications from the same network this week."] })
  })
})
