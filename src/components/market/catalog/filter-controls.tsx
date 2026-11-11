"use client"

import { useEffect, useId, useState } from "react"
import { BrandMark } from "@/components/market/brand-mark"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { currencies, type CurrencyCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { convert, formatMoney, toMajor, toMinor } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Chip, ChipRadioGroup } from "./chip"
import { brandFacetEntries, catalogSearchKey, catalogSearchQuery, priceBands, sortOptions, type CatalogBrandFacet, type CatalogFacets, type CatalogSearchResponse, type CatalogState } from "./catalog-state"

/* ---------- price labels in the shopper's currency ---------- */

function money(usd: number, currency: CurrencyCode) {
  return formatMoney(convert(toMinor(usd, "USD"), "USD", currency), currency, { compact: currency !== "USD" })
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

const pieces = (n: number) => `${n} ${n === 1 ? "piece" : "pieces"}`

/**
 * Every filter the panel (desktop) and the sheet (phone) offer. Controlled: it renders the
 * state it is given and reports changes, so the sheet can work on a draft.
 *
 * The custom price range commits two ways. On the desktop panel ("apply") it has its own Apply
 * button, because every change there rewrites the listing. In the phone sheet ("live") the typed
 * range goes into the draft as soon as it is valid, so the sheet's one footer button includes it;
 * while it is not valid the sheet is told (onPriceValidityChange) and holds its footer.
 */
export function FilterControls({
  state,
  onChange,
  currency,
  showSort = false,
  priceMode = "apply",
  onPriceValidityChange,
  resetKey,
  className,
  facets,
}: {
  state: CatalogState
  onChange: (patch: FilterPatch) => void
  currency: CurrencyCode
  showSort?: boolean
  priceMode?: "apply" | "live"
  onPriceValidityChange?: (valid: boolean) => void
  /** Changing it empties the typed price range, even when the draft's min and max did not change. */
  resetKey?: number
  className?: string
  facets: CatalogFacets
}) {
  const [allBrands, setAllBrands] = useState(false)
  const id = useId()
  // The brand facet is paged on the server: "More brands" loads the next page for these filters.
  const brandQuery = catalogSearchQuery(state, currency, undefined, 1)
  const brandKey = catalogSearchKey({ ...brandQuery, sort: undefined })
  const [moreBrands, setMoreBrands] = useState<{ key: string; base: string | null; rows: CatalogBrandFacet[]; next: string | null } | null>(null)
  const [brandsLoading, setBrandsLoading] = useState(false)
  const [brandsError, setBrandsError] = useState<string | null>(null)
  const extra = moreBrands?.key === brandKey && moreBrands.base === facets.brandsNextCursor ? moreBrands : null
  const brandList = extra ? [...facets.brandFacet.filter(({ brand }) => !extra.rows.some((row) => row.brand.handle === brand.handle)), ...extra.rows] : facets.brandFacet
  const brandsNext = extra ? extra.next : facets.brandsNextCursor
  const brandRows = allBrands ? brandList : brandList.slice(0, 6)

  async function loadMoreBrands() {
    if (!brandsNext) return
    setBrandsLoading(true)
    setBrandsError(null)
    try {
      const result = await api<CatalogSearchResponse>("/api/search", { query: { ...brandQuery, brandCursor: brandsNext } })
      setMoreBrands({ key: brandKey, base: facets.brandsNextCursor, rows: [...(extra?.rows ?? []), ...brandFacetEntries(result.facets.brands)], next: result.facets.brandsNextCursor ?? null })
      setAllBrands(true)
    } catch (error) {
      setBrandsError(errorMessage(error, "More brands couldn't be loaded."))
    } finally {
      setBrandsLoading(false)
    }
  }

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  return (
    <div className={cn("divide-y divide-line-soft", className)}>
      {showSort ? (
        <FilterSection title="Sort">
          <ChipRadioGroup label="Sort" className="flex flex-wrap gap-2">
            {sortOptions.map((o) => (
              <Chip key={o.value} radio size="sm" layoutId={`${id}-sort`} selected={state.sort === o.value} onClick={() => onChange({ sort: o.value })}>
                {o.label}
              </Chip>
            ))}
          </ChipRadioGroup>
        </FilterSection>
      ) : null}

      <FilterSection title="Price" note={currency !== "USD" ? `Shown in ${currency} at an indicative rate.` : undefined}>
        {/* At most one band, and none is a valid choice: toggles (a second press clears it). */}
        <div role="group" aria-label="Price band" className="flex flex-wrap gap-2">
          {facets.priceFacet.map((band) => {
            const selected = state.min === band.min && state.max === band.max
            const label = priceLabel(band.min, band.max, currency)
            return (
              <Chip
                key={`${band.min}-${band.max}`}
                size="sm"
                selected={selected}
                count={band.count}
                disabled={!selected && band.count === 0}
                onClick={() => onChange(selected ? { min: undefined, max: undefined } : { min: band.min, max: band.max })}
                aria-label={`${label}, ${pieces(band.count)}`}
              >
                {label}
              </Chip>
            )
          })}
        </div>
        <PriceRange
          min={state.min}
          max={state.max}
          currency={currency}
          mode={priceMode}
          resetKey={resetKey}
          onApply={(min, max) => onChange({ min, max })}
          onValidityChange={onPriceValidityChange}
        />
      </FilterSection>

      {brandList.length ? (
        <FilterSection title="Brands" count={state.brands.length || undefined}>
          <ul className="grid gap-0.5">
            {brandRows.map(({ brand, count }) => {
              const checked = state.brands.includes(brand.handle)
              const cid = `${id}-brand-${brand.handle}`
              return (
                <li key={brand.id}>
                  <div className={cn("flex min-h-10 items-center gap-3 rounded-md px-1 transition-colors duration-150 hover:bg-card lg:min-h-9", count === 0 && !checked && "opacity-50")}>
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
          {brandList.length > 6 ? (
            <button type="button" onClick={() => setAllBrands((v) => !v)} className="mt-2 min-h-10 rounded-md px-1 text-sm text-violet underline-offset-4 hover:underline lg:min-h-9" aria-expanded={allBrands}>
              {allBrands ? "Show fewer brands" : brandsNext ? `Show ${brandList.length} brands` : `Show all ${brandList.length} brands`}
            </button>
          ) : null}
          {brandsNext && (allBrands || brandList.length <= 6) ? (
            <button type="button" onClick={() => void loadMoreBrands()} disabled={brandsLoading} className="mt-1 block min-h-10 rounded-md px-1 text-sm text-violet underline-offset-4 hover:underline disabled:opacity-60 lg:min-h-9">
              {brandsLoading ? "Loading brands…" : brandsError ? "Retry loading more brands" : "Load more brands"}
            </button>
          ) : null}
          {brandsError ? (
            <p role="alert" className="mt-1 px-1 text-sm text-danger">
              {brandsError}
            </p>
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
                        aria-label={`${group.label} ${value}, ${pieces(count)}`}
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
        <div className="flex min-h-10 items-center justify-between gap-4">
          <Label htmlFor={`${id}-stock`} className="cursor-pointer font-normal text-ink-2">
            In stock only
            <span className="tabular text-xs text-ink-3">{facets.inStockCount}</span>
          </Label>
          {/* Named explicitly (like the size chips) so the count reads with its unit. */}
          <Switch
            id={`${id}-stock`}
            checked={state.inStock}
            onCheckedChange={(v) => onChange({ inStock: v })}
            aria-label={`In stock only, ${pieces(facets.inStockCount)}`}
          />
        </div>
      </FilterSection>

      {facets.countryFacet.length > 1 || state.country ? (
        <FilterSection title="Brand country">
          <div role="group" aria-label="Brand country" className="flex flex-wrap gap-2">
            {facets.countryFacet.map((c) => {
              const selected = state.country === c.code
              return (
                <Chip
                  key={c.code}
                  size="sm"
                  selected={selected}
                  count={c.count}
                  disabled={!selected && c.count === 0}
                  onClick={() => onChange({ country: selected ? undefined : c.code })}
                  aria-label={`${c.name}, ${pieces(c.count)}`}
                >
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

type RangeErrors = { lo?: string; hi?: string }

const parseAmount = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(/[\s,]/g, "")))

/** Format errors belong to one field; "max below min" is a cross-field error, kept on Max. */
function validateRange(lo: string, hi: string): { errors: RangeErrors; crossField: boolean; a?: number; b?: number } {
  const a = parseAmount(lo)
  const b = parseAmount(hi)
  const errors: RangeErrors = {}
  if (a !== undefined && (!Number.isFinite(a) || a < 0)) errors.lo = "Enter an amount of zero or more."
  if (b !== undefined && (!Number.isFinite(b) || b <= 0)) errors.hi = "Enter an amount above zero."
  let crossField = false
  if (!errors.lo && !errors.hi && a !== undefined && b !== undefined && a > b) {
    errors.hi = "Max must be higher than min."
    crossField = true
  }
  return { errors, crossField, a, b }
}

function PriceRange({
  min,
  max,
  currency,
  mode,
  resetKey = 0,
  onApply,
  onValidityChange,
}: {
  min?: number
  max?: number
  currency: CurrencyCode
  mode: "apply" | "live"
  resetKey?: number
  onApply: (min: number | undefined, max: number | undefined) => void
  onValidityChange?: (valid: boolean) => void
}) {
  const id = useId()
  const live = mode === "live"
  const toDisplay = (usd?: number) => (usd === undefined ? "" : String(Math.round(toMajor(convert(toMinor(usd, "USD"), "USD", currency), currency))))
  const toUsd = (value: number | undefined, round: (n: number) => number) =>
    value === undefined ? undefined : round(toMajor(convert(toMinor(value, currency), currency, "USD"), "USD"))
  const keyOf = (lo?: number, hi?: number) => `${lo}|${hi}|${currency}|${resetKey}`

  // Keep the inputs in step with the URL or draft (a band chip or "Clear filters" changes min/max).
  const key = keyOf(min, max)
  const [synced, setSynced] = useState(key)
  const [lo, setLo] = useState(toDisplay(min))
  const [hi, setHi] = useState(toDisplay(max))
  const [errors, setErrors] = useState<RangeErrors>({})
  // Live mode: errors show once a field has been left (or at once for a malformed amount).
  const [touched, setTouched] = useState<{ lo?: boolean; hi?: boolean }>({})
  if (synced !== key) {
    setSynced(key)
    setLo(toDisplay(min))
    setHi(toDisplay(max))
    setErrors({})
    setTouched({})
  }

  const check = validateRange(lo, hi)
  const invalid = Boolean(check.errors.lo || check.errors.hi)
  useEffect(() => {
    onValidityChange?.(!invalid)
  }, [invalid, onValidityChange])
  // A sheet that closes with a half-typed range must not stay held.
  useEffect(() => () => onValidityChange?.(true), [onValidityChange])

  const shown: RangeErrors = live
    ? {
        lo: check.errors.lo,
        // "Max below min" waits until Max has been left, so typing 1, 10, 100 never flashes it.
        hi: check.errors.hi && (!check.crossField || touched.hi) ? check.errors.hi : undefined,
      }
    : errors

  /** Live mode: a valid range goes straight into the draft (the inputs keep what was typed). */
  function commitLive(nextLo: string, nextHi: string) {
    const next = validateRange(nextLo, nextHi)
    if (next.errors.lo || next.errors.hi) return
    const usdMin = toUsd(next.a, Math.floor)
    const usdMax = toUsd(next.b, Math.ceil)
    if (usdMin === min && usdMax === max) return
    setSynced(keyOf(usdMin, usdMax))
    onApply(usdMin, usdMax)
  }

  /**
   * Live mode: Enter shows any error and, on a touch screen, puts the keyboard away (the range is
   * already in the draft). A hardware keyboard keeps its place in the field.
   */
  function finishTyping(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!live || e.key !== "Enter") return
    e.preventDefault()
    setTouched({ lo: true, hi: true })
    if (window.matchMedia("(pointer: coarse)").matches) e.currentTarget.blur()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (live) return
    setErrors(check.errors)
    if (invalid) return
    onApply(toUsd(check.a, Math.floor), toUsd(check.b, Math.ceil))
  }

  const symbol = currencies[currency].symbol
  const field = (which: "lo" | "hi") => {
    const value = which === "lo" ? lo : hi
    const error = shown[which]
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
            enterKeyHint={live ? "done" : "go"}
            autoComplete="off"
            value={value}
            onChange={(e) => {
              const v = e.target.value
              if (which === "lo") setLo(v)
              else setHi(v)
              if (live) commitLive(which === "lo" ? v : lo, which === "hi" ? v : hi)
              // A shown error follows the value, so it clears the moment the amount is fixed.
              else if (errors[which]) setErrors(validateRange(which === "lo" ? v : lo, which === "hi" ? v : hi).errors)
            }}
            onBlur={() => live && setTouched((t) => ({ ...t, [which]: true }))}
            onKeyDown={finishTyping}
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
    <form onSubmit={submit} noValidate className="mt-4" aria-label="Custom price range">
      <div className="flex items-start gap-2">
        {field("lo")}
        {field("hi")}
      </div>
      {live ? null : (
        <Button type="submit" variant="secondary" size="sm" className="mt-3 h-10 w-full lg:h-8">
          Apply price range
        </Button>
      )}
    </form>
  )
}
