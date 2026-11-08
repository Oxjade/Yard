"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { motion, useReducedMotion } from "motion/react"
import { getBoard, getScopes, boardPath } from "@/lib/api/charts"
import { useApi } from "@/lib/api/use-api"
import { areaBySlug, cityBySlug, cities as gazetteer, fold } from "@/lib/around/gazetteer"
import { chartLabels, MIN_COHORT, periodLabels, type ChartBoardDto, type ChartScopesDto } from "@/lib/api/contracts/charts"
import { countries } from "@/config/markets"
import { categoryBySlug } from "@/lib/data/catalog"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import { BoardRail, DesktopFilters, PeriodControl, PhoneFilters } from "./board-controls"
import { Callouts } from "./callouts"
import { ChartList, ListHeader } from "./chart-list"
import { editionText, periodWords, updatedAgo } from "./format"
import { HowChartsWork } from "./how-charts-work"
import { Podium } from "./podium"
import { LeaderboardSkeleton } from "./skeleton"
import { SmallBoardNote } from "./small-board"
import { SponsoredStrip } from "./sponsored-strip"
import { parseBoardState, toSearch, type BoardState } from "./state"
import { ErrorState, SmallCohortState, WarmingState } from "./states"

const PANEL_ID = "charts-panel"

/** Whether a board response is the one the URL asks for (keepPrevious may still show the last one). */
function matches(b: ChartBoardDto, s: BoardState) {
  if (b.chart !== s.chart || b.period !== s.period) return false
  if ((b.scope.category?.slug ?? undefined) !== s.category) return false
  if (s.chart === "city") return !s.city || b.scope.city?.slug === s.city
  if (s.city) return b.scope.city?.slug === s.city
  if (s.country) return b.scope.country?.code === s.country
  return !b.scope.city && !b.scope.country
}

/** The saved Around area's city (Around keeps `{ v: 1, area }` under nocturne-around), or null. */
function savedAroundCity(): string | null {
  try {
    const raw = window.localStorage.getItem("nocturne-around")
    if (!raw) return null
    const v = JSON.parse(raw) as { v?: number; area?: unknown }
    return v?.v === 1 && typeof v.area === "string" ? (areaBySlug(v.area)?.city.slug ?? null) : null
  } catch {
    return null
  }
}

/**
 * City charts default (§6.3), in order: the ship-to city when it's a gazetteer city with a chart;
 * the saved Around area's city when it has one; the largest cohort in the ship-to country; the
 * largest overall.
 */
function preferredCity(scopes: ChartScopesDto, shipTo: string, shipToCity: string | null): string | null {
  const charted = scopes.cities.filter((c) => c.eligible >= MIN_COHORT)
  const has = (slug: string | null | undefined) => (slug && charted.some((c) => c.slug === slug) ? slug : null)
  const shipCity = shipToCity ? gazetteer.find((c) => fold(c.name) === fold(shipToCity) || c.aliases.some((a) => fold(a) === fold(shipToCity)))?.slug : null
  return has(shipCity) ?? has(savedAroundCity()) ?? charted.filter((c) => c.country === shipTo).sort((a, b) => b.eligible - a.eligible)[0]?.slug ?? charted.sort((a, b) => b.eligible - a.eligible)[0]?.slug ?? null
}

/**
 * The live leaderboard (§6.3): server-rendered first board, then refreshed over /api/charts while
 * the tab is visible (daily boards every 30 s, weekly every 5 min, monthly every 15 min). Board,
 * period and filters live in the URL (replaced in place, like the shop's filters).
 *
 * City charts without a city in the URL open on this shopper's own default city, but that default
 * is only ever a resolved value: it is never written to the URL, so it can't follow the shopper
 * onto Top brands or any other board. A board's podium, rows and count only show while they are
 * the board the URL asks for; a switch shows the skeleton, and a switch that fails shows the error
 * with Retry, never the previous board under the new name.
 */
