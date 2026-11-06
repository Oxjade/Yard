"use client"

import { useEffect, useMemo, useSyncExternalStore } from "react"
import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"
import { collections as seedCollections } from "@/lib/data"
import type { Collection, Product } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"

/**
 * Catalogue details the shared Studio store doesn't hold yet: collections created or edited
 * in Studio. Persisted locally for the frontend phase; in the backend phase they become rows
 * in `collections` and this store goes away.
 *
 * Per-product extras (processing time, go-live time, last update) now live on the Product
 * itself. Earlier builds kept them here as `productMeta`; they're moved over once on load.
 */

/** Product extras as earlier builds stored them. Read once by the migration, never written. */
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
  /** Legacy: emptied by the migration below. */
  productMeta: Record<string, ProductMeta>
  upsertCollection: (c: Collection) => void
  removeCollection: (id: string) => void
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

/** Moves extras saved by earlier builds onto the products themselves, then forgets them. */
function migrateProductMeta() {
  const meta = useCatalog.getState().productMeta
  if (!Object.keys(meta).length) return
  useStudio.setState((s) => ({
    products: s.products.map((p) => {
      const m = meta[p.id]
      if (!m) return p
      return {
        ...p,
        updatedAt: p.updatedAt ?? m.updatedAt,
        publishAt: p.publishAt ?? m.publishAt ?? undefined,
        processingDays: p.processingDays ?? m.processingDays,
      }
    }),
  }))
  useCatalog.setState({ productMeta: {} })
}

/** Marks products as just edited, so "Updated" and the default sort reflect the change. */
export function touchProducts(ids: string[]) {
  if (!ids.length) return
  const at = new Date().toISOString()
  const set = new Set(ids)
  useStudio.setState((s) => ({ products: s.products.map((p) => (set.has(p.id) ? { ...p, updatedAt: at } : p)) }))
}

/**
 * Sets several products' status in one go and returns what each was before, for Undo.
 * Publishing clears a scheduled go-live time, since the product is published now.
 */
export function setProductStatuses(ids: string[], status: Product["status"]) {
  const at = new Date().toISOString()
  const set = new Set(ids)
  const previous: { id: string; status: Product["status"]; publishAt?: string }[] = []
  useStudio.setState((s) => ({
    products: s.products.map((p) => {
      if (!set.has(p.id) || p.status === status) return p
      previous.push({ id: p.id, status: p.status, publishAt: p.publishAt })
      return { ...p, status, updatedAt: at, publishAt: status === "published" ? undefined : p.publishAt }
    }),
  }))
  return previous
}

/** Puts products back the way `setProductStatuses` found them. */
export function restoreProductStatuses(previous: { id: string; status: Product["status"]; publishAt?: string }[]) {
  const byId = new Map(previous.map((p) => [p.id, p]))
  const at = new Date().toISOString()
  useStudio.setState((s) => ({
    products: s.products.map((p) => {
      const was = byId.get(p.id)
      return was ? { ...p, status: was.status, publishAt: was.publishAt, updatedAt: at } : p
    }),
  }))
}

/** When a product last changed in Studio: its last edit, or when it was added. */
export const productUpdatedAt = (p: Product) => p.updatedAt ?? p.createdAt

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
  const ready = studio && catalog
  useEffect(() => {
    if (ready) migrateProductMeta()
  }, [ready])
  return ready
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
