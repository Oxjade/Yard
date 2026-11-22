import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { socialUrl, yardSocials, yardSocialWarnings } from "./socials"

describe("Yard's own social profiles", () => {
  it("hides every network when nothing is set", () => {
    assert.deepEqual(yardSocials({}), [])
    assert.deepEqual(yardSocialWarnings({ YARD_SOCIAL_X: "  " }), [])
  })

  it("keeps configured https URLs in display order", () => {
    const s = yardSocials({ YARD_SOCIAL_LINKEDIN: "https://www.linkedin.com/company/yard", YARD_SOCIAL_INSTAGRAM: " https://www.instagram.com/yard ", YARD_SOCIAL_X: "https://twitter.com/yard" })
    assert.deepEqual(s.map((x) => x.key), ["instagram", "x", "linkedin"])
    assert.equal(s[0].href, "https://www.instagram.com/yard")
    assert.equal(s[0].label, "Instagram")
  })

  it("drops anything that isn't https on the network's own domain, with a warning", () => {
    assert.equal(socialUrl("http://instagram.com/yard", ["instagram.com"]), null)
    assert.equal(socialUrl("instagram.com/yard", ["instagram.com"]), null)
    assert.equal(socialUrl("https://instagram.com.evil.example/yard", ["instagram.com"]), null)
    assert.equal(socialUrl("https://notinstagram.com/yard", ["instagram.com"]), null)
    assert.equal(socialUrl("javascript:alert(1)", ["instagram.com"]), null)
    assert.equal(socialUrl("https://user:pw@instagram.com/yard", ["instagram.com"]), null)
    assert.equal(socialUrl("https://m.youtube.com/@yard", ["youtube.com"]), "https://m.youtube.com/@yard")
    const w = yardSocialWarnings({ YARD_SOCIAL_TIKTOK: "@yard" })
    assert.equal(w.length, 1)
    assert.match(w[0], /YARD_SOCIAL_TIKTOK must be a full https URL/)
    assert.deepEqual(yardSocials({ YARD_SOCIAL_TIKTOK: "@yard" }), [])
  })
})
