import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeSearchQuery, searchQuery } from "./contracts"

describe("search query contract", () => {
  it("normalizes documented filters to the search service fields", () => {
    const query = searchQuery.parse({ brand: "b_demo", min: "100", max: "900", currency: "USD" })
    const filters = normalizeSearchQuery(query)

    assert.deepEqual(filters.brandIds, ["b_demo"])
    assert.equal(filters.minPrice, 100)
    assert.equal(filters.maxPrice, 900)
  })

  it("continues to accept the previous filter names", () => {
    const query = searchQuery.parse({ brandIds: ["b_demo", "b_other"], minPrice: "100", maxPrice: "900", currency: "USD" })
    const filters = normalizeSearchQuery(query)

    assert.deepEqual(filters.brandIds, ["b_demo", "b_other"])
    assert.equal(filters.minPrice, 100)
    assert.equal(filters.maxPrice, 900)
  })

  it("rejects conflicting canonical and legacy filters", () => {
    assert.equal(searchQuery.safeParse({ brand: "b_demo", brandIds: ["b_other"] }).success, false)
    assert.equal(searchQuery.safeParse({ min: "100", minPrice: "200" }).success, false)
  })
})