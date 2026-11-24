import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adminSectionAllowed } from "./admin-sections"

describe("Control Center sections by role", () => {
  it("Finance is for owners and finance only", () => {
    assert.equal(adminSectionAllowed("/admin/finance", "owner"), true)
    assert.equal(adminSectionAllowed("/admin/finance", "finance"), true)
    for (const role of ["support", "trust_safety", "ads_ops", "engineering"] as const) assert.equal(adminSectionAllowed("/admin/finance/payouts", role), false)
  })
  it("sections follow the navigation's permissions", () => {
    assert.equal(adminSectionAllowed("/admin/support", "support"), true)
    assert.equal(adminSectionAllowed("/admin/support", "ads_ops"), false)
    assert.equal(adminSectionAllowed("/admin/newsletter/compose", "ads_ops"), true)
    assert.equal(adminSectionAllowed("/admin/newsletter", "finance"), false)
    assert.equal(adminSectionAllowed("/admin/health", "support"), false)
  })
  it("unlisted sections are open to every admin role (their APIs check each permission)", () => {
    assert.equal(adminSectionAllowed("/admin", "support"), true)
    assert.equal(adminSectionAllowed("/admin/brands", "finance"), true)
    assert.equal(adminSectionAllowed("/admin/no-access", "ads_ops"), true)
  })
})
