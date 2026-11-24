import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { rankBadgeLabel } from "./rank-label"

const best = { chart: "emerging" as const, period: "weekly" as const, scope: "global", rank: 3, label: "#3 on Emerging this week", href: "/charts?chart=emerging&period=weekly" }

describe("RankBadge label", () => {
  it("production (sample: false) shows the rank alone, never the word sample", () => {
    assert.equal(rankBadgeLabel({ best, sample: false }), "#3 on Emerging this week")
  })
  it("only the demo's sample baseline (sample: true) adds the sample suffix", () => {
    assert.equal(rankBadgeLabel({ best, sample: true }), "#3 on Emerging this week · sample")
  })
  it("no rank, no badge", () => {
    assert.equal(rankBadgeLabel({ sample: false }), null)
    assert.equal(rankBadgeLabel(undefined), null)
  })
})
