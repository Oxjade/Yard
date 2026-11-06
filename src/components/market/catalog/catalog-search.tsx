"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { ClockCounterClockwiseIcon as Recent, MagnifyingGlassIcon as Search, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { searchSuggestions, type CatalogState } from "./catalog-state"

/* ---------- recent searches (this browser only) ---------- */

const RECENT_KEY = "nocturne.catalog.recent-searches"
const RECENT_MAX = 5

function readRecent(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]")
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

function writeRecent(list: string[]) {
  try {
    if (list.length) window.localStorage.setItem(RECENT_KEY, JSON.stringify(list))
    else window.localStorage.removeItem(RECENT_KEY)
  } catch {
    // Storage can be blocked (private mode); recent searches are a convenience only.
  }
}

type Option = { term: string; count?: number }

/** Touch screens: after a pick or a submit the keyboard goes away so the results can be seen. */
const coarsePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches

/**
 * Search within the listing, as a combobox. Typing settles for a moment before it touches the
 * URL; Enter applies at once. While the field is focused it offers completions from the
 * catalogue (each with how many pieces it would list under the current filters) or, when it is
 * empty, this browser's recent searches. Arrow keys move through them, Enter picks, Escape closes
 * the list and then clears the field. If the URL changes from elsewhere (Clear all, the search
 * overlay), the field follows it without overwriting what the shopper is typing.
 */
export function CatalogSearch({
  value,
  onCommit,
  state,
  placeholder,
  label,
  className,
}: {
  value: string
  onCommit: (q: string) => void
  /** The listing's current state, so each suggestion's count matches what it would show. */
  state: CatalogState
  placeholder: string
  label: string
  className?: string
}) {
  const id = useId()
  const listId = `${id}-list`
  const rootRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(value)
  const [committed, setCommitted] = useState(value)
  const [synced, setSynced] = useState(value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [recent, setRecent] = useState<string[]>([])
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

  const typed = draft.trim()
  const suggestions = useMemo(() => (typed.length >= 2 ? searchSuggestions(typed, state) : []), [typed, state])
  const mode: "suggest" | "recent" | null = typed.length >= 2 ? (suggestions.length ? "suggest" : null) : typed.length === 0 && recent.length ? "recent" : null
  const options: Option[] = mode === "suggest" ? suggestions : mode === "recent" ? recent.map((term) => ({ term })) : []
  const expanded = open && options.length > 0
  const activeIndex = expanded && active < options.length ? active : -1

  function remember(term: string) {
    if (term.length < 2) return
    const next = [term, ...readRecent().filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(0, RECENT_MAX)
    writeRecent(next)
    setRecent(next)
  }

  function apply(term: string) {
    setCommitted(term)
    onCommit(term)
  }

  /** Keyboard and mouse keep their place in the field; a touch screen drops the keyboard. */
  function settleFocus() {
    if (coarsePointer()) inputRef.current?.blur()
    else inputRef.current?.focus()
  }

  function pick(term: string) {
    setDraft(term)
    apply(term)
    remember(term)
    setOpen(false)
    setActive(-1)
    settleFocus()
  }

  function clearRecent() {
    writeRecent([])
    setRecent([])
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!options.length) return
      e.preventDefault()
      if (!expanded) {
        setOpen(true)
        setActive(e.key === "ArrowDown" ? 0 : options.length - 1)
        return
      }
      const n = options.length
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : i <= 0 ? n - 1 : i - 1))
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault()
      pick(options[activeIndex].term)
    } else if (e.key === "Escape") {
      if (expanded) {
        e.preventDefault()
        setOpen(false)
        setActive(-1)
      } else if (draft) {
        e.preventDefault()
        setDraft("")
        apply("")
      }
    }
  }

  return (
    <form
      ref={rootRef}
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        apply(typed)
        remember(typed)
        setOpen(false)
        if (coarsePointer()) inputRef.current?.blur()
      }}
      onBlur={(e) => {
        // Close once focus leaves the field and its list (the Clear button is inside).
        if (rootRef.current?.contains(e.relatedTarget as Node | null)) return
        setOpen(false)
        setActive(-1)
        if (committed.length >= 2 && committed === typed) remember(committed)
      }}
      className={cn("relative z-20", className)}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => {
          setRecent(readRecent())
          setOpen(true)
        }}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={80}
        className="h-11 w-full rounded-md border border-line bg-surface pr-11 pl-10 text-[0.9375rem] text-ink outline-none transition-colors duration-150 placeholder:text-ink-3 hover:border-ink-3/60 focus-visible:border-violet"
      />
      <AnimatePresence initial={false}>
        {draft ? (
          <motion.button
            key="clear"
            type="button"
            onClick={() => {
              setDraft("")
              apply("")
              setActive(-1)
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: duration.press, ease: ease.out }}
            className="absolute top-1/2 right-1 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-elevated hover:text-ink"
          >
            <X className="size-4" />
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {expanded ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: -4, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99, transition: { duration: duration.tooltip, ease: ease.in } }}
            transition={{ duration: duration.dropdown, ease: ease.out }}
            className="glass-strong absolute inset-x-0 top-full mt-2 origin-top overflow-hidden rounded-lg p-1 shadow-md ring-1 ring-foreground/10"
          >
            <div className="flex h-8 items-center justify-between px-2.5">
              <p className="text-xs text-ink-3">{mode === "recent" ? "Recent searches" : "Suggestions"}</p>
              {mode === "recent" ? (
                <button
                  type="button"
                  onClick={clearRecent}
                  aria-label="Clear recent searches"
                  className="-my-1 -mr-1.5 inline-flex min-h-10 items-center rounded-md px-2.5 text-xs text-ink-2 transition-colors hover:text-ink"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <ul id={listId} role="listbox" aria-label={mode === "recent" ? "Recent searches" : "Suggestions"}>
              {options.map((o, i) => (
                <li
                  key={o.term}
                  id={`${id}-opt-${i}`}
                  role="option"
                  aria-label={o.count !== undefined ? `${o.term}, ${o.count} ${o.count === 1 ? "piece" : "pieces"}` : undefined}
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(o.term)}
                  className={cn(
                    "flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm transition-colors duration-100",
                    i === activeIndex ? "bg-white/8 text-ink" : "text-ink-2",
                  )}
                >
                  {mode === "recent" ? <Recent className="size-4 shrink-0 text-ink-3" aria-hidden /> : <Search className="size-4 shrink-0 text-ink-3" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{mode === "suggest" ? <Highlight text={o.term} match={typed} /> : o.term}</span>
                  {o.count !== undefined ? (
                    <span className="shrink-0 text-xs text-ink-3 tabular">
                      {o.count} {o.count === 1 ? "piece" : "pieces"}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </form>
  )
}

/** The typed part of a suggestion in full white, the rest in grey. */
function Highlight({ text, match }: { text: string; match: string }) {
  const at = text.toLowerCase().indexOf(match.toLowerCase())
  if (at === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <span className="text-ink">{text.slice(at, at + match.length)}</span>
      {text.slice(at + match.length)}
    </>
  )
}
