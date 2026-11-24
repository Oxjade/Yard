import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { canonicalEmail, DISPOSABLE_EMAIL_MESSAGE, emailDomainProblem, emailLooksThrowaway } from "./email-policy"

describe("email policy", () => {
  it("refuses throwaway inboxes, their subdomains and mailinator-style names", () => {
    for (const e of ["bot@mailinator.com", "x@sub.mailinator.com", "a@guerrillamail.com", "a@yopmail.com", "a@10minutemail.com", "a@mailinator-clone.xyz", "A@MAILINATOR.COM "]) {
      assert.equal(emailDomainProblem(e), DISPOSABLE_EMAIL_MESSAGE, e)
    }
  })
  it("refuses reserved and test domains", () => {
    for (const e of ["a@example.com", "a@example.org", "a@shop.test", "a@foo.invalid", "a@localhost", "a@box.localhost", "a@intranet", "a@", "no-at-sign"]) {
      assert.equal(emailDomainProblem(e), DISPOSABLE_EMAIL_MESSAGE, e)
    }
  })
  it("accepts ordinary addresses", () => {
    for (const e of ["ada@gmail.com", "kemi@yahoo.com", "orders@lagos-static.ng", "team@studio.co.uk", "me@proton.me"]) assert.equal(emailDomainProblem(e), null, e)
  })
  it("normalises one mailbox for duplicate detection", () => {
    assert.equal(canonicalEmail(" A.Da+shop@Gmail.com "), "ada@gmail.com")
    assert.equal(canonicalEmail("a.da@googlemail.com"), "ada@gmail.com")
    assert.equal(canonicalEmail("kemi.a+x@yahoo.com"), "kemi.a@yahoo.com")
  })
  it("flags throwaway-looking domains for the review queue", () => {
    assert.equal(emailLooksThrowaway("x@tempbox-mail.net"), true)
    assert.equal(emailLooksThrowaway("x@mail20240101.com"), true)
    assert.equal(emailLooksThrowaway("ada@gmail.com"), false)
  })
})
