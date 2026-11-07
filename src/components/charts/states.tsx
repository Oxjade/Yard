"use client"

import { ArrowClockwiseIcon, HourglassMediumIcon, MapPinIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { EmptyCard } from "@/components/market/editorial/empty-card"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/client"
import { chartLabels, MIN_COHORT, type ChartBoardDto, type ChartScopesDto } from "@/lib/api/contracts/charts"
import type { BoardState } from "./state"

/** "Couldn't load this chart." with Retry (§6.3 "States"); the filters stay as they are. */
export function ErrorState({ error, onRetry, retrying }: { error?: unknown; onRetry: () => void; retrying: boolean }) {
  const limited = error instanceof ApiError && error.status === 429
  return (
    <EmptyCard
      icon={<WarningCircleIcon />}
      title="Couldn't load this chart."
      reason={limited ? "Charts were loaded a lot from here in the last minute. Wait a moment, then try again. Your filters are kept." : "Yard didn't answer in time. Your filters are kept; try again."}
      action={
        <Button variant="secondary" onClick={onRetry} disabled={retrying}>
          <ArrowClockwiseIcon className={retrying ? "animate-spin motion-reduce:animate-none" : undefined} aria-hidden />
          {retrying ? "Trying again" : "Retry"}
        </Button>
      }
    />
  )
}

/** Only while editions are still being written after start-up (§6.3 "warming up"). */
export function WarmingState({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <EmptyCard
      icon={<HourglassMediumIcon />}
      title="Charts are warming up — back in a moment."
      reason="The first editions are being written. Nothing is lost while you wait."
      action={
        <Button variant="secondary" onClick={onRetry} disabled={retrying}>
          <ArrowClockwiseIcon aria-hidden />
          Retry
        </Button>
      }
    />
  )
}

const brandWord = (n: number) => (n === 1 ? "brand" : "brands")
const actionRow = "flex flex-wrap justify-center gap-2 max-sm:w-full max-sm:[&>*]:w-full"

/**
 * A scope with too few eligible brands (§6.3). Every action leads to a board that has a chart:
 * a City chart filtered to a category offers all categories in that city first; a City chart
 * offers its country's Top brands only when that country has a chart, otherwise Top brands
 * everywhere, and the nearest city with one; any other board offers dropping the place (keeping
 * the category) and dropping the category (keeping the place), each only when it leads somewhere.
 */
export function SmallCohortState({ board, state, scopes, onChange }: { board: ChartBoardDto; state: BoardState; scopes?: ChartScopesDto; onChange: (s: BoardState) => void }) {
  const place = board.scope.city?.name ?? board.scope.country?.name
  const category = board.scope.category?.label
  const n = board.cohortSize
  const { country, nearestCity } = board.fallback ?? {}
  const countryHasChart = !!country && country.eligible >= MIN_COHORT
  const categoryEverywhere = state.category ? (scopes?.categories.find((c) => c.slug === state.category)?.eligible ?? 0) : Infinity
  const placeRow = board.scope.city ? scopes?.cities.find((c) => c.slug === board.scope.city?.slug) : board.scope.country ? scopes?.countries.find((c) => c.code === board.scope.country?.code) : undefined
  const placeAll = placeRow?.eligible ?? 0

  if (state.chart === "city" && board.scope.city) {
    const city = board.scope.city.name
    const actions: React.ReactNode[] = []
    if (category && placeAll >= MIN_COHORT)
      actions.push(
        <Button key="all" variant="secondary" onClick={() => onChange({ chart: "city", period: state.period, city: state.city })}>
          Show all categories
        </Button>,
      )
    if (countryHasChart)
      actions.push(
        <Button key="country" variant="secondary" onClick={() => onChange({ chart: "top", period: state.period, country: country.code })}>
          See Top brands in {country.name}
        </Button>,
      )
    else
      actions.push(
        <Button key="everywhere" variant="secondary" onClick={() => onChange({ chart: "top", period: state.period })}>
          See Top brands everywhere
        </Button>,
      )
    if (!category && nearestCity)
      actions.push(
        <Button key="near" variant="secondary" onClick={() => onChange({ ...state, city: nearestCity.slug, country: undefined })}>
          See {nearestCity.name}
        </Button>,
      )
    return (
      <EmptyCard
        icon={<MapPinIcon />}
        title={category ? `Not enough ${category} brands in ${city} yet.` : `Not enough brands in ${city} for a city chart yet.`}
        reason={
          category
            ? `A chart needs at least ${MIN_COHORT} brands. ${n === 0 ? `No ${category} brand in ${city} is on the charts right now.` : `${city} has ${n} ${category} ${brandWord(n)} on the charts right now.`}`
            : `A city chart needs at least ${MIN_COHORT} brands. ${n === 0 ? `No brand in ${city} is on the charts right now.` : `${city} has ${n} ${brandWord(n)} on the charts right now.`}`
        }
        action={<div className={actionRow}>{actions}</div>}
      />
    )
  }

  const title = place && category ? `Not enough ${category} brands in ${place} yet.` : place ? `Not enough brands in ${place} yet.` : category ? `Not enough ${category} brands yet.` : "Not enough brands on this chart yet."
  const where = place && category ? `${place} has ${n} ${category} ${brandWord(n)}` : place ? `${place} has ${n} ${brandWord(n)}` : `There ${n === 1 ? "is" : "are"} ${n} ${category ?? ""} ${brandWord(n)}`.replace("  ", " ")
  const actions: React.ReactNode[] = []
  if (place && categoryEverywhere >= MIN_COHORT)
    actions.push(
      <Button key="everywhere" variant="secondary" onClick={() => onChange({ chart: state.chart, period: state.period, category: state.category })}>
        Show everywhere
      </Button>,
    )
  if (category && place && placeAll >= MIN_COHORT)
    actions.push(
      <Button key="all" variant="secondary" onClick={() => onChange({ chart: state.chart, period: state.period, city: state.city, country: state.city ? undefined : state.country })}>
        Show all categories
      </Button>,
    )
  if (!actions.length)
    actions.push(
      <Button key="clear" variant="secondary" onClick={() => onChange({ chart: state.chart, period: state.period })}>
        Show {chartLabels[state.chart]} everywhere
      </Button>,
    )
  return (
    <EmptyCard
      icon={<MapPinIcon />}
      title={title}
      reason={`A filtered chart needs at least ${MIN_COHORT} brands. ${where} on the charts right now.`}
      action={<div className={actionRow}>{actions}</div>}
    />
  )
}
