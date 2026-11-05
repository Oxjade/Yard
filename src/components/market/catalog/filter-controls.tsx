"use client"

import { useId, useMemo, useState } from "react"
import { BrandMark } from "@/components/market/brand-mark"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { currencies, type CurrencyCode } from "@/config/markets"
import { convert, formatMoney, toMajor } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Chip } from "./chip"
import { computeFacets, priceBands, sortOptions, type CatalogState } from "./catalog-state"

/* ---------- price labels in the shopper's currency ---------- */

function money(usd: number, currency: CurrencyCode) {
  return formatMoney(convert(Math.round(usd * 100), "USD", currency), currency, { compact: currency !== "USD" })
}

/** "Under $50", "$50–$100", "Over $300", or a custom range. */
export function priceLabel(min: number | undefined, max: number | undefined, currency: CurrencyCode) {
  if (min !== undefined && max !== undefined) return `${money(min, currency)}–${money(max, currency)}`
  if (max !== undefined) return priceBands.some((b) => b.max === max && b.min === undefined) ? `Under ${money(max, currency)}` : `Up to ${money(max, currency)}`
  if (min !== undefined) return priceBands.some((b) => b.min === min && b.max === undefined) ? `Over ${money(min, currency)}` : `From ${money(min, currency)}`
  return ""
}

/* ---------- the controls ---------- */

export type FilterPatch = Partial<Omit<CatalogState, "page">>

/**
 * Every filter the panel (desktop) and the sheet (phone) offer. Controlled: it renders the
 * state it is given and reports changes, so the sheet can work on a draft.
 */
