import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { brandHidden, listingGuide, listingPill, listingSteps, nextActionLabel, QUICK_ADD_HREF, SHOP_SETUP_HREF, type ListingFacts } from "./listing-guide"

const facts = (over: Partial<ListingFacts> = {}): ListingFacts => ({ products: 0, live: 0, focus: null, founding: false, launched: false, payoutAccount: false, logo: false, banner: false, shopPublished: false, ...over })
const shopDone = { logo: true, banner: true, shopPublished: true }
const keys = (f: ListingFacts, showPayout = true) => listingSteps(f, { showPayout }).map((s) => s.key)
const doneKeys = (f: ListingFacts, showPayout = true) => listingSteps(f, { showPayout }).filter((s) => s.done).map((s) => s.key)

describe("listing guide steps", () => {
  it("a brand with nothing gets every step open, all leading to Quick add", () => {
    const steps = listingSteps(facts(), { showPayout: true })
    assert.deepEqual(steps.map((s) => s.key), ["photos", "basics", "stock", "publish", "look", "shop", "payout"])
    assert.equal(steps.filter((s) => s.done).length, 0)
    for (const s of steps.slice(0, 4)) assert.equal(s.href, QUICK_ADD_HREF)
    assert.equal(steps[4].href, SHOP_SETUP_HREF)
    assert.equal(steps[5].href, `${SHOP_SETUP_HREF}?step=review`)
    assert.equal(steps[6].href, "/studio/settings#payouts")
  })

  it("a draft left behind ticks what it has and deep-links into that product", () => {
    const f = facts({ products: 1, focus: { id: "p_abc", title: "Mesh tee", images: 2, stock: 0 } })
    assert.deepEqual(doneKeys(f), ["photos", "basics"])
    const steps = listingSteps(f, { showPayout: false })
    assert.equal(steps.find((s) => s.key === "stock")!.href, "/studio/products/p_abc#variants-panel")
    assert.equal(steps.find((s) => s.key === "publish")!.href, "/studio/products/p_abc#publishing-panel")
  })

  it("the narcisista case: a complete draft is one step from done, and the step is Publish", () => {
    const f = facts({ products: 1, focus: { id: "p_n", title: "Narcisista tee", images: 3, stock: 12 }, payoutAccount: true, ...shopDone })
    const guide = listingGuide(f, { showPayout: true })
    assert.equal(guide.next?.key, "publish")
    assert.equal(guide.done, guide.total - 1)
    assert.equal(nextActionLabel(guide, f), "Publish Narcisista tee")
  })

  it("anything live ticks the four product steps", () => {
    const f = facts({ products: 3, live: 1, focus: { id: "p_x", title: "x", images: 0, stock: 0 }, ...shopDone })
    assert.deepEqual(doneKeys(f, false), ["photos", "basics", "stock", "publish", "look", "shop"])
    assert.equal(listingGuide(f, { showPayout: false }).complete, true)
  })

  it("a founding brand's shop counts only once launched; an ordinary brand's once published", () => {
    const live = facts({ founding: true, live: 1, products: 1, ...shopDone })
    assert.equal(listingGuide(live, { showPayout: false }).complete, false)
    assert.equal(listingGuide(live, { showPayout: false }).next?.key, "shop")
    assert.match(listingSteps(live, { showPayout: false }).find((s) => s.key === "shop")!.body, /Founding/)
    assert.equal(listingGuide({ ...live, launched: true }, { showPayout: false }).complete, true)
    const ordinary = facts({ live: 1, products: 1, logo: true, banner: true })
    assert.equal(listingGuide(ordinary, { showPayout: false }).next?.key, "shop")
    assert.equal(listingGuide({ ...ordinary, shopPublished: true }, { showPayout: false }).complete, true)
  })

  it("logo & banner needs both", () => {
    const f = facts({ live: 1, products: 1, logo: true, shopPublished: true })
    assert.equal(listingGuide(f, { showPayout: false }).next?.key, "look")
    assert.equal(nextActionLabel(listingGuide(f, { showPayout: false }), f), "Set up your shop")
    assert.equal(listingGuide({ ...f, banner: true }, { showPayout: false }).complete, true)
  })

  it("the payout step shows only to people who can see payouts", () => {
    assert.ok(!keys(facts(), false).includes("payout"))
    const f = facts({ live: 1, products: 1, payoutAccount: false, ...shopDone })
    assert.equal(listingGuide(f, { showPayout: true }).next?.key, "payout")
    assert.equal(listingGuide({ ...f, payoutAccount: true }, { showPayout: true }).complete, true)
  })

  it("products but no focus (all archived) points Publish at the products list", () => {
    const f = facts({ products: 2, focus: null })
    assert.equal(listingSteps(f, { showPayout: false }).find((s) => s.key === "publish")!.href, "/studio/products")
  })

  it("the main button names the next move", () => {
    assert.equal(nextActionLabel(listingGuide(facts(), { showPayout: false }), facts()), "Start with Quick add")
    const long = facts({ products: 1, focus: { id: "p", title: "A very long product name for a tee", images: 1, stock: 1 } })
    assert.equal(nextActionLabel(listingGuide(long, { showPayout: false }), long), "Publish your draft")
    const noPhotos = facts({ products: 1, focus: { id: "p", title: "Tee", images: 0, stock: 1 } })
    assert.equal(nextActionLabel(listingGuide(noPhotos, { showPayout: false }), noPhotos), "Finish your draft")
  })
})

describe("draft vs live pill", () => {
  it("never lets a draft read as listed", () => {
    assert.equal(listingPill("draft").label, "Draft: only you can see this")
    assert.equal(listingPill("draft").tone, "draft")
  })
  it("published is live only when the brand is visible", () => {
    assert.equal(listingPill("published").label, "Live on Yard")
    assert.equal(listingPill("published", { hidden: true }).tone, "waiting")
    assert.match(listingPill("published", { hidden: true }).label, /storefront/)
  })
  it("scheduled and archived say they aren't live", () => {
    assert.equal(listingPill("scheduled").tone, "waiting")
    assert.equal(listingPill("archived").tone, "archived")
  })
  it("brandHidden is founding and not launched", () => {
    assert.equal(brandHidden(facts({ founding: true })), true)
    assert.equal(brandHidden(facts({ founding: true, launched: true })), false)
    assert.equal(brandHidden(facts()), false)
    assert.equal(brandHidden(null), false)
  })
})
