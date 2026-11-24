import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { endOfArrivalDay, liveActivityFor, startOfDay, type LiveDeliveryInput, type LiveOrderInput } from "./live-activity-state"

/*
 * Parity with the app: the same cases, by the same names, as
 * ios/YardTests/LiveActivityOrderTests.swift (branch mobileYard), which runs the Swift
 * `LiveActivityOrder.make(...)` on the same inputs. Every case runs in several phone time zones
 * (the app uses TimeZone.current); expected ETAs come from the zone's own 20:00, as in Swift.
 */

const ZONES = ["UTC", "Africa/Lagos", "Europe/London", "America/New_York", "Asia/Tokyo"]
const BRAND_CITY = "Lagos"

const order = (fulfilment: string, over: Partial<NonNullable<LiveOrderInput>> = {}): LiveOrderInput => ({ brand: { name: "Ojuelegba Supply" }, shipToPreview: { city: "London" }, states: { fulfilment }, deliveredAt: null, ...over })
const SHIP = "2026-11-18T08:00:00.000Z"
const delivery = (events: [string, string][], over: Partial<NonNullable<LiveDeliveryInput>> = {}): LiveDeliveryInput => ({
  estimate: { basis: "shipped", arrivalFrom: "2026-11-21", arrivalTo: "2026-11-22", deliveredOn: null, late: false },
  shippedOn: "2026-11-18",
  shipTo: { city: "London" },
  events: events.map(([status, occurredAt]) => ({ status, occurredAt })),
  ...over,
})
const NOW = Date.parse("2026-11-19T12:00:00.000Z")

for (const tz of ZONES) {
  describe(`Live Activity mapping parity (${tz})`, () => {
    const eta = endOfArrivalDay("2026-11-22", tz)!
    const run = (o: LiveOrderInput, dl: LiveDeliveryInput, now = NOW, city = BRAND_CITY) => liveActivityFor(o, dl, city, now, tz)

    it("cancelledEnds", () => {
      const r = run(order("cancelled"), delivery([["shipped", SHIP]]))
      assert.equal(r.closed, true)
      assert.equal(r.state, null)
    })
    it("returnedToSenderEnds", () => {
      assert.equal(run(order("returned_to_sender"), delivery([])).closed, true)
    })
    it("returnedEventEnds", () => {
      const r = run(order("shipped"), delivery([["shipped", SHIP], ["returned", "2026-11-19T09:00:00.000Z"]]))
      assert.deepEqual([r.closed, r.state], [true, null])
    })
    it("deliveredByFulfilment", () => {
      assert.deepEqual(run(order("delivered"), delivery([["shipped", SHIP]])).state, { step: "delivered", etaMs: null, progress: 1, statusLine: "Delivered" })
    })
    it("deliveredByEvent", () => {
      assert.equal(run(order("shipped"), delivery([["shipped", SHIP], ["delivered", "2026-11-19T10:00:00.000Z"]])).state?.step, "delivered")
    })
    it("deliveredByEstimate", () => {
      assert.equal(run(order("shipped"), delivery([["shipped", SHIP]], { estimate: { basis: "delivered", deliveredOn: "2026-11-19", late: false } })).state?.step, "delivered")
    })
    it("deliveredByOrderDate", () => {
      assert.equal(run(order("shipped", { deliveredAt: "2026-11-19T10:00:00.000Z" }), delivery([["shipped", SHIP]])).state?.step, "delivered")
    })
    it("outForDelivery", () => {
      const r = run(order("shipped"), delivery([["shipped", SHIP], ["out_for_delivery", "2026-11-19T07:00:00.000Z"]]))
      assert.equal(r.closed, false)
      assert.deepEqual(r.state, { step: "outForDelivery", etaMs: eta, progress: 0.86, statusLine: "Out for delivery in London" })
    })
    it("outForDeliveryThenExceptionStaysOut", () => {
      const r = run(order("shipped"), delivery([["shipped", SHIP], ["out_for_delivery", "2026-11-19T07:00:00.000Z"], ["exception", "2026-11-19T09:00:00.000Z"]]))
      assert.equal(r.state?.step, "outForDelivery")
    })
    it("outForDeliveryNoCity", () => {
      const r = run(order("shipped", { shipToPreview: { city: null } }), delivery([["out_for_delivery", "2026-11-19T07:00:00.000Z"]], { shipTo: { city: null } }))
      assert.equal(r.state?.statusLine, "Out for delivery")
    })
    it("shippedHalfway", () => {
      const ship = Date.parse(SHIP)
      const now = ship + (eta - ship) / 2
      const r = run(order("shipped"), delivery([["shipped", SHIP]]), now)
      const from = startOfDay("2026-11-21", tz)!
      if (now >= from) return // a zone where halfway is already inside the window: covered by arrivingSoon
      assert.deepEqual(r.state, { step: "shipped", etaMs: eta, progress: 0.25 + 0.53 * 0.5, statusLine: "On its way from Lagos" })
    })
    it("shippedBeforeShipEvent", () => {
      const r = run(order("shipped"), delivery([["shipped", SHIP]]), Date.parse(SHIP) - 3_600_000)
      assert.equal(r.state?.progress, 0.25)
    })
    it("shippedNoBrandCity", () => {
      assert.equal(run(order("shipped"), delivery([["in_transit", SHIP]]), NOW, "").state?.statusLine, "On its way")
    })
    it("shippedLastException", () => {
      const r = run(order("shipped"), delivery([["shipped", SHIP], ["exception", "2026-11-19T09:00:00.000Z"]]))
      assert.equal(r.state?.step, "shipped")
      assert.equal(r.state?.statusLine, "Delayed — Ojuelegba Supply reported a delay")
    })
    it("shippedLate", () => {
      const r = run(order("shipped"), delivery([["shipped", SHIP]], { estimate: { basis: "late", arrivalFrom: "2026-11-21", arrivalTo: "2026-11-22", late: true } }))
      assert.equal(r.state?.statusLine, "Running late — new estimate")
    })
    it("arrivingSoon", () => {
      const now = startOfDay("2026-11-21", tz)! + 3_600_000
      const r = run(order("shipped"), delivery([["shipped", SHIP]]), now)
      const fraction = (now - Date.parse(SHIP)) / (eta - Date.parse(SHIP))
      assert.deepEqual(r.state, { step: "arrivingSoon", etaMs: eta, progress: Math.max(0.25 + 0.53 * Math.min(Math.max(fraction, 0), 1), 0.7), statusLine: "Arriving soon in London" })
    })
    it("arrivingSoonLate", () => {
      const now = startOfDay("2026-11-21", tz)! + 3_600_000
      const r = run(order("shipped"), delivery([["shipped", SHIP]], { estimate: { basis: "late", arrivalFrom: "2026-11-21", arrivalTo: "2026-11-22", late: true } }), now)
      assert.equal(r.state?.statusLine, "Running late — arriving soon in London")
    })
    it("packedProcessing", () => {
      assert.deepEqual(run(order("processing"), delivery([])).state, { step: "packed", etaMs: eta, progress: 0.08, statusLine: "Packed by Ojuelegba Supply" })
    })
    it("packedLabelCreated", () => {
      assert.equal(run(order("unfulfilled"), delivery([["label_created", SHIP]])).state?.step, "packed")
    })
    it("unfulfilledNotTracked", () => {
      const r = run(order("unfulfilled"), delivery([]))
      assert.deepEqual([r.closed, r.state], [false, null])
    })
    it("shippedOnDateWhenNoEvent", () => {
      const start = startOfDay("2026-11-18", tz)!
      const r = run(order("shipped"), delivery([], { shippedOn: "2026-11-18" }))
      const fraction = (NOW - start) / (eta - start)
      assert.equal(r.state?.progress, 0.25 + 0.53 * Math.min(Math.max(fraction, 0), 1))
    })
    it("noEstimate", () => {
      const r = run(order("shipped"), delivery([["shipped", SHIP]], { estimate: null }))
      assert.deepEqual(r.state, { step: "shipped", etaMs: null, progress: 0.25, statusLine: "On its way from Lagos" })
    })
    it("noBrandName", () => {
      assert.equal(run(order("processing", { brand: null }), delivery([])).state?.statusLine, "Packed by The brand")
    })
    it("cityFromOrderWhenDeliveryHasNone", () => {
      const r = run(order("shipped", { shipToPreview: { city: "Abuja" } }), delivery([["out_for_delivery", SHIP]], { shipTo: null }))
      assert.equal(r.deliveryCity, "Abuja")
      assert.equal(r.state?.statusLine, "Out for delivery in Abuja")
    })
    it("eventsOutOfOrderAreSorted", () => {
      const r = run(order("shipped"), delivery([["out_for_delivery", "2026-11-19T07:00:00.000Z"], ["shipped", SHIP]]))
      assert.equal(r.state?.step, "outForDelivery")
    })
  })
}

