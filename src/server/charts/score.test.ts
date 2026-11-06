import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { coordinatedRing, detectAll, ipConcentration, orderAnomaly, type ChartEvent } from "./detect"
import {
  boosted,
  effectiveWeights,
  emergingFactor,
  momentum,
  movementFor,
  percentiles,
  qualityFactor,
  SALES_CAP,
  salesShare,
  scoreBrands,
  scoreDrops,
  WEIGHTS,
  type BrandInput,
  type Metrics,
} from "./score"

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0)
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

/** Every subset of a list (for "any combination of missing metrics"). */
const subsets = <T>(list: T[]): T[][] => list.reduce<T[][]>((acc, x) => [...acc, ...acc.map((s) => [...s, x])], [[]])

const metrics = (m: Partial<Metrics> = {}): Metrics => ({ O: 5, G: 50_000, F: 20, WL: 30, V: 400, R: 0, E: 6, RP: 0.2, DS: null, ...m })
const brand = (id: string, over: Partial<BrandInput> = {}): BrandInput => ({
  id,
  joinedAt: "2026-03-01",
  ageDays: 200,
  followersBase: 20_000,
  liveNetFollows: 0,
  w: metrics(),
  prev: metrics(),
  fraud: { excluded: 0, counted: 1000 },
  ...over,
})

describe("weights", () => {
  for (const [board, table] of Object.entries(WEIGHTS)) {
    it(`${board} weights sum to 1`, () => assert.ok(close(sum(table), 1), `${board} sums to ${sum(table)}`))
    it(`${board} gives sales at most a quarter`, () => assert.ok(salesShare(table) <= SALES_CAP + 1e-12, `${board} sales ${salesShare(table)}`))
  }

  it("keeps sales at or under 0.25 and the sum at 1 whatever metrics are missing", () => {
    for (const [board, table] of Object.entries(WEIGHTS)) {
      for (const missing of subsets(Object.keys(table))) {
        if (missing.length === Object.keys(table).length) continue
        const w = effectiveWeights(table, (k) => !missing.includes(k))
        assert.ok(close(sum(w), 1), `${board} without ${missing} sums to ${sum(w)}`)
        const others = Object.keys(w).some((k) => !["O", "G", "gO"].includes(k))
        if (others) assert.ok(salesShare(w) <= SALES_CAP + 1e-9, `${board} without ${missing}: sales ${salesShare(w)}`)
      }
    }
  })

  it("renormalises a missing drop metric instead of scoring it as zero", () => {
    const w = effectiveWeights(WEIGHTS.top, (k) => k !== "DS")
    assert.equal(w.DS, undefined)
    assert.ok(close(w.F, 0.15 / 0.95 * ((1 - SALES_CAP) / (1 - 0.25 / 0.95))))
  })
})

describe("transforms", () => {
  it("averages ties in percentile ranks and gives 1 to a lone brand", () => {
    assert.deepEqual(percentiles([3, 1, 2]), [1, 0, 0.5])
    assert.deepEqual(percentiles([5, 5, 1]), [0.75, 0.75, 0])
    assert.deepEqual(percentiles([7]), [1])
    assert.deepEqual(percentiles([null, 2, 4]), [null, 0, 1])
  })

  it("clamps momentum to [−1, 3]", () => {
    assert.equal(momentum(1000, 0), 3)
    assert.equal(momentum(0, 1000), -0.9900990099009901)
    assert.equal(momentum(0, 10_000), -0.999000999000999)
    assert.equal(momentum(20, 10), 0.5)
  })

  it("caps the fraud penalty at half", () => {
    assert.equal(qualityFactor(0, 100), 1)
    assert.equal(qualityFactor(25, 75), 0.75)
    assert.equal(qualityFactor(90, 10), 0.5)
    assert.equal(qualityFactor(0, 0), 1)
  })
})

