"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CaretDownIcon, CaretUpIcon, CircleNotchIcon, XIcon } from "@phosphor-icons/react"
import { getThread, type InboxSide } from "@/lib/api/inbox"
import type { ScrollerApi } from "./thread-scroller"
import type { ThreadState } from "./use-thread"

/**
 * In-thread search (§6.2): the server returns matching seqs (delivered messages and your own held
 * ones only); ↑/↓ step through them, loading older pages when a match is further back.
 */
export function useThreadSearch(side: InboxSide, conversationId: string | null, thread: ThreadState, scroller: React.RefObject<ScrollerApi | null>) {
  const [open, setOpenState] = useState(false)
  const [q, setQ] = useState("")
  const [result, setResult] = useState<{ term: string; seqs: number[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [index, setIndex] = useState(0)
  const [forId, setForId] = useState(conversationId)
  const ensure = thread.ensureLoaded

  // Another conversation opened: start over (adjusting state while rendering, not in an effect).
  if (forId !== conversationId) {
    setForId(conversationId)
    setOpenState(false)
    setQ("")
    setResult(null)
  }

  const term = q.trim()
  useEffect(() => {
    if (!open || !conversationId || term.length < 2) return
    let alive = true
    const t = window.setTimeout(() => {
      setLoading(true)
      getThread(side, conversationId, { q: term, limit: 1 })
        .then((r) => {
          if (!alive) return
          const m = r.matches ?? []
          setResult({ term, seqs: m })
          setIndex(m.length ? m.length - 1 : 0)
        })
        .catch(() => alive && setResult({ term, seqs: [] }))
        .finally(() => alive && setLoading(false))
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [term, open, conversationId, side])

  const matches = open && term.length >= 2 && result?.term === term ? result.seqs : null
  const active = matches && matches.length ? matches[Math.min(index, matches.length - 1)] : null
  useEffect(() => {
    if (active == null) return
    void ensure(active).then(() => requestAnimationFrame(() => scroller.current?.scrollToSeq(active)))
  }, [active, ensure, scroller])

  const set = useMemo(() => new Set(matches ?? []), [matches])
  return {
    open,
    setOpen: (o: boolean) => {
      setOpenState(o)
      if (!o) {
        setQ("")
        setResult(null)
      }
    },
    q,
    setQ,
    matches,
    matchSet: set,
    loading: loading && open,
    active,
    index,
    step: (d: number) => setIndex((i) => (matches?.length ? (i + d + matches.length) % matches.length : 0)),
  }
}

export type ThreadSearch = ReturnType<typeof useThreadSearch>

export function SearchBar({ s, placeholder = "Search this conversation" }: { s: ThreadSearch; placeholder?: string }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])
  const count = s.matches?.length ?? 0
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <label className="sr-only" htmlFor="thread-search">
        Search this conversation
      </label>
      <input
        id="thread-search"
        ref={input}
        value={s.q}
        onChange={(e) => s.setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") s.setOpen(false)
          if (e.key === "Enter" || e.key === "ArrowUp") {
            e.preventDefault()
            s.step(-1)
          }
          if (e.key === "ArrowDown") {
            e.preventDefault()
            s.step(1)
          }
        }}
        placeholder={placeholder}
        className="h-10 min-w-0 flex-1 rounded-full border border-line-soft bg-card px-4 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-white/15"
      />
      <span className="w-14 shrink-0 text-center text-xs text-ink-2 tabular" aria-live="polite">
        {s.loading ? <CircleNotchIcon className="mx-auto size-3.5 motion-safe:animate-spin" aria-label="Searching" /> : s.matches ? (count ? `${s.index + 1} of ${count}` : "No match") : ""}
      </span>
      <button type="button" aria-label="Previous match" disabled={!count} onClick={() => s.step(-1)} className="inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-white/[0.06] hover:text-ink disabled:opacity-40">
        <CaretUpIcon className="size-4" />
      </button>
      <button type="button" aria-label="Next match" disabled={!count} onClick={() => s.step(1)} className="inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-white/[0.06] hover:text-ink disabled:opacity-40">
        <CaretDownIcon className="size-4" />
      </button>
      <button type="button" aria-label="Close search" onClick={() => s.setOpen(false)} className="inline-flex size-10 items-center justify-center rounded-full text-ink-2 hover:bg-white/[0.06] hover:text-ink">
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
