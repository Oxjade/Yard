"use client"

import { Fragment, useRef, useState } from "react"
import { SlidersHorizontalIcon } from "@phosphor-icons/react"
import { motion } from "motion/react"
import { Segmented } from "@/components/dashboard/insight/segmented"
import { Chip, ChipRadioGroup } from "@/components/market/catalog/chip"
import { PhoneSheet } from "@/components/market/catalog/phone-sheet"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CHART_SLUGS, chartLabels, MIN_COHORT, periodLabels, type ChartPeriod, type ChartScopesDto, type ChartSlug } from "@/lib/api/contracts/charts"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { BoardState } from "./state"

export type { BoardState }

const brandsWord = (n: number) => `${n} ${n === 1 ? "brand" : "brands"}`

/** The board rail (§6.3): a tablist of sentence-case chips; the active one has the purple fill. */
export function BoardRail({ value, onChange, panelId }: { value: ChartSlug; onChange: (v: ChartSlug) => void; panelId: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const last = CHART_SLUGS.length - 1
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : -1
    if (next < 0) return
    e.preventDefault()
    onChange(CHART_SLUGS[next])
    refs.current[next]?.focus()
    refs.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }
  return (
    <div role="tablist" aria-label="Charts" className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {CHART_SLUGS.map((slug, i) => {
        const on = slug === value
        return (
          <button
            key={slug}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`charts-tab-${slug}`}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(slug)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative isolate inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-violet active:scale-[0.97] lg:h-9",
              on ? "border-purple text-ink" : "border-line text-ink-2 hover:border-violet/50 hover:text-ink",
            )}
          >
            {on ? <motion.span layoutId="charts-board-pill" aria-hidden className="absolute inset-[-1px] -z-10 rounded-full bg-purple" transition={spring.indicator} /> : null}
            {chartLabels[slug]}
          </button>
        )
      })}
    </div>
  )
}

export function PeriodControl({ value, onChange, className }: { value: ChartPeriod; onChange: (v: ChartPeriod) => void; className?: string }) {
  return <Segmented label="Chart period" value={value} onChange={onChange} options={(["daily", "weekly", "monthly"] as const).map((p) => ({ value: p, label: periodLabels[p] }))} className={className} />
}

type Option = { value: string; label: string; disabled?: boolean }

/** Category options: every category with its eligible count; under MIN_COHORT they are listed but can't be chosen. */
export function categoryOptions(scopes: ChartScopesDto | undefined, current?: string): Option[] {
  const list = scopes?.categories ?? []
  return [{ value: "all", label: "All categories" }, ...list.map((c) => ({ value: c.slug, label: `${c.label} · ${brandsWord(c.eligible)}`, disabled: c.eligible < MIN_COHORT && c.slug !== current }))]
}

/**
 * Location options. City charts list only cities with at least MIN_COHORT eligible brands, with
 * counts ("Lagos · 3 brands"); other boards list Everywhere, the countries and those cities. The
 * current place always stays in the list, so the select can show it.
 */
export function locationOptions(chart: ChartSlug, scopes: ChartScopesDto | undefined, state: BoardState, resolvedCity?: { slug: string; name: string }): Option[] {
  const cities = (scopes?.cities ?? []).filter((c) => c.eligible >= MIN_COHORT || c.slug === (state.city ?? resolvedCity?.slug))
  const cityOpts = cities.map((c) => ({ value: `city:${c.slug}`, label: `${c.name} · ${brandsWord(c.eligible)}` }))
  if (resolvedCity && !cities.some((c) => c.slug === resolvedCity.slug)) cityOpts.push({ value: `city:${resolvedCity.slug}`, label: resolvedCity.name })
  if (chart === "city") return cityOpts
  const countries = (scopes?.countries ?? []).map((c) => ({ value: `country:${c.code}`, label: `${c.name} · ${brandsWord(c.eligible)}`, disabled: c.eligible < MIN_COHORT && c.code !== state.country }))
  return [{ value: "all", label: "Everywhere" }, ...countries, ...cityOpts]
}

export const locationValue = (s: BoardState, resolvedCity?: string) => (s.city ? `city:${s.city}` : s.country ? `country:${s.country}` : resolvedCity ? `city:${resolvedCity}` : "all")

export function applyLocation(s: BoardState, v: string): BoardState {
  const [kind, val] = v.split(":")
  return { ...s, city: kind === "city" ? val : undefined, country: kind === "country" ? val : undefined }
}

