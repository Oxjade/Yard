"use client"

import { useEffect, useId, useState } from "react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Search within the listing. Typing settles for a moment before it touches the URL; Enter
 * applies at once. If the URL changes from elsewhere (Clear all, the search overlay), the
 * field follows it without overwriting what the shopper is typing.
 */
export function CatalogSearch({
  value,
  onCommit,
  placeholder,
  label,
  className,
}: {
  value: string
  onCommit: (q: string) => void
  placeholder: string
  label: string
  className?: string
}) {
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
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && draft) {
            e.preventDefault()
            setDraft("")
            apply("")
          }
        }}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        className="h-11 w-full rounded-md border border-line bg-surface pr-10 pl-10 text-[0.9375rem] text-ink outline-none transition-colors placeholder:text-ink-3 hover:border-ink-3/60 focus-visible:border-violet"
      />
      {draft ? (
        <button
          type="button"
          onClick={() => {
            setDraft("")
            apply("")
          }}
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-elevated hover:text-ink"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </form>
  )
}
