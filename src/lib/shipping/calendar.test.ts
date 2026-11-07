import { strict as assert } from "node:assert"
import { describe, it } from "node:test"
import { holidayRows, holidays } from "../../config/holidays"
import { addBusinessDays, dateIn, isBusinessDay, isDate, localHHMM, makeCalendar, nextBusinessDay, orderDay, weekdayIndex, WEEKDAYS } from "./calendar"
import { formatRange, formatShortRange } from "./format"

/** A UTC instant from a wall-clock time and a fixed offset in hours ("+01:00" for Lagos). */
const at = (iso: string) => Date.parse(iso)

const cal = (country: keyof typeof holidays, workdays = WEEKDAYS) => makeCalendar(workdays, holidays[country].map((h) => ({ date: h.date, name: h.name, country })))
const lagos = { timeZone: "Africa/Lagos", cutoffLocal: "14:00" }
const tokyo = { timeZone: "Asia/Tokyo", cutoffLocal: "14:00" }

describe("Appendix B holiday data", () => {
  it("has a real calendar date for every entry, inside Nov 2026 – Dec 2027", () => {
    for (const [country, list] of Object.entries(holidays)) {
      for (const h of list) {
        assert.ok(isDate(h.date), `${country} ${h.date} is a date`)
        assert.ok(h.date >= "2026-11-01" && h.date <= "2027-12-31", `${country} ${h.date} is in range`)
      }
    }
  })

  it("gives every row a unique id", () => {
    const rows = holidayRows()
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length)
    assert.equal(new Set(rows.map((r) => `${r.country}|${r.date}|${r.name}`)).size, rows.length)
  })

  it("places every Saturday or Sunday substitute after the day it replaces", () => {
    let checked = 0
    for (const [country, list] of Object.entries(holidays)) {
      for (const h of list) {
        const m = /substitute for (Sat|Sun) (\d+)/.exec(h.name)
        if (!m) continue
        const original = `${h.date.slice(0, 8)}${m[2].padStart(2, "0")}`
        assert.equal(weekdayIndex(original), m[1] === "Sat" ? 5 : 6, `${country} ${h.name}: ${original} is a ${m[1]}`)
        assert.ok(weekdayIndex(h.date) <= 4, `${country} ${h.name}: ${h.date} is a weekday`)
        assert.ok(h.date > original, `${country} ${h.name} comes after ${original}`)
        checked++
      }
    }
    assert.ok(checked >= 10, `checked ${checked} substitutes`)
  })

  it("matches the dates in Appendix B", () => {
    const has = (c: keyof typeof holidays, d: string) => holidays[c].some((h) => h.date === d)
    assert.ok(has("NG", "2026-12-25") && has("NG", "2026-12-28") && has("NG", "2027-10-01"))
    assert.ok(has("GH", "2026-12-04") && has("GH", "2027-07-01"))
    assert.ok(has("KE", "2026-12-12") && has("KE", "2027-10-20"))
    assert.ok(has("ZA", "2026-12-16") && has("ZA", "2027-04-27"))
    assert.ok(has("GB", "2027-08-30") && has("FR", "2027-07-14") && has("DE", "2027-10-03"))
    assert.ok(has("US", "2026-11-26") && has("US", "2027-07-05") && has("MX", "2026-11-16"))
    assert.ok(has("JP", "2026-12-31") && has("JP", "2027-01-02") && has("JP", "2027-01-03") && has("KR", "2027-09-15"))
    assert.equal(holidays.JP.find((h) => h.date === "2026-12-31")?.kind, "carrier")
    assert.equal(holidays.NG.find((h) => h.date === "2026-12-28")?.estimated, true)
  })
})

