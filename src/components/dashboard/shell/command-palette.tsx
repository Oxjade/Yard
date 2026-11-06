"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Command as CommandPrimitive } from "cmdk"
import { ArrowElbowDownLeftIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useModKey } from "./platform"
import { isTypingTarget } from "./use-sidebar"
import type { ShellDestination, ShellIcon, ShellNavGroup, ShellSearch } from "./types"

/**
 * A query as the palette searches it: trimmed, lower case, and without the "#" that order
 * references are written with everywhere ("#LS-10456" finds LS-10456).
 */
export function normaliseQuery(query: string) {
  return query.trim().toLowerCase().replace(/(^|\s)#+/g, "$1").trim()
}

/** The query's whitespace-separated terms. */
export function queryTerms(query: string) {
  return normaliseQuery(query).split(/\s+/).filter(Boolean)
}

/** Every whitespace-separated term of the query appears somewhere in the text. */
export function matches(query: string, ...fields: (string | undefined | null)[]) {
  const terms = queryTerms(query)
  if (!terms.length) return false
  const hay = fields.filter(Boolean).join(" ").toLowerCase()
  return terms.every((t) => hay.includes(t))
}

/** The first `limit` records matching the query, with those whose title starts with it first. */
export function topMatches<T>(rows: T[], query: string, title: (r: T) => string, fields: (r: T) => (string | undefined | null)[], limit = 5) {
  const q = normaliseQuery(query)
  if (!q) return []
  const hits = rows.filter((r) => matches(q, title(r), ...fields(r)))
  hits.sort((a, b) => Number(title(b).toLowerCase().startsWith(q)) - Number(title(a).toLowerCase().startsWith(q)))
  return hits.slice(0, limit)
}

export function PaletteGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <CommandGroup heading={heading} className="p-1 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1.5 **:[[cmdk-group-heading]]:text-[11px] **:[[cmdk-group-heading]]:font-normal **:[[cmdk-group-heading]]:text-ink-3">
      {children}
    </CommandGroup>
  )
}

/** One result row: icon tile, title, a muted line, and an optional right-hand meta. */
export function PaletteItem({ value, icon: Icon, title, detail, meta, onSelect }: { value: string; icon: ShellIcon; title: string; detail?: string; meta?: string; onSelect: () => void }) {
  return (
    <CommandItem value={value} onSelect={onSelect} className="group/pi gap-3 rounded-xl px-2.5 py-2 data-selected:bg-white/[0.06]">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-ink-3 group-data-selected/pi:text-violet">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] text-ink">{title}</span>
        {detail ? <span className="mt-0.5 block truncate text-[12px] text-ink-3">{detail}</span> : null}
      </span>
      {meta ? <span data-slot="command-shortcut" className="ml-2 shrink-0 text-[12px] text-ink-3 tabular">{meta}</span> : null}
      <ArrowElbowDownLeftIcon aria-hidden className="size-3.5 shrink-0 text-ink-3 opacity-0 group-data-selected/pi:opacity-100" />
    </CommandItem>
  )
}

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] px-1.5 font-sans text-[11px] leading-none text-ink-2", className)}>{children}</kbd>
}

/**
 * The command palette: "Go to" every destination of the surface, plus record results from
 * local data. Opened by the top-bar search capsule, "/" and ⌘K / Ctrl+K (never while typing
 * in a field or while another dialog is open). Enter navigates.
 *
 * Built like ui/command's CommandDialog (same Dialog and Command parts), plus focus return:
 * the palette is opened from outside its Dialog (capsule or hotkey), so Radix has no trigger
 * to refocus on close; it goes back to whatever had focus when the palette opened.
 */
export function CommandPalette({ open, onOpenChange, groups, search }: { open: boolean; onOpenChange: (open: boolean) => void; groups: ShellNavGroup[]; search: ShellSearch }) {
  const router = useRouter()
  const mod = useModKey()
  const [query, setQuery] = useState("")
  const returnTo = useRef<HTMLElement | null>(null)
  // Runs before the dialog's own focus effect moves focus into the input.
  useLayoutEffect(() => {
    if (open) returnTo.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
  }, [open])
  const q = normaliseQuery(query)

  const destinations = useMemo<(ShellDestination & { group?: string })[]>(
    () => [...groups.flatMap((g) => g.items.map((i) => ({ label: i.label, href: i.href, icon: i.icon, hint: g.label, group: g.label }))), ...(search.destinations ?? [])],
    [groups, search.destinations],
  )
  const shownDestinations = q ? destinations.filter((d) => matches(q, d.label, d.hint)) : destinations

  function go(href: string) {
    returnTo.current = null // the route changes; nothing to return to
    onOpenChange(false)
    setQuery("")
    router.push(href)
  }

  const { Results } = search
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setQuery("")
      }}
    >
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          returnTo.current?.focus()
          returnTo.current = null
        }}
        className="top-[10vh] max-w-[calc(100%-1.5rem)] translate-y-0 overflow-hidden rounded-2xl! border-white/10 p-0 sm:top-[14vh] sm:max-w-[600px]"
      >
      {/* Inside the content, so the title and description exist only while the palette is open. */}
      <DialogHeader className="sr-only">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription>{search.placeholder}</DialogDescription>
      </DialogHeader>
      <Command shouldFilter={false} loop className="rounded-2xl! bg-transparent p-0">
        <div className="flex items-center gap-3 border-b border-white/[0.07] pr-3 pl-4">
          <MagnifyingGlassIcon aria-hidden className="size-5 shrink-0 text-ink-3" />
          <CommandPrimitive.Input
            value={query}
            onValueChange={setQuery}
            placeholder={search.placeholder}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          {/* Phones have no Esc key: there it is a 40px round close button. */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="-mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] text-ink-2 transition-colors hover:text-ink sm:mr-0 sm:h-7 sm:w-auto sm:rounded-md sm:px-2"
            aria-label="Close search"
          >
            <XIcon aria-hidden className="size-4 sm:hidden" />
            <span className="hidden sm:inline">Esc</span>
          </button>
        </div>
        <CommandList className="max-h-[min(58vh,460px)] p-1.5">
          <CommandEmpty className="px-6 py-12 text-center text-[13px] text-ink-2">No matches for “{query.trim()}”</CommandEmpty>
          {shownDestinations.length ? (
            <PaletteGroup heading="Go to">
              {shownDestinations.map((d) => (
                <PaletteItem key={d.href} value={`go ${d.href}`} icon={d.icon} title={d.label} meta={d.hint} onSelect={() => go(d.href)} />
              ))}
            </PaletteGroup>
          ) : null}
          <Results query={q} go={go} />
        </CommandList>
        <div className="hidden items-center gap-4 border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-ink-3 sm:flex">
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>
              <ArrowElbowDownLeftIcon className="size-3" />
            </Kbd>{" "}
            to open
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>/</Kbd> or <Kbd>{mod === "⌘" ? "⌘K" : "Ctrl K"}</Kbd> to search from anywhere
          </span>
        </div>
      </Command>
      </DialogContent>
    </Dialog>
  )
}

/** "/" and ⌘K / Ctrl+K open the palette, unless focus is in a field or another dialog is open. */
export function usePaletteHotkeys(open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmdK = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey
      if (!cmdK && !slash) return
      if (open) {
        if (cmdK) {
          e.preventDefault()
          setOpen(false)
        }
        return
      }
      if (isTypingTarget(e.target)) return
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]')) return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, setOpen])
}
