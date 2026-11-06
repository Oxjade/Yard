import type { CountryCode } from "@/config/markets"

/**
 * Each market's main time zone. A brand's calendar day (when its campaign starts, when a drop
 * releases) is read in the zone of the country it trades from.
 */
export const countryTimeZone: Record<CountryCode, string> = {
  NG: "Africa/Lagos",
  GH: "Africa/Accra",
  KE: "Africa/Nairobi",
  ZA: "Africa/Johannesburg",
  GB: "Europe/London",
  FR: "Europe/Paris",
  DE: "Europe/Berlin",
  US: "America/New_York",
  MX: "America/Mexico_City",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>()

/** The calendar date ("2026-11-06") at an instant in a time zone. */
export function dateIn(timeZone: string, at: number) {
  let f = dayFormatters.get(timeZone)
  if (!f) {
    // en-CA formats as yyyy-mm-dd.
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    dayFormatters.set(timeZone, f)
  }
  return f.format(new Date(at))
}

/** A calendar date moved by whole days ("2026-11-06" + 1 → "2026-11-07"). */
export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const partFormatters = new Map<string, Intl.DateTimeFormat>()

/** How far a zone's wall clock is ahead of UTC at an instant, in ms. */
function zoneOffsetAt(at: number, timeZone: string) {
  let f = partFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    partFormatters.set(timeZone, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(at / 1000) * 1000
}

/** A wall-clock date and time in a zone ("2026-11-08", "18:00") → the UTC instant, daylight saving included. */
export function zonedTimeToUtc(date: string, time: string, timeZone: string) {
  const [y, mo, d] = date.split("-").map(Number)
  const [h, mi] = time.split(":").map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  // Twice: the first guess uses the offset at the wrong instant when a clock change falls between.
  const first = wall - zoneOffsetAt(wall, timeZone)
  return wall - zoneOffsetAt(first, timeZone)
}