describe("calendar basics", () => {
  const ng = cal("NG")

  it("reads weekdays without the local clock", () => {
    assert.equal(weekdayIndex("2026-11-06"), 4) // Friday
    assert.equal(weekdayIndex("2026-11-07"), 5) // Saturday
    assert.equal(weekdayIndex("2026-11-09"), 0) // Monday
  })

  it("skips weekends and holidays", () => {
    assert.equal(isBusinessDay("2026-11-07", ng), false)
    assert.equal(isBusinessDay("2026-12-25", ng), false)
    assert.equal(isBusinessDay("2026-12-24", ng), true)
    assert.equal(nextBusinessDay("2026-11-06", ng), "2026-11-09")
    assert.equal(addBusinessDays("2026-11-07", 0, ng), "2026-11-09")
    assert.equal(addBusinessDays("2026-11-09", 0, ng), "2026-11-09")
    assert.equal(addBusinessDays("2026-11-06", 3, ng), "2026-11-11")
  })

  it("honours a brand's closures and Saturday working", () => {
    const withSat = makeCalendar(WEEKDAYS | (1 << 5), [], [{ from: "2026-11-09", to: "2026-11-10" }])
    assert.equal(isBusinessDay("2026-11-07", withSat), true)
    assert.equal(nextBusinessDay("2026-11-07", withSat), "2026-11-11")
  })

  it("reads the date and time in the origin zone", () => {
    assert.equal(dateIn("Asia/Tokyo", at("2026-11-06T16:30:00Z")), "2026-11-07")
    assert.equal(localHHMM(at("2026-11-06T12:59:00Z"), "Africa/Lagos"), "13:59")
  })
})

describe("orderDay: weekends and the cutoff", () => {
  const ng = cal("NG")

  it("counts a Friday 13:59 order from Friday", () => {
    assert.equal(orderDay(at("2026-11-13T13:59:00+01:00"), lagos, ng), "2026-11-13")
  })

  it("counts a Friday 14:01 order from Monday", () => {
    assert.equal(orderDay(at("2026-11-13T14:01:00+01:00"), lagos, ng), "2026-11-16")
  })

  it("counts an order at exactly the cutoff from the next business day", () => {
    assert.equal(orderDay(at("2026-11-11T14:00:00+01:00"), lagos, ng), "2026-11-12")
  })

  it("counts a weekend order from Monday", () => {
    assert.equal(orderDay(at("2026-11-07T09:00:00+01:00"), lagos, ng), "2026-11-09")
    assert.equal(orderDay(at("2026-11-08T23:30:00+01:00"), lagos, ng), "2026-11-09")
  })

  it("counts a Lagos order on Christmas Eve after the cutoff from 29 December", () => {
    // 25 Dec (Christmas), Sat 26, Sun 27, 28 Dec (Boxing Day substitute) are all closed.
    assert.equal(orderDay(at("2026-12-24T15:00:00+01:00"), lagos, ng), "2026-12-29")
  })

  it("counts a Tokyo order on 30 December after the cutoff from 4 January", () => {
    // 31 Dec carrier closure, 1 Jan New Year's Day, 2 and 3 Jan carrier closures (a weekend too).
    const jp = cal("JP")
    assert.equal(orderDay(at("2026-12-30T15:00:00+09:00"), tokyo, jp), "2027-01-04")
    assert.equal(orderDay(at("2026-12-30T10:00:00+09:00"), tokyo, jp), "2026-12-30")
  })
})

describe("format", () => {
  it("collapses the month within one month", () => {
    assert.equal(formatRange("2026-11-11", "2026-11-16"), "Wed 11 – Mon 16 Nov")
    assert.equal(formatShortRange("2026-11-11", "2026-11-16"), "11–16 Nov")
  })
  it("names both months across a month and both years across a year", () => {
    assert.equal(formatRange("2026-11-30", "2026-12-02"), "Mon 30 Nov – Wed 2 Dec")
    assert.equal(formatRange("2026-12-30", "2027-01-06"), "Wed 30 Dec 2026 – Wed 6 Jan 2027")
    assert.equal(formatShortRange("2026-11-30", "2026-12-02"), "30 Nov – 2 Dec")
  })
  it("reads one day once", () => {
    assert.equal(formatRange("2026-11-11", "2026-11-11"), "Wed 11 Nov")
  })
})
