import { chartQuery, type ChartPeriod, type ChartSlug } from "@/lib/api/contracts/charts"

/** The board the URL holds (§6.3 "URL state"). Shared by the page's server loader and the client app. */
export type BoardState = { chart: ChartSlug; period: ChartPeriod; category?: string; country?: string; city?: string }

/** Reads the URL; anything invalid falls back to its default, field by field. */
export function parseBoardState(params: { get(k: string): string | null }): BoardState {
  const pick = <K extends keyof BoardState>(k: K) => {
    const shape = chartQuery.shape[k as keyof typeof chartQuery.shape]
    const r = shape.safeParse(params.get(k) ?? undefined)
    return (r.success ? r.data : undefined) as BoardState[K]
  }
  return { chart: pick("chart") ?? "top", period: pick("period") ?? "weekly", category: pick("category"), country: pick("country"), city: pick("city") }
}

/** The page's own query string for a board (defaults left out). */
export function toSearch(s: BoardState) {
  const p = new URLSearchParams()
  if (s.chart !== "top") p.set("chart", s.chart)
  if (s.period !== "weekly") p.set("period", s.period)
  if (s.category) p.set("category", s.category)
  if (s.city) p.set("city", s.city)
  else if (s.country) p.set("country", s.country)
  const q = p.toString()
  return q ? `?${q}` : ""
}
