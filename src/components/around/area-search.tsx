"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { MagnifyingGlassIcon, MapPinAreaIcon, XIcon } from "@phosphor-icons/react"
import { areaBySlug, cities, searchAreas, type AreaHit } from "@/lib/around/gazetteer"
import { countryName } from "@/lib/around/geo"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { chooseArea, useAroundUi } from "./around-store"

/**
 * AreaSearch (§6.4): a combobox over the local gazetteer (cities, neighbourhoods and aliases,
 * accents ignored). Typing never leaves the device. Choosing a result saves the area and flies the
 * map there. `variant="circle"` is the 40 px glass circle the phone map header mounts (N); it
 * expands into a full-width glass field over the header row. `variant="inline"` sits at the top
 * of the desktop panel.
 */
export function AreaSearch({ variant, placement = "header", className, onChosen }: { variant: "inline" | "circle"; placement?: "header" | "page"; className?: string; onChosen?: (hit: AreaHit) => void }) {
  if (variant === "circle") return <CircleSearch placement={placement} className={className} onChosen={onChosen} />
  return <SearchField className={className} onChosen={onChosen} />
}

const featured = ["lagos", "london", "seoul"]
const coveredHint = `Try ${featured.map((s) => cities.find((c) => c.slug === s)!.name).join(", ")}…`

function CircleSearch({ placement, className, onChosen }: { placement: "header" | "page"; className?: string; onChosen?: (hit: AreaHit) => void }) {
  const open = useAroundUi((s) => s.searchOpen)
  const setOpen = useAroundUi((s) => s.setSearchOpen)
  const mountHeader = useAroundUi((s) => s.mountHeaderSearch)
  const headerCount = useAroundUi((s) => s.headerSearch)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  // The header's circle (N's map chrome) wins: the page only shows its own while there is none.
  useEffect(() => (placement === "header" ? mountHeader() : undefined), [placement, mountHeader])
  if (placement === "page" && headerCount > 0) return null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search a city or neighbourhood"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={cn("glass inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink outline-none transition-transform focus-visible:ring-2 focus-visible:ring-violet active:scale-95", className)}
      >
        <MagnifyingGlassIcon className="size-[18px]" aria-hidden />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            id={panelId}
            key="area-search"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: duration.dropdown, ease: ease.out } }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.14, ease: ease.in } }}
            className="fixed inset-x-3 top-3 z-[60] lg:hidden"
          >
            <SearchField
              autoFocus
              floating
              onCancel={() => {
                setOpen(false)
                triggerRef.current?.focus()
              }}
              onChosen={(hit) => {
                onChosen?.(hit)
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

function SearchField({ autoFocus, floating = false, onCancel, onChosen, className }: { autoFocus?: boolean; floating?: boolean; onCancel?: () => void; onChosen?: (hit: AreaHit) => void; className?: string }) {
  const router = useRouter()
  const uid = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState("")
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(0)
  const focusNonce = useAroundUi((s) => s.focusNonce)
  const results = useMemo(() => searchAreas(q, 8), [q])
  const query = q.trim()
  const show = focused || floating
  const listId = `${uid}-list`

  useEffect(() => {
    if (focusNonce && !floating) inputRef.current?.focus()
  }, [focusNonce, floating])

  function pick(hit: AreaHit) {
    setQ("")
    setFocused(false)
    inputRef.current?.blur()
    chooseArea(hit.slug, (href) => router.push(href))
    onChosen?.(hit)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === "Enter") {
      const hit = results[active]
      if (hit) {
        e.preventDefault()
        pick(hit)
      }
    } else if (e.key === "Escape") {
      e.preventDefault()
      if (q) setQ("")
      else {
        inputRef.current?.blur()
        setFocused(false)
        onCancel?.()
      }
    }
  }

  const showList = show && query.length > 0 && results.length > 0
  const showNone = show && query.length > 0 && results.length === 0
  const showCities = show && query.length === 0

  return (
    <div
      className={cn("relative", className)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
    >
      <div className={cn("flex items-center gap-2", floating && "glass-strong rounded-2xl p-1.5")}>
        <label htmlFor={`${uid}-input`} className="sr-only">
          Search a city or neighbourhood
        </label>
        <div className={cn("relative flex h-11 min-w-0 flex-1 items-center rounded-xl border border-white/10 bg-obsidian/60", floating && "border-transparent bg-transparent")}>
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 size-4 text-ink-2" aria-hidden />
          <input
            ref={inputRef}
            id={`${uid}-input`}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && results[active] ? `${uid}-opt-${active}` : undefined}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            value={q}
            placeholder="Search a city or neighbourhood"
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={onKeyDown}
            className="h-full w-full min-w-0 bg-transparent pr-9 pl-9 text-[0.9375rem] text-ink outline-none placeholder:text-ink-2 md:text-sm"
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1 inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:text-ink">
              <XIcon className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="h-11 shrink-0 rounded-xl px-3 text-sm text-ink-2 hover:text-ink">
            Cancel
          </button>
        ) : null}
      </div>

      <div className={cn(floating ? "glass-strong mt-2 rounded-2xl" : "absolute inset-x-0 top-full z-30 mt-1.5 rounded-xl border border-white/10 bg-[var(--glass-bg-strong)] shadow-[var(--glass-shadow)] backdrop-blur-xl", !(showList || showNone || showCities) && "hidden")}>
        <ul id={listId} role="listbox" aria-label="Areas" className={cn("max-h-[50dvh] overflow-y-auto p-1.5", !showList && "hidden")}>
          {results.map((hit, i) => (
            <li
              key={hit.slug}
              id={`${uid}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(hit)}
              className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", i === active ? "bg-white/[0.07]" : "")}
            >
              <MapPinAreaIcon className="size-4 shrink-0 text-ink-2" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{hit.label}</span>
                <span className="block truncate text-xs text-ink-2">{hit.kind === "city" ? `City in ${countryName(hit.city.country)}` : `Neighbourhood in ${hit.city.name}`}</span>
              </span>
            </li>
          ))}
        </ul>
        {showNone ? (
          <div className="p-3" role="status">
            <p className="text-sm text-ink">We don&apos;t cover {query} yet. {coveredHint}</p>
            <CityChips onPick={pick} className="mt-3" />
          </div>
        ) : null}
        {showCities ? (
          <div className="p-3">
            <p className="text-xs text-ink-2">Cities on Yard Around</p>
            <CityChips onPick={pick} className="mt-2" />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CityChips({ onPick, className }: { onPick: (hit: AreaHit) => void; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)} aria-label="Covered cities">
      {cities.map((c) => (
        <li key={c.slug}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const hit = areaBySlug(c.slug)
              if (hit) onPick(hit)
            }}
            className="inline-flex h-10 items-center rounded-full border border-white/10 px-3.5 text-[13px] text-ink transition-colors hover:border-white/25 hover:bg-white/[0.05] md:h-8 md:px-3 md:text-xs"
          >
            {c.name}
          </button>
        </li>
      ))}
    </ul>
  )
}