export function FilterControls({
  state,
  onChange,
  currency,
  showSort = false,
  className,
}: {
  state: CatalogState
  onChange: (patch: FilterPatch) => void
  currency: CurrencyCode
  showSort?: boolean
  className?: string
}) {
  const facets = useMemo(() => computeFacets(state), [state])
  const [allBrands, setAllBrands] = useState(false)
  const id = useId()
  const brandRows = allBrands ? facets.brandFacet : facets.brandFacet.slice(0, 6)

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  return (
    <div className={cn("divide-y divide-line-soft", className)}>
      {showSort ? (
        <FilterSection title="Sort">
          <div role="radiogroup" aria-label="Sort" className="flex flex-wrap gap-2">
            {sortOptions.map((o) => (
              <Chip key={o.value} radio size="sm" selected={state.sort === o.value} onClick={() => onChange({ sort: o.value })}>
                {o.label}
              </Chip>
            ))}
          </div>
        </FilterSection>
      ) : null}

      <FilterSection title="Price" note={currency !== "USD" ? `Shown in ${currency} at an indicative rate.` : undefined}>
        <div role="radiogroup" aria-label="Price band" className="flex flex-wrap gap-2">
          {facets.priceFacet.map((band) => {
            const selected = state.min === band.min && state.max === band.max
            return (
              <Chip
                key={`${band.min}-${band.max}`}
                radio
                size="sm"
                selected={selected}
                count={band.count}
                disabled={!selected && band.count === 0}
                onClick={() => onChange(selected ? { min: undefined, max: undefined } : { min: band.min, max: band.max })}
              >
                {priceLabel(band.min, band.max, currency)}
              </Chip>
            )
          })}
        </div>
        <PriceRange min={state.min} max={state.max} currency={currency} onApply={(min, max) => onChange({ min, max })} />
      </FilterSection>

      {facets.brandFacet.length ? (
        <FilterSection title="Brands" count={state.brands.length || undefined}>
          <ul className="grid gap-0.5">
            {brandRows.map(({ brand, count }) => {
              const checked = state.brands.includes(brand.handle)
              const cid = `${id}-brand-${brand.handle}`
              return (
                <li key={brand.id}>
                  <div className={cn("flex items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-card", count === 0 && !checked && "opacity-50")}>
                    <Checkbox id={cid} checked={checked} onCheckedChange={() => onChange({ brands: toggle(state.brands, brand.handle) })} />
                    <Label htmlFor={cid} className={cn("min-w-0 flex-1 cursor-pointer gap-2.5 font-normal", checked ? "text-ink" : "text-ink-2")}>
                      <BrandMark brand={brand} size="xs" />
                      <span className="truncate">{brand.name}</span>
                    </Label>
                    <span className="tabular text-xs text-ink-3">{count}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          {facets.brandFacet.length > 6 ? (
            <button type="button" onClick={() => setAllBrands((v) => !v)} className="mt-2 rounded-md px-1 py-1 text-sm text-violet hover:underline hover:underline-offset-4" aria-expanded={allBrands}>
              {allBrands ? "Show fewer brands" : `Show all ${facets.brandFacet.length} brands`}
            </button>
          ) : null}
        </FilterSection>
      ) : null}

      {facets.sizeFacet.length ? (
        <FilterSection title="Size" count={state.sizes.length || undefined} note="Only sizes that are in stock.">
          <div className="grid gap-4">
            {facets.sizeFacet.map((group) => (
              <div key={group.id}>
                <p className="mb-2 text-xs text-ink-3">{group.label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.values.map(({ value, count }) => {
                    const selected = state.sizes.includes(value)
                    return (
                      <Chip
                        key={value}
                        size="sm"
                        selected={selected}
                        disabled={!selected && count === 0}
                        onClick={() => onChange({ sizes: toggle(state.sizes, value) })}
                        className="min-w-11 px-2.5"
                        aria-label={`${group.label} ${value}, ${count} ${count === 1 ? "piece" : "pieces"}`}
                      >
                        {value}
                      </Chip>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </FilterSection>
      ) : null}

      <FilterSection title="Availability">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor={`${id}-stock`} className="cursor-pointer font-normal text-ink-2">
            In stock only
            <span className="tabular text-xs text-ink-3">{facets.inStockCount}</span>
          </Label>
          <Switch id={`${id}-stock`} checked={state.inStock} onCheckedChange={(v) => onChange({ inStock: v })} />
        </div>
      </FilterSection>

      {facets.countryFacet.length > 1 || state.country ? (
        <FilterSection title="Brand country">
          <div role="radiogroup" aria-label="Brand country" className="flex flex-wrap gap-2">
            {facets.countryFacet.map((c) => {
              const selected = state.country === c.code
              return (
                <Chip key={c.code} radio size="sm" selected={selected} count={c.count} disabled={!selected && c.count === 0} onClick={() => onChange({ country: selected ? undefined : c.code })}>
                  {c.name}
                </Chip>
              )
            })}
          </div>
        </FilterSection>
      ) : null}
    </div>
  )
}

function FilterSection({ title, count, note, children }: { title: string; count?: number; note?: string; children: React.ReactNode }) {
  return (
    <section className="py-5 first:pt-0 last:pb-0">
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
        {title}
        {count ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-purple px-1.5 text-[11px] tabular text-ink">{count}</span> : null}
      </h3>
      {note ? <p className="mt-1 text-xs text-ink-3">{note}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/* ---------- custom price range (validated) ---------- */

function PriceRange({
  min,
  max,
  currency,
  onApply,
}: {
  min?: number
  max?: number
  currency: CurrencyCode
  onApply: (min: number | undefined, max: number | undefined) => void
}) {
  const id = useId()
  const minor = currencies[currency].minor
  const toDisplay = (usd?: number) => (usd === undefined ? "" : String(Math.round(toMajor(convert(Math.round(usd * 100), "USD", currency), currency))))
  const toUsd = (value: number | undefined, round: (n: number) => number) =>
    value === undefined ? undefined : round(convert(Math.round(value * 10 ** minor), currency, "USD") / 100)

  // Keep the inputs in step with the URL (a band chip or "Clear all" changes min/max).
  const key = `${min}|${max}|${currency}`
  const [synced, setSynced] = useState(key)
  const [lo, setLo] = useState(toDisplay(min))
  const [hi, setHi] = useState(toDisplay(max))
  const [errors, setErrors] = useState<{ lo?: string; hi?: string }>({})
  if (synced !== key) {
    setSynced(key)
    setLo(toDisplay(min))
    setHi(toDisplay(max))
    setErrors({})
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parse = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(/[\s,]/g, "")))
    const a = parse(lo)
    const b = parse(hi)
    const next: { lo?: string; hi?: string } = {}
    if (a !== undefined && (!Number.isFinite(a) || a < 0)) next.lo = "Enter an amount of zero or more."
    if (b !== undefined && (!Number.isFinite(b) || b <= 0)) next.hi = "Enter an amount above zero."
    if (!next.lo && !next.hi && a !== undefined && b !== undefined && a > b) next.hi = "Max must be higher than min."
    setErrors(next)
    if (next.lo || next.hi) return
    onApply(toUsd(a, Math.floor), toUsd(b, Math.ceil))
  }

  const symbol = currencies[currency].symbol
  const field = (which: "lo" | "hi") => {
    const value = which === "lo" ? lo : hi
    const set = which === "lo" ? setLo : setHi
    const error = errors[which]
    const fid = `${id}-${which}`
    return (
      <div className="grid min-w-0 flex-1 gap-1.5">
        <Label htmlFor={fid}>{which === "lo" ? "Min" : "Max"}</Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-3" aria-hidden>
            {symbol}
          </span>
          <Input
            id={fid}
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => set(e.target.value)}
            placeholder={which === "lo" ? "0" : "Any"}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${fid}-error` : undefined}
            className={cn("h-11 pr-2 tabular", symbol.length > 1 ? "pl-11" : "pl-7")}
          />
        </div>
        {error ? (
          <p id={`${fid}-error`} className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4">
      <div className="flex items-start gap-2">
        {field("lo")}
        {field("hi")}
      </div>
      <Button type="submit" variant="secondary" size="sm" className="mt-3 w-full">
        Apply price range
      </Button>
    </form>
  )
}