const triggerClass = "h-10 min-w-48 rounded-md border-line bg-surface px-3 text-sm data-[size=default]:h-10"

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  const firstCity = options.findIndex((o) => o.value.startsWith("city:"))
  const firstCountry = options.findIndex((o) => o.value.startsWith("country:"))
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={triggerClass}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" position="popper" className="max-h-80">
        {options.map((o, i) => (
          <Fragment key={o.value}>
            {i > 0 && (i === firstCity || i === firstCountry) ? <SelectSeparator /> : null}
            <SelectItem value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          </Fragment>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Desktop (md up): Category and Location selects beside the period control. */
export function DesktopFilters({ state, scopes, onChange, resolvedCity }: { state: BoardState; scopes?: ChartScopesDto; onChange: (s: BoardState) => void; resolvedCity?: { slug: string; name: string } }) {
  return (
    <div className="flex items-center gap-3">
      <FilterSelect label="Category" value={state.category ?? "all"} options={categoryOptions(scopes, state.category)} onChange={(v) => onChange({ ...state, category: v === "all" ? undefined : v })} />
      <FilterSelect label="Location" value={locationValue(state, resolvedCity?.slug)} options={locationOptions(state.chart, scopes, state, resolvedCity)} onChange={(v) => onChange(applyLocation(state, v))} />
    </div>
  )
}

/**
 * Phones: a Filters button (with a count when filters are set) opens the marketplace's
 * PhoneSheet with Category and Location, the same pattern as the shop and Around filters. The
 * sheet edits a draft; "Show chart" applies it, closing discards it.
 */
export function PhoneFilters({ state, scopes, onChange, resolvedCity }: { state: BoardState; scopes?: ChartScopesDto; onChange: (s: BoardState) => void; resolvedCity?: { slug: string; name: string } }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<BoardState>(state)
  const count = (state.category ? 1 : 0) + (state.city || state.country ? (state.chart === "city" ? 0 : 1) : 0)
  const cats = categoryOptions(scopes, draft.category)
  const locs = locationOptions(draft.chart, scopes, draft, resolvedCity)
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setDraft(state)
          setOpen(true)
        }}
        aria-haspopup="dialog"
        aria-label={`Filters${count ? `, ${count} applied` : ""}`}
        className="h-10 shrink-0 gap-2 rounded-full px-4"
      >
        <SlidersHorizontalIcon className="size-4" aria-hidden />
        Filters
        {count ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple px-1.5 text-[11px] tabular">{count}</span> : null}
      </Button>
      <PhoneSheet
        open={open}
        onOpenChange={setOpen}
        closeLabel="Close filters"
        title={<span>Filters</span>}
        footerClassName="grid grid-cols-[auto_1fr] gap-2"
        footer={
          <>
            <Button variant="secondary" size="lg" onClick={() => setDraft({ ...draft, category: undefined, country: undefined, city: draft.chart === "city" ? draft.city : undefined })} disabled={!draft.category && !draft.country && (draft.chart === "city" || !draft.city)}>
              Clear filters
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => {
                onChange(draft)
                setOpen(false)
              }}
            >
              Show chart
            </Button>
          </>
        }
      >
        <div className="grid gap-7">
          <fieldset>
            <legend className="mb-3 text-sm text-ink-2">Category</legend>
            <ChipRadioGroup label="Category" className="flex flex-wrap gap-2">
              {cats.map((o) => (
                <Chip key={o.value} radio selected={(draft.category ?? "all") === o.value} disabled={o.disabled} onClick={() => setDraft({ ...draft, category: o.value === "all" ? undefined : o.value })} layoutId="charts-sheet-category">
                  {o.label}
                </Chip>
              ))}
            </ChipRadioGroup>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-sm text-ink-2">{draft.chart === "city" ? "City" : "Location"}</legend>
            <ChipRadioGroup label={draft.chart === "city" ? "City" : "Location"} className="flex flex-wrap gap-2">
              {locs.map((o) => (
                <Chip key={o.value} radio selected={locationValue(draft, resolvedCity?.slug) === o.value} disabled={o.disabled} onClick={() => setDraft(applyLocation(draft, o.value))} layoutId="charts-sheet-location">
                  {o.label}
                </Chip>
              ))}
            </ChipRadioGroup>
          </fieldset>
        </div>
      </PhoneSheet>
    </>
  )
}
