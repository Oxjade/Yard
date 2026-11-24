import type { BrandRankDto } from "@/lib/api/contracts/charts"

/** The badge's text: the rank, with " · sample" only while the server says the baseline counts. Null without a rank. */
export function rankBadgeLabel(data: Pick<BrandRankDto, "best" | "sample"> | undefined): string | null {
  if (!data?.best) return null
  return `${data.best.label}${data.sample === true ? " · sample" : ""}`
}
