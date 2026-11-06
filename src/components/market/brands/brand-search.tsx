"use client"

import { useEffect, useId, useState } from "react"
import { MagnifyingGlassIcon as Search, XIcon as X } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

/**
 * The directory's search field, styled like the shop's. Typing settles for a moment before it
 * touches the URL; Enter applies at once; Escape clears. If the URL changes from elsewhere
 * (Clear all, an applied-filter chip, Back), the field follows it without overwriting what the
 * shopper is typing. Brands match on name, city, tagline and description; the shop's search
 * suggests pieces with counts, which would not fit a list of brands.
 */
export function BrandSearch({ value, onCommit, className }: { value: string; onCommit: (q: string) => void; className?: string }) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)
  const [synced, setSynced] = useState(value)
  if (value !== synced) {
    setSynced(value)
    if (value !== committed) {
      setDraft(value)
      setCommitted(value)
    }
  }

  useEffect(() => {
    const term = draft.trim()
    if (term === committed) return
    const t = window.setTimeout(() => {
      setCommitted(term)
      onCommit(term)
    }, 380)
    return () => window.clearTimeout(t)
  }, [draft, committed, onCommit])

  function apply(term: string) {
    setCommitted(term)
    onCommit(term)
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        apply(draft.trim())
      }}
      className={cn("relative", className)}
    >
      <label htmlFor={id} className="sr-only">
        Search brands
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        id={id}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.preventDefault()
            setDraft("")
            apply("")
          }
        }}
        placeholder="Search brands or cities"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        className="h-11 w-full appearance-none rounded-md border border-line bg-surface pr-11 pl-10 text-[0.9375rem] text-ink outline-none transition-colors duration-150 placeholder:text-ink-3 hover:border-ink-3/60 focus-visible:border-violet [&::-webkit-search-cancel-button]:hidden"
      />
      {draft ? (
        <button
          type="button"
          onClick={() => {
            setDraft("")
            apply("")
          }}
          aria-label="Clear search"
          className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 outline-none hover:bg-elevated hover:text-ink focus-visible:ring-2 focus-visible:ring-violet"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </form>
  )
}
