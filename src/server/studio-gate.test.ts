import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { seedDemoFrom } from "./demo-switch"
import { BRAND_SESSION_COOKIES, safeStudioNext, studioGateRedirect, studioSignInHref } from "../lib/studio-gate"

/* Brand Studio's front door (src/proxy.ts → studio-gate.ts): signed out in production, a Studio page
 * redirects to the Studio sign-in with the page as ?next=; the demo and development pass through. */

const production = seedDemoFrom({ NODE_ENV: "production" })
const demo = seedDemoFrom({ NODE_ENV: "production", YARD_SEED_DEMO: "1" })
const dev = seedDemoFrom({ NODE_ENV: "development" })

describe("Studio gate (proxy)", () => {
  it("anonymous /studio/settings redirects to the Studio sign-in in production, with the page as next", () => {
    assert.equal(production, false)
    assert.equal(studioGateRedirect({ path: "/studio/settings", search: "", seedDemo: production, hasBrandCookie: false }), "/studio/sign-in?next=%2Fstudio%2Fsettings")
    assert.equal(studioGateRedirect({ path: "/studio/payouts", search: "?tab=history", seedDemo: production, hasBrandCookie: false }), "/studio/sign-in?next=%2Fstudio%2Fpayouts%3Ftab%3Dhistory")
    assert.equal(studioGateRedirect({ path: "/studio", search: "", seedDemo: production, hasBrandCookie: false }), "/studio/sign-in")
    for (const path of ["/studio/orders", "/studio/orders/or_1", "/studio/products/new", "/studio/storefront", "/studio/analytics", "/studio/customers", "/studio/coming-soon/promotions"])
      assert.match(studioGateRedirect({ path, search: "", seedDemo: production, hasBrandCookie: false }) ?? "", /^\/studio\/sign-in\?next=/, path)
  })

  it("still works in the demo and in development: nothing is redirected", () => {
    for (const seedDemo of [demo, dev]) {
      assert.equal(seedDemo, true)
      assert.equal(studioGateRedirect({ path: "/studio/settings", search: "", seedDemo, hasBrandCookie: false }), null)
      assert.equal(studioGateRedirect({ path: "/studio/payouts", search: "", seedDemo, hasBrandCookie: false }), null)
    }
  })

  it("serves a request that carries the brand session cookie (the page re-checks the session itself)", () => {
    assert.equal(studioGateRedirect({ path: "/studio/settings", search: "", seedDemo: production, hasBrandCookie: true }), null)
    assert.deepEqual([...BRAND_SESSION_COOKIES], ["yard_b", "__Host-yard_b"])
  })

  it("keeps the public entry pages open: sign-in and apply/onboarding", () => {
    for (const path of ["/studio/sign-in", "/studio/onboarding", "/studio/onboarding/x"]) assert.equal(studioGateRedirect({ path, search: "", seedDemo: production, hasBrandCookie: false }), null, path)
    // A look-alike prefix is not the public page.
    assert.match(studioGateRedirect({ path: "/studio/onboardingx", search: "", seedDemo: production, hasBrandCookie: false }) ?? "", /^\/studio\/sign-in/)
    // Outside Studio the gate never answers.
    assert.equal(studioGateRedirect({ path: "/studios", search: "", seedDemo: production, hasBrandCookie: false }), null)
    assert.equal(studioGateRedirect({ path: "/admin/brands", search: "", seedDemo: production, hasBrandCookie: false }), null)
  })

  it("returns only to Studio pages on this origin after sign-in", () => {
    assert.equal(safeStudioNext("/studio/settings"), "/studio/settings")
    assert.equal(safeStudioNext("/studio/settings?claimed=1#payouts"), "/studio/settings?claimed=1#payouts")
    for (const bad of [null, "", "https://evil.example/studio", "//evil.example/studio", "/\\evil", "/admin", "/studio/sign-in?next=/studio", "/studiox"]) assert.equal(safeStudioNext(bad), "/studio", String(bad))
    assert.equal(studioSignInHref("/studio/settings"), "/studio/sign-in?next=%2Fstudio%2Fsettings")
  })
})
