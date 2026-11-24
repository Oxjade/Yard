import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { brandEmailSendBody } from "./api/contracts/brand-emails"
import {
  BRAND_EMAIL_PRESETS,
  DRAFT_NUDGE_AFTER_MS,
  NUDGE_COOLDOWN_MS,
  applicationRejectedCopy,
  bodyParagraphs,
  brandEmailPresets,
  brandMessageCopy,
  draftNudgeCopy,
  draftNudgeEligible,
  groupDraftNudges,
  listingBackCopy,
  listingHeldCopy,
  listingState,
  storefrontNudgeCopy,
  storefrontNudgeEligible,
  type BrandEmailCopy,
  type DraftCandidate,
  type StorefrontCandidate,
} from "./brand-emails"

const HOUR = 3600_000
const now = new Date("2026-11-15T12:00:00Z")
const ago = (ms: number) => new Date(now.getTime() - ms)

const draft = (over: Partial<DraftCandidate> = {}): DraftCandidate => ({
  productId: "p_1",
  brandId: "b_narcisista",
  title: "Thorn Tee",
  status: "draft",
  createdAt: ago(13 * HOUR),
  publishedAt: null,
  draftNudgedAt: null,
  moderation: "ok",
  brandReview: "verified",
  brandNudges: true,
  claimStatus: "claimed",
  claimedAt: null,
  approvedAt: null,
  underReview: false,
  brandLastNudgedAt: null,
  storefrontUnpublished: true,
  ...over,
})

const store = (over: Partial<StorefrontCandidate> = {}): StorefrontCandidate => ({
  brandId: "b_narcisista",
  founding: true,
  claimStatus: "claimed",
  claimedAt: ago(30 * HOUR),
  launchedAt: null,
  storefrontNudgedAt: null,
  brandReview: "pending_review",
  brandNudges: true,
  brandLastNudgedAt: null,
  readyProducts: 2,
  ...over,
})

/** Emoji in a copy's visible text (subject, heading, paragraphs). */
const emoji = (c: BrandEmailCopy) => [c.subject, c.heading, ...c.paragraphs].join(" ").match(/\p{Extended_Pictographic}/gu)?.length ?? 0

