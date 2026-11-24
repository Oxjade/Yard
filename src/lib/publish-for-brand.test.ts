import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { shopLiveCopy, brandEmailHistoryLabels } from "./brand-emails"
import {
  acceptEachSuggestion,
  claimGoLivePlan,
  CLAIM_GOES_LIVE_COPY,
  EMPTY_SHOP_WARNING,
  GO_LIVE_ON_CLAIM_DEFAULT,
  PAYOUT_NUDGE_COPY,
  PAYOUT_TO_GET_PAID_COPY,
  publishChecklist,
  publishForBrandBlock,
  publishForBrandLabel,
  publishForBrandOutcome,
  shopDisplay,
  showPublishForBrand,
  suggestionStillFits,
  type PublishForBrandFacts,
} from "./publish-for-brand"

const facts = (over: Partial<PublishForBrandFacts> = {}): PublishForBrandFacts => ({
  name: "Lagos Static",
  founding: true,
  claimStatus: "claimed",
  reviewStatus: "verified",
  underReview: false,
  published: false,
  logo: true,
  banner: true,
  intro: true,
  liveProducts: 3,
  ...over,
})

describe("publish for brand: checklist", () => {
  it("ticks logo, banner and intro and counts live products", () => {
    const c = publishChecklist(facts())
    assert.deepEqual(
      c.items.map((i) => [i.key, i.done, i.value]),
      [
        ["logo", true, undefined],
        ["banner", true, undefined],
        ["intro", true, undefined],
        ["products", true, "3"],
      ],
    )
    assert.equal(c.warning, null)
  })

  it("warns, but doesn't block, with 0 live products", () => {
    const f = facts({ liveProducts: 0, logo: false })
    const c = publishChecklist(f)
    assert.equal(c.warning, EMPTY_SHOP_WARNING)
    assert.equal(EMPTY_SHOP_WARNING, "Shop will show as empty")
    assert.equal(c.items.find((i) => i.key === "products")?.value, "0")
    assert.equal(c.items.find((i) => i.key === "logo")?.done, false)
    assert.deepEqual(publishForBrandOutcome(f), { kind: "publish" })
  })

  it("names the button after the brand", () => {
    assert.equal(publishForBrandLabel("Lagos Static"), "Publish storefront for Lagos Static")
  })
})

