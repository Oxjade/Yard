"use client"

import Link from "next/link"
import { ArrowRightIcon, MapPinIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { chartLabels, MIN_COHORT, type ChartBoardDto, type ChartPeriod, type ChartScopesDto } from "@/lib/api/contracts/charts"
import type { BoardState } from "./state"

const when: Record<ChartPeriod, string> = { daily: "today", weekly: "this week", monthly: "this month" }
const brands = (n: number) => `${n} ${n === 1 ? "brand" : "brands"}`

/** Why a brand is or isn't on each board, in the board's own terms (never "too little activity" when that isn't it). */
function boardRule(chart: ChartBoardDto["chart"], w: string) {
  switch (chart) {
    case "top":
    case "city":
      return `A brand ranks once it has an order or at least 10 views ${w}.`
    case "trending":
      return `Trending ranks brands with at least 20 views ${w}, by how fast their follows, views and saves are growing.`
    case "emerging":
      return "Emerging is for brands under 30,000 followers that joined Yard in the last 18 months."
    case "most-followed":
      return `Every brand there is ranked by its new followers ${w}.`
    case "most-wishlisted":
      return `Every brand there is ranked by the shoppers who saved its pieces ${w}.`
    case "top-drops":
      return `Top drops ranks drops released ${w}, live now, or releasing in the next 7 days.`
  }
}

/**
 * A board that is only its podium (3 or fewer ranked, §6.3): it says how many are ranked there and
 * why, so the short page reads as a small chart rather than a broken one, and offers somewhere
 * useful to go next. City charts explain the city chart (it starts at 3 brands) and offer Top
 * brands everywhere, the city on Around, its country's board when that has more brands, and any
 * other city with a chart; when there is none it names the city closest to one. Any other board
 * scoped to a place or category gives that board's own rule (Emerging's follower and age limits,
 * Top drops' release window) and offers the wider board.
 */
export function SmallBoardNote({ board, state, scopes, onChange }: { board: ChartBoardDto; state: BoardState; scopes?: ChartScopesDto; onChange: (s: BoardState) => void }) {
  const ranked = board.entries.length
  const cohort = Math.max(board.cohortSize, board.chart === "top-drops" ? 0 : ranked)
  const w = when[board.period]
  const city = board.scope.city
  const country = board.scope.country
  const category = board.scope.category
  const drops = board.chart === "top-drops"
  const subject = drops ? (ranked === 1 ? "drop" : "drops") : ranked === 1 ? "brand" : "brands"
  const label = chartLabels[board.chart]

  let title: string
  let caption: string
  let reason: string
  let more: string | null = null
  const actions: React.ReactNode[] = []

  if (board.chart === "city" && city) {
    const where = category ? `${category.label} in ${city.name}` : city.name
    caption = `${subject} ranked in ${where}`
    title = `That's the whole ${where} chart ${w}.`
    reason =
      ranked < cohort
        ? `${brands(cohort)} there are on the charts; the other ${cohort - ranked} had no order and fewer than 10 views ${w}, so they don't rank yet. A city chart starts at ${MIN_COHORT} brands and grows as more brands there join Yard and get followed, saved and viewed.`
        : `Every brand there that qualifies is on it. A city chart starts at ${MIN_COHORT} brands, so for now ${city.name}'s chart is its podium. It grows as more brands there join Yard and get followed, saved and viewed.`
    const others = (scopes?.cities ?? []).filter((c) => c.slug !== city.slug && c.eligible >= MIN_COHORT).sort((a, b) => b.eligible - a.eligible)
    const closest = (scopes?.cities ?? []).filter((c) => c.slug !== city.slug && c.eligible > 0 && c.eligible < MIN_COHORT).sort((a, b) => b.eligible - a.eligible)[0]
    if (!others.length && scopes) more = closest ? `No other city has a chart yet. ${closest.name} is closest, with ${closest.eligible} of the ${MIN_COHORT} brands it needs.` : "No other city has a chart yet."
    const countryRow = scopes?.countries.find((c) => c.code === city.country)
    actions.push(
      <Button key="top" variant="secondary" onClick={() => onChange({ chart: "top", period: state.period, category: state.category })}>
        See Top brands everywhere
      </Button>,
    )
    if (countryRow && countryRow.eligible > cohort && countryRow.eligible >= MIN_COHORT)
      actions.push(
        <Button key="country" variant="secondary" onClick={() => onChange({ chart: "top", period: state.period, category: state.category, country: countryRow.code })}>
          See Top brands in {countryRow.name}
        </Button>,
      )
    for (const c of others.slice(0, 3))
      actions.push(
        <Button key={c.slug} variant="secondary" onClick={() => onChange({ ...state, chart: "city", city: c.slug, country: undefined })}>
          See {c.name}
        </Button>,
      )
    actions.push(
      <Button key="around" variant="ghost" asChild>
        <Link href={`/around?area=${encodeURIComponent(city.slug)}`}>
          <MapPinIcon aria-hidden />
          See {city.name} on Around
          <ArrowRightIcon aria-hidden />
        </Link>
      </Button>,
    )
  } else if (city || country || category) {
    const placeName = city?.name ?? country?.name
    const where = category && placeName ? `${category.label} in ${placeName}` : category ? category.label : placeName!
    caption = category && !placeName ? `${category.label} ${subject} ranked` : `${subject} ranked in ${where}`
    title = `That's the whole ${label} chart for ${where} ${w}.`
    const tally = drops
      ? `Right now that's ${ranked} ${subject} from the ${brands(cohort)} ${placeName ? `in ${placeName}` : "there"}${category ? ` in ${category.label}` : ""}.`
      : ranked < cohort
        ? `${brands(cohort)} there are on the charts and ${ranked} ${ranked === 1 ? "qualifies" : "qualify"} for ${label}.`
        : board.chart === "most-followed" || board.chart === "most-wishlisted"
          ? `That's ${brands(cohort)}.`
          : `All ${brands(cohort)} there are on it.`
    reason = `${boardRule(board.chart, w)} ${tally}`
    const categoryEverywhere = category ? (scopes?.categories.find((c) => c.slug === category.slug)?.eligible ?? 0) : 0
    if (placeName && (!category || categoryEverywhere >= MIN_COHORT))
      actions.push(
        <Button key="everywhere" variant="secondary" onClick={() => onChange({ chart: state.chart, period: state.period, category: state.category })}>
          Show everywhere
        </Button>,
      )
    if (category)
      actions.push(
        <Button key="all" variant="secondary" onClick={() => onChange({ chart: state.chart, period: state.period, city: state.city, country: state.city ? undefined : state.country })}>
          Show all categories
        </Button>,
      )
    if (city)
      actions.push(
        <Button key="around" variant="ghost" asChild>
          <Link href={`/around?area=${encodeURIComponent(city.slug)}`}>
            <MapPinIcon aria-hidden />
            See {city.name} on Around
            <ArrowRightIcon aria-hidden />
          </Link>
        </Button>,
      )
  } else {
    caption = `${subject} ranked`
    title = `That's the whole ${label} chart ${w}.`
    reason = boardRule(board.chart, w)
    if (board.chart !== "top")
      actions.push(
        <Button key="top" variant="secondary" onClick={() => onChange({ chart: "top", period: state.period })}>
          See Top brands
        </Button>,
      )
  }

  return (
    <section aria-labelledby="charts-small-board" className="grid gap-5 rounded-lg border border-line-soft bg-card p-4 md:grid-cols-[9rem_minmax(0,1fr)] md:gap-8 md:p-6">
      <p className="flex items-baseline gap-3 md:grid md:content-start md:gap-1.5 md:border-r md:border-line-soft md:pr-6">
        <span className="font-metric text-[2.5rem] leading-none text-ink tabular md:text-[3.5rem]">{ranked}</span>
        <span className="text-xs text-ink-2">{caption}</span>
      </p>
      <div className="grid min-w-0 gap-4">
        <div className="grid gap-1.5">
          <h3 id="charts-small-board" className="text-base text-ink text-pretty">
            {title}
          </h3>
          <p className="max-w-2xl text-sm text-ink-2 text-pretty">{reason}</p>
          {more ? <p className="max-w-2xl text-sm text-ink-2 text-pretty">{more}</p> : null}
        </div>
        {actions.length ? <div className="flex flex-wrap gap-2 max-sm:[&>*]:w-full">{actions}</div> : null}
      </div>
    </section>
  )
}