describe("emerging boost", () => {
  it("applies only under 30k followers and within 548 days", () => {
    assert.ok(emergingFactor(9_000, 100) > 0)
    assert.equal(emergingFactor(30_000, 100), 0)
    assert.equal(emergingFactor(48_210, 100), 0)
    assert.equal(emergingFactor(9_000, 549), 0)
    assert.ok(boosted(0.5, "top", 9_000, 100) > 0.5)
    assert.equal(boosted(0.5, "top", 30_000, 100), 0.5)
    assert.equal(boosted(0.5, "top", 52_000, 100), 0.5)
    assert.ok(boosted(0.5, "trending", 9_000, 100) - 0.5 > boosted(0.5, "top", 9_000, 100) - 0.5, "trending boosts more")
  })

  it("never boosts Emerging, Most followed or Most wishlisted", () => {
    for (const board of ["emerging", "most_followed", "most_wishlisted"] as const) assert.equal(boosted(0.5, board, 1_000, 10), 0.5)
  })

  it("lifts a small brand past an identical big one on Top", () => {
    const ranked = scoreBrands("top", [brand("b_big", { followersBase: 60_000 }), brand("b_small", { followersBase: 6_000 })])
    assert.equal(ranked[0].id, "b_small")
  })
})

describe("boards", () => {
  it("never ranks Top by sales alone: a sales-only leader loses to a broadly engaged brand", () => {
    const seller = brand("b_seller", { w: metrics({ O: 500, G: 9_000_000, F: 1, V: 50, WL: 1, E: 0 }) })
    const loved = brand("b_loved", { w: metrics({ O: 2, G: 10_000, F: 300, V: 5_000, WL: 400, E: 40 }) })
    const third = brand("b_third", { w: metrics({ O: 3, G: 20_000, F: 20, V: 300, WL: 20, E: 5 }) })
    assert.equal(scoreBrands("top", [seller, loved, third])[0].id, "b_loved")
  })

  it("leaves out brands with no orders and under 10 views on Top", () => {
    const ranked = scoreBrands("top", [brand("b_a"), brand("b_quiet", { w: metrics({ O: 0, V: 9 }) })])
    assert.deepEqual(
      ranked.map((r) => r.id),
      ["b_a"],
    )
  })

  it("only lets young, small brands onto Emerging", () => {
    const ranked = scoreBrands("emerging", [brand("b_young"), brand("b_big", { followersBase: 31_000 }), brand("b_old", { ageDays: 600 })])
    assert.deepEqual(
      ranked.map((r) => r.id),
      ["b_young"],
    )
  })

  it("ranks Most followed by net new followers, ties by total followers", () => {
    const ranked = scoreBrands("most_followed", [brand("b_a", { w: metrics({ F: 10 }), followersBase: 1_000 }), brand("b_b", { w: metrics({ F: 10 }), followersBase: 9_000 }), brand("b_c", { w: metrics({ F: 40 }) })])
    assert.deepEqual(
      ranked.map((r) => r.id),
      ["b_c", "b_b", "b_a"],
    )
  })

  it("lowers a brand whose signals were excluded as fraud", () => {
    const clean = brand("b_clean")
    const dirty = brand("b_dirty", { fraud: { excluded: 600, counted: 400 } })
    const ranked = scoreBrands("top", [dirty, clean])
    assert.equal(ranked[0].id, "b_clean")
    assert.equal(ranked[1].components.Q, 0.5)
  })

  it("scores released drops on sell-through and upcoming drops on reminders", () => {
    const ranked = scoreDrops([
      { id: "d_sold", brandId: "b_a", joinedAt: "2026-01-01", phase: "released", sellThrough: 0.95, R: 10, V: 300, velocity: 20 },
      { id: "d_slow", brandId: "b_b", joinedAt: "2026-01-01", phase: "released", sellThrough: 0.1, R: 10, V: 300, velocity: 1 },
      { id: "d_soon", brandId: "b_c", joinedAt: "2026-01-01", phase: "upcoming", sellThrough: 0, R: 900, V: 500, velocity: 0 },
    ])
    assert.equal(ranked[ranked.length - 1].id, "d_slow")
  })
})

describe("movement", () => {
  it("reads up, down, same, new and re-entry", () => {
    assert.deepEqual(movementFor(3, { rank: 5, peak: 2, editionsOnChart: 4 }, null), { movement: "up", delta: 2, prevRank: 5, peak: 2, editionsOnChart: 5 })
    assert.equal(movementFor(6, { rank: 5, peak: 5, editionsOnChart: 1 }, null).movement, "down")
    assert.equal(movementFor(5, { rank: 5, peak: 5, editionsOnChart: 1 }, null).movement, "same")
    assert.deepEqual(movementFor(9, null, null), { movement: "new", delta: 0, prevRank: null, peak: 9, editionsOnChart: 1 })
    assert.deepEqual(movementFor(4, null, { rank: 7, peak: 3, editionsOnChart: 2 }), { movement: "reentry", delta: 0, prevRank: null, peak: 3, editionsOnChart: 3 })
  })
})