export function ChartsApp({ initial, initialScopes }: { initial?: ChartBoardDto; initialScopes?: ChartScopesDto }) {
  const params = useSearchParams()
  const state = useMemo(() => parseBoardState(params), [params])
  const reduce = useReducedMotion()
  const hydrated = useHydrated()
  const scopes = useApi<ChartScopesDto>("/api/charts/scopes", () => getScopes(), { revalidateOnFocus: false }).data ?? initialScopes

  // City charts with no city in the URL: this shopper's default (after hydration, since it reads
  // the session and the saved Around area), applied to the request only.
  const shipTo = useSession((s) => s.shipTo)
  const shipToCity = useSession((s) => s.shipToCity)
  const defaultCity = hydrated && scopes && state.chart === "city" && !state.city ? preferredCity(scopes, shipTo, shipToCity) : null
  const effective = useMemo<BoardState>(() => (defaultCity ? { ...state, city: defaultCity, country: undefined } : state), [state, defaultCity])
  const path = boardPath(effective)

  const { data, error, isValidating, revalidate } = useApi<ChartBoardDto>(path, (k) => getBoard(k), { refreshInterval: periodWords[state.period].refreshMs })
  const board = data ?? (initial && matches(initial, effective) ? initial : undefined)
  const current = !!board && matches(board, effective)

  const setState = useCallback((next: BoardState) => {
    window.history.replaceState(null, "", `${window.location.pathname}${toSearch(next)}`)
  }, [])

  // "Chart updated", once per refresh of the same board (never per move, never on a board switch).
  const [announce, setAnnounce] = useState("")
  const seen = useRef<{ path: string; at: string | null }>({ path, at: board?.edition?.computedAt ?? null })
  useEffect(() => {
    const at = board?.edition?.computedAt ?? null
    const prev = seen.current
    seen.current = { path, at }
    if (current && prev.path === path && prev.at && at && prev.at !== at) setAnnounce(`Chart updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`)
  }, [board?.edition?.computedAt, path, current])

  // City charts take a city, never a country; a place the shopper picked carries over between boards.
  const changeChart = (chart: BoardState["chart"]) => setState({ ...state, chart, country: chart === "city" ? undefined : state.country })
  const cityShown = state.chart === "city" ? (current ? board?.scope.city : undefined) : undefined
  const resolvedCity = cityShown ? { slug: cityShown.slug, name: cityShown.name } : defaultCity ? { slug: defaultCity, name: cityBySlug(defaultCity)?.name ?? "" } : undefined
  const switching = !current && !error

  return (
    // One column that may shrink below its content, and children that may too, so nothing (the
    // edition line, How Charts work, the board) widens the page at 320 px.
    <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 md:mt-8 *:min-w-0">
      <EditionLine board={current ? board : undefined} loading={switching} period={state.period} hydrated={hydrated} reduce={!!reduce} />
      <HowChartsWork />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <BoardRail value={state.chart} onChange={changeChart} panelId={PANEL_ID} />
        {/* Wraps at every width: at 320 px Filters drops under the period switch instead of off the page. */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <PeriodControl value={state.period} onChange={(period) => setState({ ...state, period })} />
          <div className="ml-auto md:hidden">
            <PhoneFilters state={state} scopes={scopes} onChange={setState} resolvedCity={resolvedCity} />
          </div>
          <div className="ml-auto hidden md:block">
            <DesktopFilters state={state} scopes={scopes} onChange={setState} resolvedCity={resolvedCity} />
          </div>
        </div>
      </div>

      <section id={PANEL_ID} role="tabpanel" aria-labelledby={`charts-tab-${state.chart}`} aria-busy={switching} className="min-h-[24rem]">
        <BoardHeading state={effective} board={current ? board : undefined} />
        {current && board ? (
          <BoardBody board={board} state={state} scopes={scopes} refreshFailed={!!error} onChange={setState} onRetry={() => void revalidate()} retrying={isValidating} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void revalidate()} retrying={isValidating} />
        ) : (
          <LeaderboardSkeleton />
        )}
      </section>

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  )
}