describe("draft reminder rules", () => {
  it("a founding brand's drafts wait 12 hours after the claim, not after Yard prepared them", () => {
    // Yard set the draft up days ago; the brand claimed an hour ago.
    const c = draft({ createdAt: ago(5 * 24 * HOUR), claimedAt: ago(HOUR) })
    assert.equal(draftNudgeEligible(c, now), false)
    assert.equal(draftNudgeEligible(c, new Date(now.getTime() + 11 * HOUR + 1)), true)
    assert.equal(draftNudgeEligible(draft({ createdAt: ago(5 * 24 * HOUR), claimedAt: ago(13 * HOUR) }), now), true)
  })
  it("a product saved with an application waits 12 hours after approval, not after submission", () => {
    // Submitted with the application two days ago, approved 20 minutes ago.
    const c = draft({ createdAt: ago(48 * HOUR), approvedAt: ago(HOUR / 3) })
    assert.equal(draftNudgeEligible(c, now), false)
    assert.equal(groupDraftNudges([c], now).length, 0)
    assert.equal(draftNudgeEligible(draft({ createdAt: ago(48 * HOUR), approvedAt: ago(12 * HOUR) }), now), true)
    // A draft created after approval runs on its own clock.
    assert.equal(draftNudgeEligible(draft({ createdAt: ago(2 * HOUR), approvedAt: ago(30 * 24 * HOUR) }), now), false)
  })
  it("a draft left 12 hours is due; one left 11 hours isn't", () => {
    assert.equal(draftNudgeEligible(draft(), now), true)
    assert.equal(draftNudgeEligible(draft({ createdAt: ago(DRAFT_NUDGE_AFTER_MS) }), now), true)
    assert.equal(draftNudgeEligible(draft({ createdAt: ago(11 * HOUR) }), now), false)
  })
  it("never twice for the same product, never once it was published", () => {
    assert.equal(draftNudgeEligible(draft({ draftNudgedAt: ago(HOUR) }), now), false)
    assert.equal(draftNudgeEligible(draft({ publishedAt: ago(2 * HOUR) }), now), false)
    assert.equal(draftNudgeEligible(draft({ status: "published" }), now), false)
    assert.equal(draftNudgeEligible(draft({ status: "archived" }), now), false)
  })
  it("skips restricted, suspended, under review, opted out, unclaimed and hidden", () => {
    for (const over of [{ brandReview: "restricted" }, { brandReview: "suspended" }, { underReview: true }, { brandNudges: false }, { claimStatus: "unclaimed" }, { moderation: "hidden" }] as Partial<DraftCandidate>[])
      assert.equal(draftNudgeEligible(draft(over), now), false, JSON.stringify(over))
  })
  it("leaves month-old drafts alone and respects the brand's daily cooldown", () => {
    assert.equal(draftNudgeEligible(draft({ createdAt: ago(31 * 24 * HOUR) }), now), false)
    assert.equal(draftNudgeEligible(draft({ brandLastNudgedAt: ago(NUDGE_COOLDOWN_MS - HOUR) }), now), false)
    assert.equal(draftNudgeEligible(draft({ brandLastNudgedAt: ago(NUDGE_COOLDOWN_MS + HOUR) }), now), true)
  })
  it("groups one reminder per brand, oldest draft first, skipping what isn't due", () => {
    const groups = groupDraftNudges(
      [
        draft({ productId: "p_2", title: "Rose Hoodie", createdAt: ago(20 * HOUR) }),
        draft({ productId: "p_1", title: "Thorn Tee", createdAt: ago(40 * HOUR) }),
        draft({ productId: "p_3", title: "Too fresh", createdAt: ago(2 * HOUR) }),
        draft({ productId: "p_9", brandId: "b_other", title: "Cap", storefrontUnpublished: false }),
        draft({ productId: "p_1", title: "Thorn Tee", createdAt: ago(40 * HOUR) }),
      ],
      now,
    )
    assert.deepEqual(
      groups.map((g) => [g.brandId, g.products.map((p) => p.id), g.storefrontUnpublished]),
      [
        ["b_narcisista", ["p_1", "p_2"], true],
        ["b_other", ["p_9"], false],
      ],
    )
  })
})

describe("storefront reminder rules", () => {
  it("a claimed founding brand with ready products, a day after claiming, once", () => {
    assert.equal(storefrontNudgeEligible(store(), now), true)
    assert.equal(storefrontNudgeEligible(store({ claimedAt: ago(10 * HOUR) }), now), false)
    assert.equal(storefrontNudgeEligible(store({ storefrontNudgedAt: ago(HOUR) }), now), false)
    assert.equal(storefrontNudgeEligible(store({ launchedAt: ago(HOUR) }), now), false)
  })
  it("not without ready products, not unclaimed or ordinary brands, not when opted out or on hold", () => {
    for (const over of [{ readyProducts: 0 }, { claimStatus: "unclaimed" }, { founding: false, claimStatus: "none" }, { brandNudges: false }, { brandReview: "suspended" }, { brandLastNudgedAt: ago(HOUR) }] as Partial<StorefrontCandidate>[])
      assert.equal(storefrontNudgeEligible(store(over), now), false, JSON.stringify(over))
  })
})