/* ── Detectors on synthetic events ───────────────────────────────────────── */

let seq = 0
const T0 = Date.parse("2026-11-05T21:00:00Z")
const ev = (over: Partial<ChartEvent>): ChartEvent => ({
  seq: ++seq,
  brandId: "b_a",
  productId: null,
  dropId: null,
  kind: "follow",
  actorId: "u_1",
  accountAgeDays: 120,
  ipHash: null,
  day: "2026-11-05",
  at: T0,
  verdict: "counted",
  ...over,
})

describe("order_anomaly", () => {
  it("fires on three orders from one customer and brand in a day", () => {
    const events = [0, 1, 2].map((i) => ev({ kind: "order_placed", actorId: "u_9", at: T0 + i * 60_000 }))
    const found = orderAnomaly(events, ["2026-11-05"])
    assert.equal(found.length, 1)
    assert.equal(found[0].detector, "order_anomaly")
    assert.equal(found[0].severity, "medium")
    assert.equal(found[0].evidence.rule, "repeat_customer")
    assert.deepEqual(found[0].eventSeqs.sort(), events.map((e) => e.seq).sort())
  })

  it("fires on five orders with more than 40 % cancelled within 24 hours", () => {
    const orders = [1, 2, 3, 4, 5].map((i) => ev({ kind: "order_placed", actorId: `u_${i}`, at: T0 + i * 1000 }))
    const cancels = [1, 2, 3].map((i) => ev({ kind: "order_cancelled", actorId: `u_${i}`, at: T0 + 3_600_000 }))
    const found = orderAnomaly([...orders, ...cancels], ["2026-11-05"])
    assert.equal(found.length, 1)
    assert.equal(found[0].evidence.rule, "cancelled_share")
    assert.equal(found[0].eventSeqs.length, 3)
  })

  it("stays quiet on ordinary orders", () => {
    const orders = [1, 2, 3, 4, 5].map((i) => ev({ kind: "order_placed", actorId: `u_${i}` }))
    const late = ev({ kind: "order_cancelled", actorId: "u_1", at: T0 + 2 * 86_400_000 })
    assert.deepEqual(orderAnomaly([...orders, late, ev({ kind: "order_placed", actorId: "u_9" }), ev({ kind: "order_placed", actorId: "u_9" })], ["2026-11-05"]), [])
  })
})

describe("coordinated_ring and ip_concentration", () => {
  // 40 accounts a day old, on two IPs, each following three brands within ten minutes.
  const ring: ChartEvent[] = []
  for (let i = 0; i < 40; i++) {
    for (const [j, b] of ["b_pr", "b_ac", "b_da"].entries()) ring.push(ev({ brandId: b, actorId: `u_x${i}`, accountAgeDays: 0, ipHash: i < 25 ? "aaaa1111bbbb" : "cccc2222dddd", at: T0 + i * 14_000 + j * 1000, verdict: i % 25 < 3 ? "counted" : "excluded_fraud" }))
  }

  it("flags every brand the ring followed as high", () => {
    const found = coordinatedRing(ring, ["2026-11-05"])
    assert.deepEqual(found.map((f) => f.brandId).sort(), ["b_ac", "b_da", "b_pr"])
    assert.ok(found.every((f) => f.severity === "high" && f.evidence.accounts === 40))
  })

  it("needs five accounts", () => {
    assert.deepEqual(coordinatedRing(ring.slice(0, 12), ["2026-11-05"]), [])
  })

  it("finds the IP concentration and cuts hashes to 8 characters", () => {
    const found = ipConcentration(ring, "2026-10-30", "2026-11-05")
    assert.equal(found.length, 3)
    assert.equal(found[0].severity, "high")
    assert.ok(String(found[0].evidence.topIps).split(" ").every((x) => x.split(":")[0].length === 8))
  })

  it("skips IP rules when the server can't see client IPs", () => {
    const found = detectAll(ring, ["2026-11-05"], { ipKnown: false })
    assert.ok(!found.some((f) => f.detector === "ip_concentration"))
    assert.ok(found.some((f) => f.detector === "coordinated_ring"))
  })
})
