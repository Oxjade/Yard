import { api } from "./client"
import { brandRankDto, chartBoardDto, chartScopesDto, type BrandRankDto, type ChartBoardDto, type ChartQuery, type ChartScopesDto } from "./contracts/charts"

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
export const getBrandRank = (brandId: string) => api<BrandRankDto>(`/api/charts/brand/${encodeURIComponent(brandId)}`, { schema: brandRankDto })
