import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { adminProposalCreateBody, adminProposalReviseBody, studioProposalAcceptBody, studioProposalDeclineBody } from "./contracts"
import { applyChanges, changedSince, diffProposal, updateBodyOf, viewOf, type ProductView } from "../../lib/proposals"

const product = (over: Partial<ProductView> = {}): ProductView => ({
  title: "Danfo Hoodie",
  description: "Heavyweight fleece hoodie with a puff print.",
  details: [],
  categorySlug: "streetwear",
  subcategory: "Hoodies",
  tags: ["fleece"],
  badges: ["new"],
  priceMinor: 45000,
  compareAtMinor: null,
  processingDays: null,
  options: [{ name: "Size", values: [{ value: "M" }, { value: "L" }] }],
  variants: [
    { id: "pv_m", sku: "DANFO-M", options: { Size: "M" }, priceMinor: null },
    { id: "pv_l", sku: "DANFO-L", options: { Size: "L" }, priceMinor: null },
  ],
  images: [{ id: "pi_1", alt: "" }],
  collectionIds: [],
  stock: { pv_m: 4, pv_l: 2 },
  ...over,
})

const body = {
  title: "Danfo Hoodie",
  description: "Heavyweight fleece hoodie with a puff print.",
  categorySlug: "streetwear",
  subcategory: "Hoodies",
  priceMinor: 45000,
  variants: [{ sku: "DANFO-M", options: { Size: "M" } }],
}

describe("proposal diff", () => {
  it("keeps only the fields that change, with their values at proposal time", () => {
    const current = product()
    const proposed = product({ priceMinor: 39000, tags: ["Fleece ", "winter"], images: [{ id: "pi_1", alt: "Front view" }] })
    const d = diffProposal(current, proposed)
    assert.deepEqual(d.fields, ["tags", "priceMinor"])
    assert.equal(d.changes.priceMinor, 39000)
    assert.deepEqual(d.changes.tags, ["fleece", "winter"])
    assert.equal(d.base.priceMinor, 45000)
    // Alt text alone isn't a photo change.
    assert.equal("images" in d.changes, false)
  })

  it("treats the brand's default processing time as no change for a product without its own", () => {
    const d = diffProposal(product(), product({ processingDays: [3, 1] }), { defaultProcessing: [1, 3] })
    assert.deepEqual(d.fields, [])
    const e = diffProposal(product(), product({ processingDays: [2, 5] }), { defaultProcessing: [1, 3] })
    assert.deepEqual(e.changes.processingDays, [2, 5])
  })

  it("proposes stock as a change, only for variants that stay and only when non-zero", () => {
    const proposed = product({ variants: [product().variants[0]] })
    const d = diffProposal(product(), proposed, { stockDelta: { pv_m: 6, pv_l: 7, pv_gone: 2 } })
    assert.deepEqual(d.changes.stock, { pv_m: 6 })
    assert.deepEqual(d.base.stock, { pv_m: 4 })
    assert.ok(d.fields.includes("variants"))
    // The counts in the proposed view are ignored: only the change counts.
    assert.equal("stock" in diffProposal(product(), product({ stock: { pv_m: 10, pv_l: 9 } }), { stockDelta: { pv_m: 0 } }).changes, false)
  })

  it("doesn't count the key order of a colour value as a change", () => {
    const withColour = (values: { value: string; hex?: string }[]) => product({ options: [{ name: "Colour", values }] })
    assert.deepEqual(diffProposal(withColour([{ hex: "#111111", value: "Black" } as { value: string; hex?: string }]), withColour([{ value: "Black", hex: "#111111" }])).fields, [])
  })

  it("normalises SKUs and option order before comparing", () => {
    const proposed = product({ variants: [{ id: "pv_m", sku: " danfo-m ", options: { Size: "M" }, priceMinor: null }, { id: "pv_l", sku: "DANFO-L", options: { Size: "L" }, priceMinor: null }] })
    assert.deepEqual(diffProposal(product(), proposed).fields, [])
  })
})

