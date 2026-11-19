import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { brandPageVisibility, memberPreviewLine, opensSoonTitle, productPageVisibility, type VisibilityBrand, type VisibilityProduct } from "./page-visibility"

const now = new Date("2026-11-19T12:00:00Z")
const product = (over: Partial<VisibilityProduct> = {}): VisibilityProduct => ({ status: "published", publishAt: null, moderationStatus: "ok", ...over })
const ordinary: VisibilityBrand = { founding: false, launchedAt: null, reviewStatus: "approved" }
const unlaunched: VisibilityBrand = { founding: true, launchedAt: null, reviewStatus: "approved" }
const launched: VisibilityBrand = { founding: true, launchedAt: new Date("2026-11-01T00:00:00Z"), reviewStatus: "approved" }

describe("product page visibility", () => {
  it("a published piece of a launched founding brand (or an ordinary brand) shows normally", () => {
    assert.equal(productPageVisibility(product(), launched, now), "public")
    assert.equal(productPageVisibility(product(), ordinary, now), "public")
  })

  it("a published piece of a founding brand that hasn't launched shows opens-soon", () => {
    assert.equal(productPageVisibility(product(), unlaunched, now), "opens-soon")
    // Scheduled and due counts as published (before the job flips it).
    assert.equal(productPageVisibility(product({ status: "scheduled", publishAt: new Date("2026-11-19T11:00:00Z") }), unlaunched, now), "opens-soon")
  })

  it("a draft, archived or not-yet-due piece stays not-found, launched or not", () => {
    for (const brand of [unlaunched, launched, ordinary]) {
      assert.equal(productPageVisibility(product({ status: "draft" }), brand, now), "none")
      assert.equal(productPageVisibility(product({ status: "archived" }), brand, now), "none")
      assert.equal(productPageVisibility(product({ status: "scheduled", publishAt: new Date("2026-11-20T00:00:00Z") }), brand, now), "none")
      assert.equal(productPageVisibility(product({ status: "scheduled", publishAt: null }), brand, now), "none")
    }
  })

  it("a piece hidden by moderation stays not-found", () => {
    assert.equal(productPageVisibility(product({ moderationStatus: "hidden" }), unlaunched, now), "none")
    assert.equal(productPageVisibility(product({ moderationStatus: "hidden" }), launched, now), "none")
  })

  it("a restricted or suspended brand stays not-found, even before launch", () => {
    for (const reviewStatus of ["restricted", "suspended"]) {
      assert.equal(productPageVisibility(product(), { ...unlaunched, reviewStatus }, now), "none")
      assert.equal(productPageVisibility(product(), { ...launched, reviewStatus }, now), "none")
      assert.equal(productPageVisibility(product(), { ...ordinary, reviewStatus }, now), "none")
    }
  })

  it("a refused sample brand (production) stays not-found", () => {
    assert.equal(productPageVisibility(product(), { ...unlaunched, sample: true }, now), "none")
    assert.equal(productPageVisibility(product(), { ...ordinary, sample: true }, now), "none")
  })

  it("an unknown product or brand is not-found", () => {
    assert.equal(productPageVisibility(null, unlaunched, now), "none")
    assert.equal(productPageVisibility(product(), null, now), "none")
  })
})

describe("brand page visibility", () => {
  it("launched founding and ordinary brands show normally; unlaunched founding brands open soon", () => {
    assert.equal(brandPageVisibility(launched), "public")
    assert.equal(brandPageVisibility(ordinary), "public")
    assert.equal(brandPageVisibility(unlaunched), "opens-soon")
  })

  it("restricted, suspended, sample and unknown brands stay not-found", () => {
    assert.equal(brandPageVisibility({ ...unlaunched, reviewStatus: "restricted" }), "none")
    assert.equal(brandPageVisibility({ ...unlaunched, reviewStatus: "suspended" }), "none")
    assert.equal(brandPageVisibility({ ...launched, reviewStatus: "suspended" }), "none")
    assert.equal(brandPageVisibility({ ...unlaunched, sample: true }), "none")
    assert.equal(brandPageVisibility(undefined), "none")
  })
})

describe("opens-soon copy", () => {
  it("names the brand and the piece", () => {
    assert.equal(opensSoonTitle("Ascension"), "Ascension opens soon on Yard")
    assert.equal(memberPreviewLine("Halo Tee"), "Only you can see this. Your shop isn't live yet, so shoppers can't see Halo Tee.")
  })
})
