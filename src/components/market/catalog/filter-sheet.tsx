"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import type { CurrencyCode } from "@/config/markets"
import { filterProducts, panelFilterCount, type CatalogState } from "./catalog-state"
import { FilterControls, type FilterPatch } from "./filter-controls"
import { PhoneSheet } from "./phone-sheet"

/**
 * The phone filter sheet. It edits a draft: "Show N pieces" applies it, closing (drag down,
 * tap outside, Escape) discards it. The count is the real result of the draft, and a typed
 * price range is part of the draft as soon as it is valid, so the footer is the sheet's only
 * apply button. While the typed range is not valid the footer says so and waits.
 */
export function FilterSheet({
  open,
  onOpenChange,
  draft,
  onDraftChange,
  onApply,
  onClear,
  currency,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: CatalogState
  onDraftChange: (patch: FilterPatch) => void
  onApply: () => void
  onClear: () => void
  currency: CurrencyCode
}) {
  const count = useMemo(() => filterProducts(draft).length, [draft])
  const active = panelFilterCount(draft)
  const [priceValid, setPriceValid] = useState(true)
  // Bumped by "Clear filters" so a typed (not yet valid) range empties too.
  const [clears, setClears] = useState(0)

  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      closeLabel="Close filters"
      title={
        <>
          <span>Filter and sort</span>
          {active ? <span className="font-sans text-sm normal-case text-ink-2 tabular">{active} active</span> : null}
        </>
      }
      footerClassName="grid grid-cols-[auto_1fr] gap-2"
      footer={
        <>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              setClears((n) => n + 1)
              onClear()
            }}
            disabled={active === 0 && priceValid}
          >
            Clear filters
          </Button>
          {/* Acid only while it can apply; a held footer is the quiet secondary, not a dimmed acid slab. */}
          <Button variant={count === 0 || !priceValid ? "secondary" : "primary"} size="lg" onClick={onApply} disabled={count === 0 || !priceValid} className="tabular">
            {!priceValid ? "Check the price range" : count === 0 ? "No pieces match" : `Show ${count} ${count === 1 ? "piece" : "pieces"}`}
          </Button>
        </>
      }
    >
      <FilterControls
        state={draft}
        onChange={onDraftChange}
        currency={currency}
        showSort
        priceMode="live"
        onPriceValidityChange={setPriceValid}
        resetKey={clears}
      />
    </PhoneSheet>
  )
}