describe("conflicts and apply", () => {
  it("flags a proposed field the brand changed after the proposal", () => {
    const d = diffProposal(product(), product({ priceMinor: 39000, title: "Danfo Hoodie II" }))
    assert.deepEqual(changedSince(d.base, product()), [])
    assert.deepEqual(changedSince(d.base, product({ priceMinor: 41000 })), ["priceMinor"])
    // A change to a field the proposal doesn't touch is not a conflict.
    assert.deepEqual(changedSince(d.base, product({ description: "New words for the description." })), [])
  })

  it("keeps sales made since: stock is never flagged and the change lands on the count now", () => {
    const d = diffProposal(product(), product(), { stockDelta: { pv_m: 6 } })
    const now = product({ stock: { pv_m: 3, pv_l: 2 } })
    assert.deepEqual(changedSince(d.base, now), [])
    assert.deepEqual(applyChanges(now, d.changes).stock, { pv_m: 9, pv_l: 2 })
    // Never below zero.
    assert.deepEqual(applyChanges(product({ stock: { pv_m: 1, pv_l: 2 } }), { stock: { pv_m: -4 } }).stock, { pv_m: 0, pv_l: 2 })
  })

  it("applies only the proposed fields over the product as it is now", () => {
    const d = diffProposal(product(), product({ priceMinor: 39000 }))
    const after = applyChanges(product({ description: "The brand rewrote this since." }), d.changes)
    assert.equal(after.priceMinor, 39000)
    assert.equal(after.description, "The brand rewrote this since.")
  })

  it("turns changes into a Studio update body and stock adjustments", () => {
    const d = diffProposal(product(), product({ priceMinor: 39000, images: [{ id: "pi_1", alt: "" }, { mediaId: "med_new", alt: "Back" }] }), { stockDelta: { pv_m: 3, pv_l: 0 } })
    const { body: b, stockDelta } = updateBodyOf(d.changes)
    assert.deepEqual(Object.keys(b).sort(), ["images", "priceMinor"])
    assert.deepEqual(b.images, [{ id: "pi_1", alt: "" }, { mediaId: "med_new", alt: "Back" }])
    assert.deepEqual(stockDelta, { pv_m: 3 })
  })

  it("builds a view from a form body with the server's defaults", () => {
    const v = viewOf({ ...body, variants: [{ sku: "danfo-m", options: { Size: "M" }, initialStock: 5 }] })
    assert.equal(v.compareAtMinor, null)
    assert.deepEqual(v.variants, [{ sku: "DANFO-M", options: { Size: "M" }, priceMinor: null, initialStock: 5 }])
    assert.deepEqual(v.images, [])
  })
})

describe("proposal contracts", () => {
  it("accepts a new-product and an edit suggestion", () => {
    assert.equal(adminProposalCreateBody.safeParse({ kind: "new", brandId: "b_1", product: body, note: "Ready for the winter drop" }).success, true)
    assert.equal(adminProposalCreateBody.safeParse({ kind: "edit", productId: "p_1", product: { ...body, stockDelta: { pv_m: -3 }, expectedVersion: 4 } }).success, true)
  })

  it("refuses unknown fields, a missing target, a drop or slug, and long notes", () => {
    assert.equal(adminProposalCreateBody.safeParse({ kind: "new", product: body }).success, false)
    assert.equal(adminProposalCreateBody.safeParse({ kind: "new", brandId: "b_1", product: { ...body, dropId: "d_1" } }).success, false)
    assert.equal(adminProposalCreateBody.safeParse({ kind: "new", brandId: "b_1", product: { ...body, slug: "danfo" } }).success, false)
    assert.equal(adminProposalCreateBody.safeParse({ kind: "new", brandId: "b_1", product: body, status: "published" }).success, false)
    assert.equal(adminProposalCreateBody.safeParse({ kind: "new", brandId: "b_1", product: body, note: "x".repeat(301) }).success, false)
    assert.equal(adminProposalCreateBody.safeParse({ kind: "edit", productId: "p_1", product: { ...body, stock: { pv_m: 3 } } }).success, false)
    assert.equal(adminProposalCreateBody.safeParse({ kind: "edit", productId: "p_1", product: { ...body, stockDelta: { pv_m: 1.5 } } }).success, false)
    assert.equal(adminProposalCreateBody.safeParse({ kind: "edit", productId: "p_1", product: { ...body, expectedVersion: 0 } }).success, false)
    assert.equal(adminProposalReviseBody.safeParse({ product: body, brandId: "b_2" }).success, false)
  })

  it("keeps the brand's answer small", () => {
    assert.equal(studioProposalAcceptBody.safeParse({}).success, true)
    assert.equal(studioProposalAcceptBody.safeParse({ product: body }).success, true)
    assert.equal(studioProposalAcceptBody.safeParse({ status: "accepted" }).success, false)
    assert.equal(studioProposalDeclineBody.safeParse({ reason: "We don't stock this colour." }).success, true)
    assert.equal(studioProposalDeclineBody.safeParse({ reason: "x".repeat(301) }).success, false)
  })
})