function BoardBody({ board, state, scopes, refreshFailed, onChange, onRetry, retrying }: { board: ChartBoardDto; state: BoardState; scopes?: ChartScopesDto; refreshFailed: boolean; onChange: (s: BoardState) => void; onRetry: () => void; retrying: boolean }) {
  // A refresh of this same board that failed: the board stays, with a quiet note.
  const note = refreshFailed ? <p className="mt-4 text-xs text-ink-3">Couldn&apos;t refresh just now. This is the last edition Yard sent.</p> : null
  if (board.state === "warming_up") return <WarmingState onRetry={onRetry} retrying={retrying} />
  if (board.state === "small_cohort")
    return (
      <>
        <SmallCohortState board={board} state={state} scopes={scopes} onChange={onChange} />
        {note}
      </>
    )
  if (!board.entries.length)
    return (
      <div className="rounded-lg border border-line-soft bg-card p-6 text-sm text-ink-2">
        {board.chart === "top-drops" ? "No drops are live, released this period or coming up in the next 7 days." : "No brand qualifies for this chart in this period yet."}
      </div>
    )
  const rows = board.entries.slice(3)
  const head = rows.slice(0, 7)
  const tail = rows.slice(7)
  const drops = board.chart === "top-drops"
  const size = Math.max(board.entries.length, ...board.entries.flatMap((e) => e.history.filter((x): x is number => x !== null)))
  return (
    <div className="grid gap-6">
      <Podium entries={board.entries} period={board.period} />
      <Callouts callouts={board.callouts} period={board.period} />
      {rows.length ? (
        <div>
          <ListHeader period={board.period} drops={drops} />
          <ChartList entries={head} period={board.period} start={4} size={size} />
          {tail.length ? <SponsoredStrip items={board.sponsored} /> : null}
          <ChartList entries={tail} period={board.period} start={11} size={size} />
        </div>
      ) : (
        <SmallBoardNote board={board} state={state} scopes={scopes} onChange={onChange} />
      )}
      {!tail.length ? <SponsoredStrip items={board.sponsored} /> : null}
      {note}
    </div>
  )
}

/** A scope in words, from Yard's own lists (the board's scope once it has arrived, else the URL's). */
function whereWords(state: BoardState, board?: ChartBoardDto) {
  const place = board ? (board.scope.city?.name ?? board.scope.country?.name) : state.city ? cityBySlug(state.city)?.name : state.country ? (countries as Record<string, { name: string } | undefined>)[state.country]?.name : undefined
  const category = board ? board.scope.category?.label : state.category ? categoryBySlug.get(state.category as never)?.name : undefined
  return category && place ? `${category} in ${place}` : category ? `${category}, everywhere` : (place ?? (state.chart === "city" ? null : "Everywhere"))
}

/**
 * "Top brands" with where and when: "Everywhere, weekly", "Lagos, daily", "Fashion in Nigeria,
 * monthly". The title is always the board the URL asks for; the count only shows once that
 * board's own answer is here, so the line never describes another board's data.
 */
function BoardHeading({ state, board }: { state: BoardState; board?: ChartBoardDto }) {
  const where = whereWords(state, board)
  const count = board?.state === "ok" ? board.entries.length : 0
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
      <h2 className="font-display text-display-sm text-ink">{chartLabels[state.chart]}</h2>
      <p className="text-sm text-ink-2">
        {where ? `${where}, ` : null}
        {where ? periodLabels[state.period].toLowerCase() : periodLabels[state.period]}
        {count ? <span className="text-ink-3">{`. ${count} ${board?.chart === "top-drops" ? (count === 1 ? "drop" : "drops") : count === 1 ? "brand" : "brands"} ranked`}</span> : null}
      </p>
    </div>
  )
}

/**
 * The edition line (§6.3 "Header"): a Live chip with a dot (static under reduced motion), the
 * edition and when it was computed (relative time after hydration). A closed edition, shown when
 * the live compute fails, reads "Final".
 */
function EditionLine({ board, loading, period, hydrated, reduce }: { board?: ChartBoardDto; loading: boolean; period: BoardState["period"]; hydrated: boolean; reduce: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  const ed = board?.edition
  if (!ed)
    return loading ? (
      <div className="flex h-7 items-center gap-3" aria-hidden>
        <span className="h-7 w-16 rounded-full bg-white/[0.05]" />
        <span className="h-3.5 w-56 rounded-sm bg-white/[0.04]" />
      </div>
    ) : (
      <div className="h-7" aria-hidden />
    )
  const live = ed.status === "live"
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
      <span className={cn("inline-flex h-7 items-center gap-2 rounded-full border px-3 text-xs font-medium", live ? "border-white/15 text-ink" : "border-white/10 text-ink-2")}>
        {live && !reduce ? (
          <motion.span className="size-2 rounded-full bg-ink" aria-hidden animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2.4, ease: "easeInOut", repeat: Infinity }} />
        ) : (
          <span className={cn("size-2 rounded-full", live ? "bg-ink" : "bg-ink-3")} aria-hidden />
        )}
        {live ? "Live" : "Final"}
      </span>
      <span className="tabular">
        {editionText(ed, period)}
        {live && hydrated ? <span className="text-ink-3">{`. Updated ${updatedAgo(ed.computedAt, now)}`}</span> : null}
      </span>
    </div>
  )
}
