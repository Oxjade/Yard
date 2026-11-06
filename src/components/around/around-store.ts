"use client"

import { create } from "zustand"
import { areaBySlug } from "@/lib/around/gazetteer"
import { notifyUrlChange } from "@/hooks/use-search-param"

/**
 * Shared, in-memory UI state for YARD Around. Nothing here is persisted except the manual area,
 * which is saved by saveArea() alone (§5.6): a location fix never reaches storage or a URL.
 */
type AroundUi = {
  /** How many AreaSearch circles are mounted in the map header (N's chrome); the page hides its own then. */
  headerSearch: number
  /** The AreaSearch circle is expanded (the "Pick your city" pill opens it on phones). */
  searchOpen: boolean
  /** Bumps whenever a manual area is chosen, so the map flies even when the URL already says it. */
  areaNonce: number
  /** Bumps to focus the desktop panel's search field. */
  focusNonce: number
  setSearchOpen: (open: boolean) => void
  focusSearch: () => void
  mountHeaderSearch: () => () => void
  bumpArea: () => void
}

export const useAroundUi = create<AroundUi>((set) => ({
  headerSearch: 0,
  searchOpen: false,
  areaNonce: 0,
  focusNonce: 0,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  focusSearch: () => set((s) => ({ focusNonce: s.focusNonce + 1, searchOpen: true })),
  mountHeaderSearch: () => {
    set((s) => ({ headerSearch: s.headerSearch + 1 }))
    return () => set((s) => ({ headerSearch: Math.max(0, s.headerSearch - 1) }))
  },
  bumpArea: () => set((s) => ({ areaNonce: s.areaNonce + 1 })),
}))

export const AREA_STORAGE_KEY = "nocturne-around"

/** The saved manual area slug, or null (storage can be missing or throw). */
export function readSavedArea(): string | null {
  try {
    const raw = window.localStorage.getItem(AREA_STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { v?: number; area?: unknown }
    return v?.v === 1 && typeof v.area === "string" && areaBySlug(v.area) ? v.area : null
  } catch {
    return null
  }
}

function writeSavedArea(slug: string) {
  try {
    window.localStorage.setItem(AREA_STORAGE_KEY, JSON.stringify({ v: 1, area: slug }))
  } catch {
    /* private mode or blocked storage: the URL still carries the choice */
  }
}

/**
 * A manual area choice (§5.6): saved as `{ v: 1, area }` and put in the URL as `?area=`. On
 * /around the URL changes in place; anywhere else this navigates there.
 */
export function chooseArea(slug: string, navigate: (href: string) => void) {
  if (!areaBySlug(slug)) return
  writeSavedArea(slug)
  if (window.location.pathname === "/around") {
    const url = new URL(window.location.href)
    url.searchParams.set("area", slug)
    url.searchParams.delete("place")
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`)
    notifyUrlChange()
    useAroundUi.getState().bumpArea()
  } else {
    navigate(`/around?area=${encodeURIComponent(slug)}`)
  }
  useAroundUi.getState().setSearchOpen(false)
}
