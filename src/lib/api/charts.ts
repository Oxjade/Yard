import { api } from "./client"
import { brandRanksDto, chartBoardDto, chartScopesDto, type BrandRankDto, type ChartBoardDto, type ChartQuery, type ChartScopesDto } from "./contracts/charts"

/** Typed wrappers for the Charts API (cluster C, §6.3). */

/** The query string a board is fetched with, in a fixed order (it is also the useApi cache key). */
export function boardPath(q: Partial<ChartQuery>) {
  const p = new URLSearchParams()
  p.set("chart", q.chart ?? "top")
  p.set("period", q.period ?? "weekly")
  if (q.category) p.set("category", q.category)
  if (q.city) p.set("city", q.city)
  else if (q.country) p.set("country", q.country)
  return `/api/charts?${p.toString()}`
}

export const getBoard = (path: string, signal?: AbortSignal) => api<ChartBoardDto>(path, { signal, schema: chartBoardDto })
export const getScopes = () => api<ChartScopesDto>("/api/charts/scopes", { schema: chartScopesDto })
/**
 * One brand's best weekly rank, for RankBadge. Badges ask one brand each, but every request made in
 * the same tick is sent together as one GET /api/charts/brands (48 ids at most per request, sorted
 * so the same page asks the same URL), so a page of brand cards is one read rather than one per
 * card. The route is public with a 5-minute max-age, and the browser's cache is allowed to answer.
 */
const RANK_BATCH = 48
type Waiter = { resolve: (v: BrandRankDto) => void; reject: (e: unknown) => void }
let queued: Map<string, Waiter[]> | null = null

function sendQueued() {
  const batch = queued
  queued = null
  if (!batch) return
  const ids = [...batch.keys()].sort()
  for (let i = 0; i < ids.length; i += RANK_BATCH) {
    const chunk = ids.slice(i, i + RANK_BATCH)
    api("/api/charts/brands", { query: { ids: chunk.join(",") }, schema: brandRanksDto, cache: "default" }).then(
      (d) => {
        for (const id of chunk) for (const w of batch.get(id) ?? []) w.resolve(d.ranks[id] ?? { sample: true })
      },
      (e) => {
        for (const id of chunk) for (const w of batch.get(id) ?? []) w.reject(e)
      },
    )
  }
}

export function getBrandRank(brandId: string): Promise<BrandRankDto> {
  return new Promise((resolve, reject) => {
    if (!queued) {
      queued = new Map()
      setTimeout(sendQueued, 0)
    }
    const list = queued.get(brandId)
    if (list) list.push({ resolve, reject })
    else queued.set(brandId, [{ resolve, reject }])
  })
}
