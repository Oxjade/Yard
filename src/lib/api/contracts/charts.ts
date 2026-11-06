import { z } from "zod"
import { CHART_KINDS, CHART_MOVEMENTS, CHART_PERIODS } from "./enums"

/** Charts contracts (F1 draft; cluster C owns this file in wave 2, §6.3). `score` and `components` are never public. */
export const chartQuery = z.object({
  chart: z.enum(["top", "trending", "emerging", "most-followed", "most-wishlisted", "top-drops", "city"]).default("top"),
  period: z.enum(CHART_PERIODS).default("weekly"),
  category: z.string().max(40).optional(),
  country: z.string().length(2).optional(),
  city: z.string().max(60).optional(),
})

export const chartEntryDto = z.object({
  rank: z.number(),
  prevRank: z.number().nullable(),
  movement: z.enum(CHART_MOVEMENTS),
  delta: z.number(),
  peak: z.number(),
  editionsOnChart: z.number(),
  subject: z.object({ type: z.enum(["brand", "drop"]), id: z.string() }),
  brand: z.object({ id: z.string(), handle: z.string(), name: z.string(), mark: z.unknown().optional(), verified: z.boolean(), city: z.string(), country: z.string(), category: z.string(), cover: z.string().optional() }),
  drop: z.object({ slug: z.string(), name: z.string(), image: z.string(), status: z.enum(["live", "sold_out", "upcoming", "ended"]) }).optional(),
  stat: z.object({ label: z.string(), value: z.number().optional() }),
  history: z.array(z.number()),
})
export type ChartEntryDto = z.infer<typeof chartEntryDto>

export const sponsoredDto = z.object({ brand: z.object({ id: z.string(), handle: z.string(), name: z.string() }), campaignId: z.string().optional() })

export const chartBoardDto = z.object({
  edition: z.object({ date: z.string(), status: z.enum(["live", "final"]), computedAt: z.string(), window: z.object({ from: z.string(), to: z.string() }), nextRefreshAt: z.string() }),
  cohortSize: z.number(),
  entries: z.array(chartEntryDto),
  sponsored: z.array(sponsoredDto),
  callouts: z.object({ biggestClimber: chartEntryDto.optional(), highestDebut: chartEntryDto.optional() }),
  sample: z.literal(true),
})
export type ChartBoardDto = z.infer<typeof chartBoardDto>

export const chartScopesDto = z.object({
  cities: z.array(z.object({ slug: z.string(), name: z.string(), country: z.string(), eligible: z.number() })),
  countries: z.array(z.object({ code: z.string(), eligible: z.number() })),
  categories: z.array(z.object({ slug: z.string(), label: z.string(), eligible: z.number() })),
})

export const brandRankDto = z.object({
  best: z.object({ chart: z.enum(CHART_KINDS), period: z.literal("weekly"), scope: z.string(), rank: z.number(), label: z.string(), href: z.string() }).optional(),
  sample: z.literal(true),
})
export type BrandRankDto = z.infer<typeof brandRankDto>
