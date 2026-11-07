import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { holidays } from "../../config/holidays"
import { isBusinessDay, makeCalendar, WEEKDAYS } from "./calendar"
import { defaultExpressTransit, estimateDelivery, groupHandling } from "./estimate"
import type { EstimateInput } from "./types"

const at = (iso: string) => Date.parse(iso)
const cal = (country: keyof typeof holidays) => makeCalendar(WEEKDAYS, holidays[country].map((h) => ({ date: h.date, name: h.name, country })))
const NG = cal("NG")
const JP = cal("JP")

/** A Lagos brand shipping inside Nigeria: 1–3 business days handling, 2–4 days transit. */
function lagosDomestic(over: Partial<EstimateInput>): EstimateInput {
  return {
    handlingCal: NG,
    transitCal: NG,
    timeZone: "Africa/Lagos",
    destTimeZone: "Africa/Lagos",
    cutoffLocal: "14:00",
    handling: [1, 3],
    transit: [2, 4],
    anchor: { kind: "quote", at: at("2026-11-09T10:00:00+01:00") },
    now: at("2026-11-09T10:00:00+01:00"),
    ...over,
  }
}

describe("estimateDelivery: from the order", () => {
  it("plans dispatch, ship-by and arrival in business days", () => {
    const e = estimateDelivery(lagosDomestic({}))
    // Mon 9 Nov before the cutoff: dispatch Tue 10 – Thu 12; arrival Thu 12 – Wed 18.
    assert.deepEqual([e.dispatchFrom, e.shipBy, e.arrivalFrom, e.arrivalTo], ["2026-11-10", "2026-11-12", "2026-11-12", "2026-11-18"])
    assert.equal(e.guaranteed, false)
    assert.equal(e.isEstimate, true)
    assert.equal(e.basis, "quote")
    assert.ok(e.arrivalFrom! <= e.arrivalTo!)
    assert.ok(isBusinessDay(e.arrivalFrom!, NG) && isBusinessDay(e.arrivalTo!, NG))
  })

  it("moves a Friday 14:01 order a whole business day later than 13:59", () => {
    const early = estimateDelivery(lagosDomestic({ anchor: { kind: "quote", at: at("2026-11-13T13:59:00+01:00") } }))
    const late = estimateDelivery(lagosDomestic({ anchor: { kind: "quote", at: at("2026-11-13T14:01:00+01:00") } }))
    assert.equal(early.dispatchFrom, "2026-11-16")
    assert.equal(late.dispatchFrom, "2026-11-17")
    assert.equal(early.arrivalTo, "2026-11-24")
    assert.equal(late.arrivalTo, "2026-11-25")
  })

  it("treats a weekend order as Monday's", () => {
    const sat = estimateDelivery(lagosDomestic({ anchor: { kind: "quote", at: at("2026-11-07T11:00:00+01:00") } }))
    const mon = estimateDelivery(lagosDomestic({ anchor: { kind: "quote", at: at("2026-11-09T11:00:00+01:00") } }))
    assert.deepEqual(sat, mon)
  })

  it("crosses Christmas and Boxing Day in Lagos", () => {
    const e = estimateDelivery(lagosDomestic({ anchor: { kind: "quote", at: at("2026-12-23T10:00:00+01:00") } }))
    // d0 Wed 23; dispatch Thu 24; ship by Wed 30 (25, 26, 27, 28 skipped); arrival Wed 30 Dec – Wed 6 Jan (1 Jan skipped).
    assert.deepEqual([e.dispatchFrom, e.shipBy, e.arrivalFrom, e.arrivalTo], ["2026-12-24", "2026-12-30", "2026-12-30", "2027-01-06"])
    assert.deepEqual(
      e.holidaysCrossed.map((h) => h.date),
      ["2026-12-25", "2026-12-28", "2027-01-01"],
    )
    assert.equal(e.holidaysCrossed[0].name, "Christmas Day")
  })

  it("waits out the New Year closures in Tokyo", () => {
    const e = estimateDelivery({
      handlingCal: JP,
      transitCal: JP,
      timeZone: "Asia/Tokyo",
      destTimeZone: "Asia/Tokyo",
      cutoffLocal: "14:00",
      handling: [1, 2],
      transit: [1, 2],
      anchor: { kind: "placed", at: at("2026-12-30T10:00:00+09:00") },
      now: at("2026-12-30T10:00:00+09:00"),
    })
    assert.equal(e.dispatchFrom, "2027-01-04")
    assert.equal(e.shipBy, "2027-01-05")
    assert.equal(e.arrivalFrom, "2027-01-05")
    assert.equal(e.arrivalTo, "2027-01-07")
    assert.ok(e.holidaysCrossed.some((h) => h.date === "2027-01-01"))
  })

  it("counts an unreleased drop from its release", () => {
    const e = estimateDelivery(lagosDomestic({ releaseAtMs: at("2026-11-14T12:00:00+01:00") }))
    // Released on a Saturday: counted from Monday 16.
    assert.equal(e.dispatchFrom, "2026-11-17")
  })

  it("uses the destination's holidays for transit", () => {
    // Lagos → London over UK Christmas: 25 and 28 Dec are UK holidays; 26 Dec isn't a weekday anyway.
    const e = estimateDelivery(lagosDomestic({ transitCal: cal("GB"), destTimeZone: "Europe/London", transit: [6, 12], anchor: { kind: "quote", at: at("2026-12-21T10:00:00+01:00") } }))
    assert.ok(isBusinessDay(e.arrivalFrom!, cal("GB")))
    assert.ok(e.holidaysCrossed.some((h) => h.country === "GB" && h.date === "2026-12-28"))
  })
})

