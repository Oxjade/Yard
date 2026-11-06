import type { ChartBoardDto, ChartEntryDto, ChartPeriod } from "@/lib/api/contracts/charts"

/** Period-aware words for history, previous rank and the edition line (§6.3). */
export const periodWords: Record<ChartPeriod, { prev: string; prevLower: string; column: string; unit: (n: number) => string; long: (n: number) => string; isNew: string; adjective: string; refreshMs: number }> = {
  daily: { prev: "Yesterday", prevLower: "yesterday", column: "Days", unit: (n) => `${n} ${n === 1 ? "day" : "days"}`, long: (n) => `${n} ${n === 1 ? "day" : "days"} on chart`, isNew: "New today", adjective: "Daily", refreshMs: 30_000 },
  weekly: { prev: "Last week", prevLower: "last week", column: "Weeks", unit: (n) => `${n} ${n === 1 ? "wk" : "wks"}`, long: (n) => `${n} ${n === 1 ? "week" : "weeks"} on chart`, isNew: "New this week", adjective: "Weekly", refreshMs: 300_000 },
  monthly: { prev: "Last month", prevLower: "last month", column: "Months", unit: (n) => `${n} ${n === 1 ? "mo" : "mos"}`, long: (n) => `${n} ${n === 1 ? "month" : "months"} on chart`, isNew: "New this month", adjective: "Monthly", refreshMs: 900_000 },
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const fmtDay = (iso: string) => day(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })

/** "Weekly edition, 31 Oct – 6 Nov", "Daily edition, 6 Nov"; finals read "Week of 31 Oct". */
export function editionText(edition: NonNullable<ChartBoardDto["edition"]>, period: ChartPeriod) {
  const { from, to } = edition.window
  if (edition.status === "final") return period === "daily" ? `Edition of ${fmtDay(to)}` : period === "weekly" ? `Week of ${fmtDay(from)}` : `Month to ${fmtDay(to)}`
  return period === "daily" ? `Daily edition, ${fmtDay(to)}` : `${periodWords[period].adjective} edition, ${fmtDay(from)} – ${fmtDay(to)}`
}

/** "just now", "2 min ago", "1 h ago". */
export function updatedAgo(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)} h ago`
}

/** "Last week #4", "New this week", "Back on the chart". */
export function previousRankText(e: ChartEntryDto, period: ChartPeriod) {
  if (e.movement === "new") return periodWords[period].isNew
  if (e.movement === "reentry") return "Back on the chart"
  return `${periodWords[period].prev} #${e.prevRank}`
}

export function movementWords(e: Pick<ChartEntryDto, "movement" | "delta">) {
  if (e.movement === "up") return `up ${e.delta} ${e.delta === 1 ? "place" : "places"}`
  if (e.movement === "down") return `down ${-e.delta} ${-e.delta === 1 ? "place" : "places"}`
  if (e.movement === "same") return "no change"
  if (e.movement === "new") return "new entry"
  return "re-entry"
}

/** "Rank 5, up 2 places, last week 7, peak 2, 6 weeks on chart" or "Rank 9, new entry". */
export function accessibleRow(e: ChartEntryDto, period: ChartPeriod) {
  const w = periodWords[period]
  const name = e.drop ? `${e.drop.name} by ${e.brand.name}` : e.brand.name
  if (e.movement === "new") return `${name}. Rank ${e.rank}, new entry. ${e.stat.label}.`
  const prev = e.prevRank !== null ? `, ${w.prevLower} ${e.prevRank}` : ""
  return `${name}. Rank ${e.rank}, ${movementWords(e)}${prev}, peak ${e.peak}, ${w.long(e.editionsOnChart)}. ${e.stat.label}.`
}

export const two = (n: number) => String(n).padStart(2, "0")

export const dropStatusLabel: Record<NonNullable<ChartEntryDto["drop"]>["status"], string> = { live: "Live", sold_out: "Sold out", upcoming: "Upcoming", ended: "Ended" }