describe("publish for brand: rules", () => {
  it("publishes a claimed brand's unpublished storefront", () => {
    assert.deepEqual(publishForBrandOutcome(facts()), { kind: "publish" })
  })

  it("allows an unclaimed founding brand (Yard already launches those through Yard setup)", () => {
    assert.deepEqual(publishForBrandOutcome(facts({ claimStatus: "unclaimed" })), { kind: "publish" })
  })

  it("allows an ordinary approved brand", () => {
    assert.deepEqual(publishForBrandOutcome(facts({ founding: false, claimStatus: "none" })), { kind: "publish" })
  })

  it("is a no-op once a storefront version exists (idempotent), and the button hides", () => {
    assert.deepEqual(publishForBrandOutcome(facts({ published: true })), { kind: "already" })
    // Even a brand restricted since: nothing to do, nothing to refuse.
    assert.deepEqual(publishForBrandOutcome(facts({ published: true, reviewStatus: "restricted" })), { kind: "already" })
    assert.equal(showPublishForBrand({ published: true }), false)
    assert.equal(showPublishForBrand({ published: false }), true)
  })

  it("refuses restricted, suspended and under-review brands, like the brand's own publish", () => {
    assert.match(publishForBrandBlock(facts({ reviewStatus: "restricted" }))!, /restricted Lagos Static/)
    assert.match(publishForBrandBlock(facts({ reviewStatus: "suspended" }))!, /suspended Lagos Static/)
    assert.match(publishForBrandBlock(facts({ underReview: true }))!, /isn't approved yet/)
    assert.equal(publishForBrandOutcome(facts({ underReview: true })).kind, "blocked")
    assert.equal(publishForBrandBlock(facts()), null)
  })
})

describe("go live when they claim", () => {
  it("is on for new founding brands", () => {
    assert.equal(GO_LIVE_ON_CLAIM_DEFAULT, true)
  })

  it("does nothing with the switch off", () => {
    assert.deepEqual(claimGoLivePlan({ goLiveOnClaim: false, published: false }), { publish: false, acceptSuggestions: false })
  })

  it("publishes and accepts suggestions with the switch on", () => {
    assert.deepEqual(claimGoLivePlan({ goLiveOnClaim: true, published: false }), { publish: true, acceptSuggestions: true })
  })

  it("doesn't publish twice when Yard already published the shop", () => {
    assert.deepEqual(claimGoLivePlan({ goLiveOnClaim: true, published: true }), { publish: false, acceptSuggestions: true })
  })

  it("accepts every suggestion that passes and leaves a failing one pending, without throwing", async () => {
    // A tiny store with the transactional contract acceptProposal has: a failure changes nothing.
    const store = new Map<string, { status: string; valid: boolean }>([
      ["pp_1", { status: "pending", valid: true }],
      ["pp_2", { status: "pending", valid: false }],
      ["pp_3", { status: "pending", valid: true }],
    ])
    const accept = async (id: string) => {
      const row = store.get(id)!
      if (!row.valid) throw new Error("Add at least one photo.")
      row.status = "accepted"
      return { productId: `p_${id}`, published: true }
    }
    const r = await acceptEachSuggestion([...store.keys()], accept)
    assert.deepEqual(
      r.accepted.map((a) => a.id),
      ["pp_1", "pp_3"],
    )
    assert.deepEqual(r.skipped, [{ id: "pp_2", reason: "Add at least one photo." }])
    assert.equal(store.get("pp_2")!.status, "pending")
    assert.equal(store.get("pp_1")!.status, "accepted")
    assert.equal(store.get("pp_3")!.status, "accepted")
  })

  it("keeps going when every suggestion fails", async () => {
    const r = await acceptEachSuggestion(["a", "b"], async () => {
      throw new Error("nope")
    })
    assert.equal(r.accepted.length, 0)
    assert.equal(r.skipped.length, 2)
  })

  it("accepts an edit only against the product version it was suggested for", () => {
    assert.equal(suggestionStillFits({ kind: "new", baseVersion: null }, null), true)
    assert.equal(suggestionStillFits({ kind: "edit", baseVersion: 4 }, 4), true)
    assert.equal(suggestionStillFits({ kind: "edit", baseVersion: 4 }, 5), false)
    assert.equal(suggestionStillFits({ kind: "edit", baseVersion: 4 }, null), false)
  })

  it("says so on the claim page", () => {
    assert.equal(CLAIM_GOES_LIVE_COPY, "Your shop goes live the moment you claim it. Change anything later in Studio.")
  })
})

describe("you're live email", () => {
  const base = { brand: "Lagos Static", handle: "lagos-static", shop: shopDisplay("https://yardstore.space", "lagos-static"), payout: true }

  it("reads the shop link like a person would", () => {
    assert.equal(base.shop, "yardstore.space/brands/lagos-static")
  })

  it("Yard published it", () => {
    const c = shopLiveCopy({ ...base, variant: "yard" })
    assert.equal(c.subject, "Lagos Static, your shop is live on Yard 🎉")
    assert.equal(c.heading, "You're live 🎉")
    assert.deepEqual(c.paragraphs, ["We put your shop live for you, so shoppers can find you now."])
    assert.deepEqual(c.action, { label: "See my shop", url: "/brands/lagos-static" })
    const text = c.linkParagraphs!.map((p) => p.map((r) => r.text).join("")).join("\n")
    assert.match(text, /Your shop: yardstore\.space\/brands\/lagos-static/)
    assert.match(text, /Change anything in Studio anytime\./)
    assert.doesNotMatch(text, /payout/)
  })

  it("adds the payout line and link when there's no payout account: the shop already takes orders", () => {
    const c = shopLiveCopy({ ...base, variant: "yard", payout: false })
    const last = c.linkParagraphs!.at(-1)!
    assert.equal(last[0].text.trim(), PAYOUT_TO_GET_PAID_COPY)
    assert.equal(PAYOUT_TO_GET_PAID_COPY, "Your shop can take orders now. One thing left: add your payout account so Yard can pay you. Takes about 2 minutes.")
    assert.equal(last[1].href, "/studio/settings#payouts")
  })

  it("says Buy waits for the payout account only for a founding brand (lib/sell-rule.ts)", () => {
    const c = shopLiveCopy({ ...base, variant: "claim", payout: false, buyNeedsPayout: true })
    assert.equal(c.linkParagraphs!.at(-1)![0].text.trim(), PAYOUT_NUDGE_COPY)
    assert.equal(PAYOUT_NUDGE_COPY, "One thing left: add your payout account so shoppers can buy. Takes about 2 minutes.")
  })

  it("claim variant", () => {
    const c = shopLiveCopy({ ...base, variant: "claim" })
    assert.equal(c.subject, "You claimed Lagos Static and you're live 🎉")
    assert.equal(c.heading, "You're live 🎉")
  })

  it("shows in Sent lately", () => {
    assert.ok(brandEmailHistoryLabels["brand.storefront_published_by_yard"])
    assert.ok(brandEmailHistoryLabels["founding.claim_went_live"])
  })
})
