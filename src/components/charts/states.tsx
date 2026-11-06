"use client"

import { ArrowClockwiseIcon, HourglassMediumIcon, MapPinIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { EmptyCard } from "@/components/market/editorial/empty-card"
import { Button } from "@/components/ui/button"
import type { ChartBoardDto } from "@/lib/api/contracts/charts"
import type { BoardState } from "./state"

/** "Couldn't load this chart." with Retry (§6.3 "States"). */
export function ErrorState({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <EmptyCard
      icon={<WarningCircleIcon />}
      title="Couldn't load this chart."
      reason="Yard didn't answer in time. Your filters are kept; try again."
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

/**
 * A scope with too few eligible brands (§6.3): a City chart offers its country's Top brands and
 * the nearest city with a chart; any other filtered board offers "Show everywhere".
 */
export function SmallCohortState({ board, state, onChange }: { board: ChartBoardDto; state: BoardState; onChange: (s: BoardState) => void }) {
  const place = board.scope.city?.name ?? board.scope.country?.name
  const category = board.scope.category?.label
  const n = board.cohortSize
  const has = n === 0 ? "No brand there is on the charts right now." : `${n === 1 ? "1 brand there is" : `${n} brands there are`} on the charts right now.`
  if (state.chart === "city" && board.scope.city) {
    const { country, nearestCity } = board.fallback ?? {}
    return (
      <EmptyCard
        icon={<MapPinIcon />}
        title={`Not enough brands in ${board.scope.city.name} for a city chart yet.`}
        reason={`A city chart needs at least 3 brands. ${has}`}
        action={
          <div className="flex flex-wrap gap-2">
            {country ? (
              <Button variant="secondary" onClick={() => onChange({ chart: "top", period: state.period, category: state.category, country: country.code })}>
                See Top brands in {country.name}
              </Button>
            ) : null}
            {nearestCity ? (
              <Button variant="secondary" onClick={() => onChange({ ...state, city: nearestCity.slug, country: undefined })}>
                See {nearestCity.name}
              </Button>
            ) : null}
          </div>
        }
      />
    )
  }
  const title = place && category ? `Not enough ${category} brands in ${place} yet.` : place ? `Not enough brands in ${place} yet.` : category ? `Not enough ${category} brands yet.` : "Not enough brands on this chart yet."
  return (
    <EmptyCard
      icon={<MapPinIcon />}
      title={title}
      reason={`A filtered chart needs at least 3 brands. ${has}`}
      action={
        <Button variant="secondary" onClick={() => onChange({ chart: state.chart, period: state.period })}>
          Show everywhere
        </Button>
      }
    />
  )
}
