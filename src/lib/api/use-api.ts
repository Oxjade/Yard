"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { inflight } from "./client"

/**
 * A small SWR-style data hook (§1.9), no dependency. `error` is always distinct from
 * `data === undefined`, so callers can show an error state instead of loading forever. Requests
 * are deduped per key; polling pauses while the tab is hidden; resetApiCache() drops everything
 * on sign-in, sign-out and account switches so one identity's data never renders under another.
 */
type Entry<T = unknown> = {
  data?: T
  error?: unknown
  /** Bumps on every change, for useSyncExternalStore. */
  version: number
  promise?: Promise<T>
  listeners: Set<() => void>
  validating: boolean
  /** Epoch of the cache when the request started: a reset discards late answers. */
  epoch: number
  /** The latest fetcher a mounted hook registered for this key. */
  fetcher?: (key: string) => Promise<T>
}

const cache = new Map<string, Entry>()
let epoch = 0

function entry<T>(key: string): Entry<T> {
  let e = cache.get(key) as Entry<T> | undefined
  if (!e) {
    e = { version: 0, listeners: new Set(), validating: false, epoch }
    cache.set(key, e as Entry)
  }
  return e
}

function emit(e: Entry) {
  e.version++
  for (const l of e.listeners) l()
}

async function load<T>(key: string, fetcher: (key: string) => Promise<T>): Promise<T> {
  const e = entry<T>(key)
  if (e.promise) return e.promise
  const started = epoch
  e.validating = true
  emit(e as Entry)
  const p = fetcher(key)
  e.promise = p
  try {
    const data = await p
    if (started === epoch) {
      e.data = data
      e.error = undefined
    }
    return data
  } catch (err) {
    if (started === epoch && !(err instanceof DOMException && err.name === "AbortError")) e.error = err
    throw err
  } finally {
    if (e.promise === p) e.promise = undefined
    e.validating = false
    emit(e as Entry)
  }
}

/** Drops every cached entry and aborts in-flight requests (sign-in, sign-out, account switch). */
export function resetApiCache() {
  epoch++
  for (const c of inflight) c.abort()
  inflight.clear()
  for (const [, e] of cache) {
    e.data = undefined
    e.error = undefined
    e.promise = undefined
    e.validating = false
    emit(e)
  }
}

/** Refetches every mounted key whose name starts with `prefix` (after a mutation elsewhere). */
export function revalidatePrefix(prefix: string) {
  for (const [k, e] of cache) if (k.startsWith(prefix) && e.listeners.size && e.fetcher) void load(k, e.fetcher).catch(() => {})
}

export type UseApiOptions = { refreshInterval?: number; revalidateOnFocus?: boolean; keepPrevious?: boolean }

export function useApi<T>(key: string | null, fetcher: (key: string) => Promise<T>, opts: UseApiOptions = {}) {
  const { refreshInterval, revalidateOnFocus = true, keepPrevious = true } = opts
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })
  // keepPrevious: the last data this hook showed, so a key change doesn't flash the loading state.
  const [previous, setPrevious] = useState<T | undefined>(undefined)

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => {}
      const e = entry<T>(key)
      e.fetcher = (k: string) => fetcherRef.current(k)
      e.listeners.add(cb)
      return () => {
        e.listeners.delete(cb)
      }
    },
    [key],
  )
  const version = useSyncExternalStore(
    subscribe,
    () => (key ? entry<T>(key).version : -1),
    () => -1,
  )
  void version
  const e = key ? entry<T>(key) : null

  const revalidate = useCallback(() => {
    if (!key) return Promise.resolve(undefined)
    return load(key, (k) => fetcherRef.current(k)).catch(() => undefined)
  }, [key])

  // First load (and whenever the key changes).
  useEffect(() => {
    if (!key) return
    const en = entry<T>(key)
    if (en.data === undefined && en.error === undefined) void revalidate()
  }, [key, revalidate])

  // Polling, paused while hidden.
  useEffect(() => {
    if (!key || !refreshInterval) return
    const id = window.setInterval(() => {
      if (!document.hidden) void revalidate()
    }, refreshInterval)
    return () => window.clearInterval(id)
  }, [key, refreshInterval, revalidate])

  useEffect(() => {
    if (!key || !revalidateOnFocus) return
    const onFocus = () => {
      if (!document.hidden) void revalidate()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
    }
  }, [key, revalidateOnFocus, revalidate])

  const mutate = useCallback(
    (next?: T | ((current: T | undefined) => T | undefined)) => {
      if (!key) return
      const en = entry<T>(key)
      if (next === undefined) {
        void revalidate()
        return
      }
      en.data = typeof next === "function" ? (next as (c: T | undefined) => T | undefined)(en.data) : next
      en.error = undefined
      emit(en as Entry)
    },
    [key, revalidate],
  )

  const data = e?.data
  if (data !== undefined && data !== previous) setPrevious(data)
  const shown = data ?? (keepPrevious && key ? previous : undefined)
  return {
    data: shown,
    error: e?.error,
    isLoading: !!key && shown === undefined && e?.error === undefined,
    isValidating: !!e?.validating,
    mutate,
    revalidate,
  }
}