describe("estimateDelivery: late and shipment events", () => {
  it("marks an unshipped order past its ship-by date late and re-plans from the next business day", () => {
    const e = estimateDelivery(lagosDomestic({ anchor: { kind: "placed", at: at("2026-11-02T10:00:00+01:00") }, now: at("2026-11-10T09:00:00+01:00") }))
    // Placed Mon 2 Nov: ship by Thu 5. On Tue 10 it hasn't shipped: dispatch Wed 11, arrival Fri 13 – Tue 17.
    assert.equal(e.basis, "late")
    assert.equal(e.late, true)
    assert.equal(e.shipBy, "2026-11-05")
    assert.deepEqual([e.dispatchFrom, e.arrivalFrom, e.arrivalTo], ["2026-11-11", "2026-11-13", "2026-11-17"])
  })

  it("doesn't mark a shipped order late for its ship-by date", () => {
    const e = estimateDelivery(lagosDomestic({ anchor: { kind: "placed", at: at("2026-11-02T10:00:00+01:00") }, now: at("2026-11-10T09:00:00+01:00"), shipped: true }))
    assert.equal(e.late, false)
  })

  it("re-estimates from the ship date", () => {
    const e = estimateDelivery(lagosDomestic({ anchor: { kind: "shipped", at: at("2026-11-09T16:00:00+01:00") }, now: at("2026-11-09T16:00:00+01:00") }))
    assert.equal(e.basis, "shipped")
    assert.deepEqual([e.arrivalFrom, e.arrivalTo], ["2026-11-11", "2026-11-13"])
    assert.equal(e.dispatchFrom, undefined)
  })

  it("runs late when the arrival window has passed without delivery", () => {
    const e = estimateDelivery(lagosDomestic({ anchor: { kind: "shipped", at: at("2026-11-02T16:00:00+01:00") }, now: at("2026-11-12T09:00:00+01:00") }))
    assert.equal(e.basis, "late")
    assert.deepEqual([e.arrivalFrom, e.arrivalTo], ["2026-11-13", "2026-11-16"])
  })

  it("pushes the window out on an exception and never starts it in the past", () => {
    const e = estimateDelivery(lagosDomestic({ anchor: { kind: "exception", at: at("2026-11-12T09:00:00+01:00"), previous: { arrivalFrom: "2026-11-11", arrivalTo: "2026-11-13" } }, now: at("2026-11-12T09:00:00+01:00") }))
    assert.equal(e.basis, "exception")
    assert.equal(e.late, true)
    assert.equal(e.arrivalFrom, "2026-11-13")
    assert.equal(e.arrivalTo, "2026-11-18")
  })

  it("reads out-for-delivery and delivered days in the destination zone", () => {
    const ofd = estimateDelivery(lagosDomestic({ anchor: { kind: "out_for_delivery", at: at("2026-11-12T08:00:00+01:00") } }))
    assert.deepEqual([ofd.arrivalFrom, ofd.arrivalTo], ["2026-11-12", "2026-11-12"])
    const done = estimateDelivery(lagosDomestic({ destTimeZone: "Asia/Tokyo", anchor: { kind: "delivered", at: at("2026-11-12T20:00:00+01:00") } }))
    assert.equal(done.deliveredOn, "2026-11-13")
  })
})

describe("helpers", () => {
  it("halves standard transit for express, with a floor", () => {
    assert.deepEqual(defaultExpressTransit([2, 4]), [1, 2])
    assert.deepEqual(defaultExpressTransit([6, 12]), [3, 6])
    assert.deepEqual(defaultExpressTransit([0, 1]), [1, 2])
  })
  it("takes the longest handling across a brand's lines", () => {
    assert.deepEqual(groupHandling([1, 3], [{}, { processingDays: [2, 5] }]), [2, 5])
    assert.deepEqual(groupHandling([2, 4], [{ processingDays: [1, 2] }]), [2, 4])
  })
})
