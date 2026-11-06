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
