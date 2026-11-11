"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { CurrencyCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { catalogFacetsFromSearch, catalogSearchQuery, panelFilterCount, type CatalogFacets, type CatalogSearchResponse, type CatalogState } from "./catalog-state"
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
  initialFacets,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: CatalogState
  onDraftChange: (patch: FilterPatch) => void
  onApply: () => void
  onClear: () => void
  currency: CurrencyCode
  initialFacets: CatalogFacets
}) {
  const searchKey = JSON.stringify(catalogSearchQuery(draft, currency, undefined, 1))
  const [result, setResult] = useState<{ key: string; response: CatalogSearchResponse } | null>(null)
  const [requestError, setRequestError] = useState<{ key: string; message: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const currentResult = result?.key === searchKey ? result.response : null
  const count = currentResult?.total
  const facets = currentResult ? catalogFacetsFromSearch(currentResult.facets, draft) : initialFacets
  const searchError = requestError?.key === searchKey ? requestError.message : null
  const active = panelFilterCount(draft)
  const [priceValid, setPriceValid] = useState(true)
  // Bumped by "Clear filters" so a typed (not yet valid) range empties too.
  const [clears, setClears] = useState(0)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void api<CatalogSearchResponse>("/api/search", { query: catalogSearchQuery(draft, currency, undefined, 1), signal: controller.signal })
        .then((result) => {
          setResult({ key: searchKey, response: result })
          setRequestError(null)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setRequestError({ key: searchKey, message: errorMessage(error, "Filter results couldn't be checked.") })
        })
    }, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, draft, currency, retry, searchKey])

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
          <Button variant={count === 0 || !priceValid || count === undefined ? "secondary" : "primary"} size="lg" onClick={searchError ? () => setRetry((value) => value + 1) : onApply} disabled={count === 0 || !priceValid || (count === undefined && !searchError)} className="tabular">
            {!priceValid ? "Check the price range" : searchError ? "Retry results" : count === undefined ? "Checking results…" : count === 0 ? "No pieces match" : `Show ${count} ${count === 1 ? "piece" : "pieces"}`}
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
        facets={facets}
      />
      {searchError ? <p role="alert" className="mt-4 text-sm text-danger">{searchError}</p> : null}
    </PhoneSheet>
  )
}
