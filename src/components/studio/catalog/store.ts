"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"
import { collections as seedCollections } from "@/lib/data"
import type { Collection } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"

/**
 * Catalogue details the shared Studio store doesn't hold yet: collections created or edited
 * in Studio, and per-product extras (processing time, scheduled publish time, last update).
 * Persisted locally for the frontend phase; in the backend phase these become columns on
 * `collections` and `products` and this store goes away.
 */

export type ProductMeta = {
  processingDays?: [number, number]
  /** ISO time a scheduled product goes live. */
  publishAt?: string | null
  updatedAt?: string
}

type CatalogState = {
  /** Collections created or edited in this browser, by id. Seed collections not listed here show as shipped. */
  collections: Record<string, Collection>
  deletedCollections: string[]
  productMeta: Record<string, ProductMeta>
  upsertCollection: (c: Collection) => void
  removeCollection: (id: string) => void
  setProductMeta: (id: string, patch: ProductMeta) => void
  touchProducts: (ids: string[]) => void
  removeProductMeta: (id: string) => void
}

const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // Storage full or blocked: keep working in memory for this visit.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name)
    } catch {
      // ignore
    }
  },
}

export const useCatalog = create<CatalogState>()(
  persist(
    (set, get) => ({
      collections: {},
      deletedCollections: [],
      productMeta: {},
      upsertCollection: (c) => set({ collections: { ...get().collections, [c.id]: c }, deletedCollections: get().deletedCollections.filter((id) => id !== c.id) }),
      removeCollection: (id) => {
        const next = { ...get().collections }
        delete next[id]
        set({ collections: next, deletedCollections: [...new Set([...get().deletedCollections, id])] })
      },
      setProductMeta: (id, patch) => set({ productMeta: { ...get().productMeta, [id]: { ...get().productMeta[id], ...patch } } }),
      touchProducts: (ids) => {
        const at = new Date().toISOString()
        const next = { ...get().productMeta }
        for (const id of ids) next[id] = { ...next[id], updatedAt: at }
        set({ productMeta: next })
      },
      removeProductMeta: (id) => {
        const next = { ...get().productMeta }
        delete next[id]
        set({ productMeta: next })
      },
    }),
    {
      name: "nocturne-studio-catalog",
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ collections, deletedCollections, productMeta }) => ({ collections, deletedCollections, productMeta }),
      skipHydration: true,
      version: 1,
    },
  ),
)

let catalogRehydrateStarted = false

/**
 * True once both the Studio store and this catalogue store have loaded what this browser
 * saved. Until then pages show skeletons, so saved edits never flash in over sample data.
 */
export function useCatalogReady() {
  const studio = useSyncExternalStore(
    (cb) => useStudio.persist.onFinishHydration(cb),
    () => useStudio.persist.hasHydrated(),
    () => false,
  )
  const catalog = useSyncExternalStore(
    (cb) => useCatalog.persist.onFinishHydration(cb),
    () => useCatalog.persist.hasHydrated(),
    () => false,
  )
  useEffect(() => {
    if (catalogRehydrateStarted) return
    catalogRehydrateStarted = true
    void useCatalog.persist.rehydrate()
  }, [])
  return studio && catalog
}

/** The brand's collections: shipped ones (with local edits applied) plus ones created here, newest first. */
export function useBrandCollections(brandId: string) {
  const local = useCatalog((s) => s.collections)
  const deleted = useCatalog((s) => s.deletedCollections)
  return useMemo(() => {
    const seedIds = new Set(seedCollections.map((c) => c.id))
    const created = Object.values(local)
      .filter((c) => c.brandId === brandId && !seedIds.has(c.id) && !deleted.includes(c.id))
      .reverse()
    const shipped = seedCollections.filter((c) => c.brandId === brandId && !deleted.includes(c.id)).map((c) => local[c.id] ?? c)
    return [...created, ...shipped]
  }, [local, deleted, brandId])
}
