"use client"

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react"
import { CaretDownIcon, CircleNotchIcon } from "@phosphor-icons/react"
import { cn } from "@/lib/utils"

export type ScrollerApi = {
  scrollToSeq: (seq: number) => void
  scrollToBottom: () => void
}

const NEAR = 240
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * The message scroll area: opens at the newest message, follows new ones while you're near the
 * bottom, keeps your place when older messages load above (scroll anchoring by hand), and shows
 * a 40 px glass scroll-to-bottom circle once you're more than 240 px up, with an acid count of
 * messages that arrived since (§6.2).
 */
export function ThreadScroller({
  apiRef,
  resetKey,
  firstKey,
  lastKey,
  lastIsOwn,
  hasMore,
  loadingOlder,
  onLoadOlder,
  header,
  children,
  className,
}: {
  apiRef?: React.RefObject<ScrollerApi | null>
  /** Changes when another conversation opens: jump to its bottom. */
  resetKey: string
  firstKey: string | undefined
  lastKey: string | undefined
  lastIsOwn: boolean
  hasMore: boolean
  loadingOlder: boolean
  onLoadOlder: () => Promise<boolean> | void
  /** Content above the messages that scrolls with them (the quick-action rail). */
  header?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState(false)
  const [fresh, setFresh] = useState(0)
  const anchor = useRef<{ height: number; top: number } | null>(null)
  const opened = useRef<string | null>(null)
  const prevLast = useRef<string | undefined>(undefined)
  const prevFirst = useRef<string | undefined>(undefined)

  // Pinned to the newest message: photos that load late or a composer that grows keep it in view.
  const stuck = useRef(true)
  const inner = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const s = el.current
    if (!s || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      if (stuck.current) s.scrollTop = s.scrollHeight
    })
    ro.observe(s)
    if (inner.current) ro.observe(inner.current)
    return () => ro.disconnect()
  }, [])

  const toBottom = (smooth: boolean) => {
    stuck.current = true
    const s = el.current
    if (!s) return
    s.scrollTo({
      top: s.scrollHeight,
      behavior: smooth && !reduced() ? "smooth" : "auto",
    })
    setFresh(0)
  }

  useImperativeHandle(apiRef, () => ({
    scrollToSeq(seq) {
      const node = el.current?.querySelector<HTMLElement>(`[data-seq="${seq}"]`)
      node?.scrollIntoView({
        block: "center",
        behavior: reduced() ? "auto" : "smooth",
      })
    },
    scrollToBottom: () => toBottom(true),
  }))

  // A newly opened conversation starts at its newest message.
  useLayoutEffect(() => {
    if (!lastKey || opened.current === resetKey) return
    opened.current = resetKey
    prevLast.current = lastKey
    prevFirst.current = firstKey
    const s = el.current
    if (s) s.scrollTop = s.scrollHeight
    stuck.current = true
    setFresh(0)
    setAway(false)
  }, [resetKey, lastKey, firstKey])

  // Older messages loaded above: keep the reader's place.
  useLayoutEffect(() => {
    if (firstKey === prevFirst.current) return
    prevFirst.current = firstKey
    const s = el.current
    const a = anchor.current
    if (s && a) s.scrollTop = s.scrollHeight - a.height + a.top
    anchor.current = null
  }, [firstKey])

  // A new message at the end: follow it when near the bottom (or when it's ours), else count it.
  useEffect(() => {
    if (!lastKey || lastKey === prevLast.current) return
    prevLast.current = lastKey
    const s = el.current
    if (!s) return
    const distance = s.scrollHeight - s.scrollTop - s.clientHeight
    if (lastIsOwn || distance < NEAR + 120) toBottom(true)
    else setFresh((n) => n + 1)
  }, [lastKey, lastIsOwn])

  function loadOlderNow() {
    const s = el.current
    if (!s || !hasMore || loadingOlder || anchor.current) return
    anchor.current = { height: s.scrollHeight, top: s.scrollTop }
    void Promise.resolve(onLoadOlder()).then((loaded) => {
      if (loaded === false) anchor.current = null
    })
  }

  function onScroll() {
    const s = el.current
    if (!s) return
    const distance = s.scrollHeight - s.scrollTop - s.clientHeight
    stuck.current = distance < 40
    setAway(distance > NEAR)
    if (distance < 40) setFresh(0)
    if (s.scrollTop < 120) loadOlderNow()
  }

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div ref={el} onScroll={onScroll} className="absolute inset-0 overflow-y-auto overscroll-contain px-3 pb-3 md:px-5" role="log" aria-live="polite" aria-relevant="additions" tabIndex={0} aria-label="Messages">
        <div ref={inner}>
          {header}
          {hasMore ? (
            <div className="flex h-10 items-center justify-center text-xs text-ink-3">
              {loadingOlder ? (
                <span className="inline-flex items-center gap-1.5">
                  <CircleNotchIcon className="size-3.5 motion-safe:animate-spin" aria-hidden /> Loading earlier messages
                </span>
              ) : (
                <button type="button" className="h-10 rounded-full px-3 hover:bg-white/[0.05] hover:text-ink" onClick={loadOlderNow}>
                  Load earlier messages
                </button>
              )}
            </div>
          ) : null}
          {children}
        </div>
      </div>
      {away ? (
        <button
          type="button"
          onClick={() => toBottom(true)}
          aria-label={fresh ? `Scroll to the newest message, ${fresh} new` : "Scroll to the newest message"}
          className="glass absolute right-4 bottom-3 inline-flex size-10 items-center justify-center rounded-full text-ink shadow-lg"
        >
          <CaretDownIcon className="size-5" />
          {fresh ? (
            <span className="absolute -top-1.5 -right-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-acid px-1 text-[11px] font-medium text-obsidian tabular">{fresh > 9 ? "9+" : fresh}</span>
          ) : null}
        </button>
      ) : null}
    </div>
  )
}

/** The quiet chip in the thread header when the stream isn't live (§4.3). Never blocks sending. */
export function ConnectionChip({ status, className }: { status: string; className?: string }) {
  // The first connect isn't news; a dropped stream, polling or being offline is.
  if (status !== "retrying" && status !== "polling" && status !== "offline") return null
  const text = status === "retrying" ? "Reconnecting…" : "Live updates paused — messages still send"
  return (
    <span className={cn("inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 truncate rounded-full border border-white/10 px-2 text-[11px] text-ink-2", className)} role="status">
      <span className={cn("size-1.5 shrink-0 rounded-full bg-ink-3", status === "retrying" && "motion-safe:animate-pulse")} aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  )
}
