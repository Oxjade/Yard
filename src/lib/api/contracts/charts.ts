import { z } from "zod"
import { CHART_KINDS, CHART_MOVEMENTS, CHART_PERIODS } from "./enums"

/**
 * Charts contracts (cluster C, §6.3). Public DTOs only: `score` and `components` never appear here
 * (Admin reads them through its own endpoints). Every board response carries `sample: true` while
 * the labelled sample baseline is part of the ranking.
 */

/** URL spelling of the boards (`?chart=most-followed`); the database uses the snake_case kinds. */
export const CHART_SLUGS = ["top", "trending", "emerging", "most-followed", "most-wishlisted", "top-drops", "city"] as const
export type ChartSlug = (typeof CHART_SLUGS)[number]
export type ChartKind = (typeof CHART_KINDS)[number]
export type ChartPeriod = (typeof CHART_PERIODS)[number]

export const slugToKind = (s: ChartSlug): ChartKind => s.replace(/-/g, "_") as ChartKind
export const kindToSlug = (k: ChartKind): ChartSlug => k.replace(/_/g, "-") as ChartSlug

/** Sentence case, as the board rail shows them. */
export const chartLabels: Record<ChartSlug, string> = {
  top: "Top brands",
  trending: "Trending",
  emerging: "Emerging",
  "most-followed": "Most followed",
  "most-wishlisted": "Most wishlisted",
  "top-drops": "Top drops",
  city: "City charts",
}

export const periodLabels: Record<ChartPeriod, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" }

/** Fewest eligible brands a scoped board (and every City chart) needs. */
export const MIN_COHORT = 3

export const chartQuery = z.object({
  chart: z.enum(CHART_SLUGS).default("top"),
  period: z.enum(CHART_PERIODS).default("weekly"),
  category: z
    .string()
    .regex(/^[a-z][a-z-]{0,39}$/, "Choose a category from the list.")
    .optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, "Use a two-letter country code.")
    .optional(),
  city: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,59}$/, "Choose a city from the list.")
    .optional(),
})
export type ChartQuery = z.infer<typeof chartQuery>

export const imageRef = z.object({ src: z.string(), alt: z.string() })

export const chartBrandDto = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  mark: z.object({ text: z.string(), style: z.enum(["condensed", "expanded", "grotesk"]) }),
  verified: z.boolean(),
  city: z.string(),
  country: z.string(),
  countryName: z.string(),
  /** The brand's first category, as a label ("Streetwear"). */
  category: z.string(),
  cover: imageRef.nullable(),
})
export type ChartBrandDto = z.infer<typeof chartBrandDto>

export const chartDropDto = z.object({ id: z.string(), slug: z.string(), name: z.string(), image: imageRef, status: z.enum(["live", "sold_out", "upcoming", "ended"]) })

/** Public-safe stat: never revenue or order counts. */
export const chartStatDto = z.object({ label: z.string(), figure: z.string(), caption: z.string(), extra: z.string().optional(), value: z.number().optional() })

export const chartEntryDto = z.object({
  rank: z.number(),
  prevRank: z.number().nullable(),
  movement: z.enum(CHART_MOVEMENTS),
  /** Places climbed since the previous edition (negative = fell). */
  delta: z.number(),
  peak: z.number(),
  editionsOnChart: z.number(),
  subject: z.object({ type: z.enum(["brand", "drop"]), id: z.string() }),
  brand: chartBrandDto,
  drop: chartDropDto.optional(),
  stat: chartStatDto,
  /** Ranks in the last 8 daily-closed editions, oldest first, then this edition's; null = not charted that day. */
  history: z.array(z.number().nullable()),
})
export type ChartEntryDto = z.infer<typeof chartEntryDto>

/** A paid placement: always separate from `entries`, never more than two. */
export const sponsoredDto = z.object({ kind: z.enum(["brand", "drop"]), brand: chartBrandDto, drop: chartDropDto.optional(), campaignId: z.string().optional() })
export type SponsoredDto = z.infer<typeof sponsoredDto>

export const chartScopeDto = z.object({
  key: z.string(),
  city: z.object({ slug: z.string(), name: z.string(), country: z.string() }).optional(),
  country: z.object({ code: z.string(), name: z.string() }).optional(),
  category: z.object({ slug: z.string(), label: z.string() }).optional(),
})
export type ChartScopeDto = z.infer<typeof chartScopeDto>

export const chartEditionDto = z.object({
  /** UTC as-of date. */
  date: z.string(),
  status: z.enum(["live", "final"]),
  computedAt: z.string(),
  window: z.object({ from: z.string(), to: z.string() }),
  nextRefreshAt: z.string(),
})

export const chartBoardDto = z.object({
  chart: z.enum(CHART_SLUGS),
  period: z.enum(CHART_PERIODS),
  scope: chartScopeDto,
  /** ok; small_cohort (fewer than MIN_COHORT eligible brands in scope); warming_up (no edition yet). */
  state: z.enum(["ok", "small_cohort", "warming_up"]),
  edition: chartEditionDto.nullable(),
  cohortSize: z.number(),
  entries: z.array(chartEntryDto),
  sponsored: z.array(sponsoredDto),
  callouts: z.object({ biggestClimber: chartEntryDto.optional(), highestDebut: chartEntryDto.optional() }),
  /** Where a small cohort can go instead. */
  fallback: z
    .object({
      country: z.object({ code: z.string(), name: z.string(), eligible: z.number() }).optional(),
      nearestCity: z.object({ slug: z.string(), name: z.string(), eligible: z.number() }).optional(),
    })
    .optional(),
  sample: z.literal(true),
})
export type ChartBoardDto = z.infer<typeof chartBoardDto>

export const chartScopesDto = z.object({
  cities: z.array(z.object({ slug: z.string(), name: z.string(), country: z.string(), eligible: z.number() })),
  countries: z.array(z.object({ code: z.string(), name: z.string(), eligible: z.number() })),
  categories: z.array(z.object({ slug: z.string(), label: z.string(), eligible: z.number() })),
  minCohort: z.number(),
})
export type ChartScopesDto = z.infer<typeof chartScopesDto>

export const brandRankDto = z.object({
  best: z.object({ chart: z.enum(CHART_KINDS), period: z.literal("weekly"), scope: z.string(), rank: z.number(), label: z.string(), href: z.string() }).optional(),
  sample: z.literal(true),
})
export type BrandRankDto = z.infer<typeof brandRankDto>
