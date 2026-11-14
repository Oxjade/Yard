import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { accountEmailBody, accountNameBody, signUpBody } from "./contracts"

describe("account name and email contracts", () => {
  it("validates the name exactly like sign-up", () => {
    for (const name of ["Ada", "  Ada Obi  ", "Zoë O'Neil-Smith", "x".repeat(80), "", "   ", "x".repeat(81), "Ada <b>", "Ada\u0007"]) {
      const a = accountNameBody.safeParse({ name })
      const b = signUpBody.safeParse({ name, email: "a@example.com", password: "Correct-horse-battery-9" })
      assert.equal(a.success, b.success, `name ${JSON.stringify(name)}`)
    }
    assert.equal(accountNameBody.parse({ name: "  Ada Obi  " }).name, "Ada Obi")
  })

  it("takes the new email and an optional current password, nothing else", () => {
    assert.equal(accountEmailBody.safeParse({ email: "new@example.com" }).success, true)
    assert.equal(accountEmailBody.safeParse({ email: "new@example.com", currentPassword: "pw" }).success, true)
    assert.equal(accountEmailBody.safeParse({ email: "not-an-email" }).success, false)
    assert.equal(accountEmailBody.safeParse({ email: "new@example.com", userId: "u_1" }).success, false)
  })
})