describe("Calendar dates in the phone's zone", () => {
  it("20:00 local on the arrival day", () => {
    assert.equal(new Date(endOfArrivalDay("2026-11-22", "UTC")!).toISOString(), "2026-11-22T20:00:00.000Z")
    assert.equal(new Date(endOfArrivalDay("2026-11-22", "Africa/Lagos")!).toISOString(), "2026-11-22T19:00:00.000Z")
    assert.equal(new Date(endOfArrivalDay("2026-11-22", "Asia/Tokyo")!).toISOString(), "2026-11-22T11:00:00.000Z")
  })
  it("local midnight plus 20 hours on a DST day, as Calendar.date(byAdding: .hour) does", () => {
    // New York leaves daylight time on 2026-11-01: midnight is 04:00Z, +20 h = 00:00Z next day (19:00 EST).
    assert.equal(new Date(startOfDay("2026-11-01", "America/New_York")!).toISOString(), "2026-11-01T04:00:00.000Z")
    assert.equal(new Date(endOfArrivalDay("2026-11-01", "America/New_York")!).toISOString(), "2026-11-02T00:00:00.000Z")
  })
  it("a full timestamp is cut to its date; bad dates and zones", () => {
    assert.equal(startOfDay("2026-11-22T15:00:00Z", "UTC"), Date.parse("2026-11-22T00:00:00Z"))
    assert.equal(startOfDay("2026-02-30", "UTC"), null)
    assert.equal(startOfDay("", "UTC"), null)
    assert.equal(endOfArrivalDay("2026-11-22", "Not/AZone"), Date.parse("2026-11-22T20:00:00Z"))
  })
})
