"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Demo clock. Drops store their release time as an offset from the moment the demo
 * first loads in this tab, so countdowns stay meaningful whenever the prototype is
 * opened. The backend stores absolute UTC instants instead.
 */
let anchor: number | null = null

export function getDemoAnchor() {
  if (anchor === null) {
    try {
      const stored = sessionStorage.getItem("nocturne-demo-anchor")
      anchor = stored ? Number(stored) : Date.now()
      if (!stored) sessionStorage.setItem("nocturne-demo-anchor", String(anchor))
    } catch {
      anchor = Date.now()
    }
  }
  return anchor
}

/*
 * One shared clock per interval: every reader of the same interval ticks together, and the
 * timer runs only while something reads it. A reading is cached between ticks (as
 * useSyncExternalStore requires) but never older than a second when a reader renders, so a
 * component mounting between ticks starts from the current time.
 */
type Clock = { now: number; readers: Set<() => void>; timer: number | undefined }
const clocks = new Map<number, Clock>()

function clockFor(intervalMs: number) {
  let clock = clocks.get(intervalMs)
  if (!clock) {
    clock = { now: Date.now(), readers: new Set(), timer: undefined }
    clocks.set(intervalMs, clock)
  }
  return clock
}

function readClock(intervalMs: number) {
  const clock = clockFor(intervalMs)
  if (Date.now() - clock.now >= 1000) clock.now = Date.now()
  return clock.now
}

function subscribeClock(intervalMs: number, onTick: () => void) {
  getDemoAnchor()
  const clock = clockFor(intervalMs)
  clock.readers.add(onTick)
  if (clock.timer === undefined) {
    clock.timer = window.setInterval(() => {
      clock.now = Date.now()
      for (const read of clock.readers) read()
    }, intervalMs)
  }
  return () => {
    clock.readers.delete(onTick)
    if (!clock.readers.size) {
      window.clearInterval(clock.timer)
      clock.timer = undefined
    }
  }
}

const serverNow = () => null

/** Current time, ticking every `intervalMs`. `null` on the server and while hydrating, so it never mismatches the server HTML. */
export function useNow(intervalMs = 1000) {
  const subscribe = useCallback((onTick: () => void) => subscribeClock(intervalMs, onTick), [intervalMs])
  const read = useCallback(() => readClock(intervalMs), [intervalMs])
  return useSyncExternalStore<number | null>(subscribe, read, serverNow)
}