describe("brand email copy", () => {
  it("draft reminder names the product, deep-links to it and carries the opt-out", () => {
    const c = draftNudgeCopy({ brand: "Narcisista", product: "Thorn Tee", productId: "p_1", storefrontUnpublished: true })
    assert.equal(c.subject, "Your Thorn Tee is chilling in drafts")
    assert.equal(c.action?.url, "/studio/products/p_1")
    assert.match(c.paragraphs.join(" "), /storefront isn't published yet/)
    assert.equal(c.footerLink?.url, "/studio/settings#emails")
    const many = draftNudgeCopy({ brand: "Narcisista", product: "Thorn Tee", productId: "p_1", more: 3, others: ["Rose Hoodie", "Cap"] })
    assert.equal(many.subject, "Your Thorn Tee (and 3 more) are chilling in drafts")
    assert.equal(many.facts?.[1].value, "Rose Hoodie, Cap and 1 more")
    assert.doesNotMatch(draftNudgeCopy({ brand: "N", product: "T" }).paragraphs.join(" "), /storefront/)
  })
  it("rejection quotes the reason and says what to do next", () => {
    const c = applicationRejectedCopy({ brand: "Narcisista", name: "Ada Obi", reason: "The first product needs clearer photos." })
    assert.equal(c.greeting, "Hey Ada,")
    assert.ok(c.paragraphs.some((p) => p.includes("“The first product needs clearer photos.”")))
    assert.equal(c.action?.url, "/studio/onboarding")
    assert.equal(applicationRejectedCopy({ brand: "Narcisista" }).paragraphs.some((p) => p.includes("said")), false)
  })
  it("listing paused and back link to the product in Studio", () => {
    const held = listingHeldCopy({ brand: "Narcisista", product: "Thorn Tee", productId: "p_1", reason: "Photos show another brand's logo." })
    assert.equal(held.action?.url, "/studio/products/p_1")
    assert.ok(held.paragraphs.some((p) => p.startsWith("Why: “Photos")))
    assert.equal(listingBackCopy({ brand: "Narcisista", product: "Thorn Tee", productId: "p_1" }).subject, "Thorn Tee is back on Yard 🎉")
  })
  it("every email keeps to one emoji, and none is in a rejection", () => {
    const all = [
      draftNudgeCopy({ brand: "N", product: "T" }),
      storefrontNudgeCopy({ brand: "N", products: 2 }),
      applicationRejectedCopy({ brand: "N", reason: "x" }),
      listingHeldCopy({ brand: "N", product: "T", reason: "x" }),
      listingBackCopy({ brand: "N", product: "T" }),
      ...BRAND_EMAIL_PRESETS.map((p) => brandMessageCopy({ brand: "N", preset: p, subject: brandEmailPresets[p].subject("N"), body: brandEmailPresets[p].body("N") || "Hello there, friend." })),
    ]
    for (const c of all) assert.ok(emoji(c) <= 1, c.subject)
    assert.equal(emoji(applicationRejectedCopy({ brand: "N", reason: "x" })), 0)
    assert.equal(emoji(listingHeldCopy({ brand: "N", product: "T" })), 0)
  })
})

describe("listing decision emails follow where the listing stands", () => {
  const base = { status: "published", publishAt: null, brandReview: "verified", founding: false, launchedAt: null }
  it("listingState: live, unpublished, unlaunched storefront, restricted brand", () => {
    assert.equal(listingState(base, now), "live")
    assert.equal(listingState({ ...base, status: "draft" }, now), "unpublished")
    assert.equal(listingState({ ...base, status: "scheduled", publishAt: new Date(now.getTime() + HOUR) }, now), "unpublished")
    assert.equal(listingState({ ...base, status: "scheduled", publishAt: ago(HOUR) }, now), "live")
    assert.equal(listingState({ ...base, founding: true }, now), "storefront")
    assert.equal(listingState({ ...base, founding: true, launchedAt: ago(HOUR) }, now), "live")
    assert.equal(listingState({ ...base, brandReview: "restricted" }, now), "brand")
    assert.equal(listingState({ ...base, status: "draft", brandReview: "suspended" }, now), "brand")
  })
  it("only a live listing is \"back on Yard\"; a draft hears the hold is lifted", () => {
    const live = listingBackCopy({ brand: "N", product: "Thorn Tee", productId: "p_1", state: "live" })
    assert.equal(live.subject, "Thorn Tee is back on Yard 🎉")
    for (const state of ["unpublished", "storefront", "brand"] as const) {
      const c = listingBackCopy({ brand: "N", product: "Thorn Tee", productId: "p_1", state })
      assert.equal(c.subject, "The hold on Thorn Tee is lifted", state)
      const text = [c.subject, c.preheader, ...c.paragraphs].join(" ")
      assert.equal(/back on Yard|buy it/.test(text), false, state)
      assert.equal(emoji(c), 0, state)
    }
    assert.ok(listingBackCopy({ brand: "N", product: "T", state: "unpublished" }).paragraphs.some((p) => p.includes("publish it in Studio")))
    assert.equal(listingBackCopy({ brand: "N", product: "T", state: "storefront" }).action?.url, "/studio/storefront")
  })
  it("a held draft is \"on hold\", not \"isn't showing on Yard for now\"", () => {
    const c = listingHeldCopy({ brand: "N", product: "Thorn Tee", productId: "p_1", reason: "x", wasLive: false })
    assert.equal(c.subject, "Thorn Tee is on hold for now")
    assert.ok(c.paragraphs[0].includes("can't go live for now"))
    assert.equal(c.paragraphs.join(" ").includes("isn't showing on Yard"), false)
  })
  it("one email covers several listings of one brand: first named, the rest counted", () => {
    const held = listingHeldCopy({ brand: "N", product: "Thorn Tee", productId: "p_1", more: 9, others: ["Rose Cap", "Vine Hoodie"], reason: "Counterfeit logos.", wasLive: true })
    assert.equal(held.subject, "Thorn Tee and 9 more are taking a quick break from Yard")
    assert.equal(held.heading, "Listings on pause")
    assert.equal(held.action?.url, "/studio/products")
    assert.deepEqual(held.facts, [{ label: "Products", value: "Thorn Tee, Rose Cap, Vine Hoodie and 7 more" }])
    assert.equal(listingBackCopy({ brand: "N", product: "Thorn Tee", more: 1, others: ["Rose Cap"], state: "live" }).subject, "Thorn Tee and 1 more are back on Yard 🎉")
  })
})

describe("admin one-tap emails", () => {
  it("every preset fills a subject and a body that pass the send rules (custom starts empty)", () => {
    for (const p of BRAND_EMAIL_PRESETS) {
      const def = brandEmailPresets[p]
      const r = brandEmailSendBody.safeParse({ preset: p, subject: def.subject("Narcisista"), body: def.body("Narcisista"), idempotencyKey: "key-12345678" })
      assert.equal(r.success, p !== "custom", p)
      assert.ok(def.action.url.startsWith("/studio"), p)
    }
  })
  it("refuses an empty body, a long subject, hidden characters and unknown fields", () => {
    const ok = { preset: "custom", subject: "A quick note", body: "Hey, loving the drop so far!", idempotencyKey: "key-12345678" }
    assert.equal(brandEmailSendBody.safeParse(ok).success, true)
    assert.equal(brandEmailSendBody.safeParse({ ...ok, body: "   " }).success, false)
    assert.equal(brandEmailSendBody.safeParse({ ...ok, subject: "x".repeat(121) }).success, false)
    assert.equal(brandEmailSendBody.safeParse({ ...ok, subject: "Hi\u0000" }).success, false)
    assert.equal(brandEmailSendBody.safeParse({ ...ok, to: "someone@else.com" }).success, false)
    assert.equal(brandEmailSendBody.safeParse({ ...ok, preset: "spam" }).success, false)
  })
  it("the payout preset says the shop can take orders now (founding or not) and the account is how Yard pays", () => {
    const body = brandEmailPresets.payout_account.body("N")
    assert.match(body, /^Your shop can take orders now, but there's no payout account on file yet/)
    assert.match(body, /Add one so Yard can pay you\./)
    assert.doesNotMatch(body, /nearly ready to sell|Buy stays off|so shoppers can buy/)
  })

  it("splits the message into paragraphs on blank lines and signs it with the admin's first name", () => {
    assert.deepEqual(bodyParagraphs("One\nline\n\n\nTwo\r\n\r\nThree  "), ["One line", "Two", "Three"])
    const c = brandMessageCopy({ brand: "Narcisista", preset: "payout_account", subject: " Let's get Narcisista paid ", body: "First.\n\nSecond.", signoff: "Tolu Ade" })
    assert.equal(c.subject, "Let's get Narcisista paid")
    assert.equal(c.greeting, "Hey Narcisista,")
    assert.deepEqual(c.paragraphs, ["First.", "Second."])
    assert.equal(c.action?.url, "/studio/settings#payouts")
    assert.match(c.note ?? "", /^Tolu from the Yard team\./)
  })
})
