"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { Boxes, Pencil, Plus } from "lucide-react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import type { Collection } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"
import { CollectionDialog } from "./collection-dialog"
import { Thumb } from "./parts"
import { useBrandCollections, useCatalogReady } from "./store"
import { plural } from "./utils"

export function CollectionsView() {
  const ready = useCatalogReady()
  const brandId = useStudio((s) => s.brandId)
  const products = useStudio((s) => s.products)
  const collections = useBrandCollections(brandId)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [open, setOpen] = useState(false)

  const members = useMemo(() => {
    const m = new Map<string, typeof products>()
    for (const c of collections) {
      const list = products.filter((p) => p.collectionIds.includes(c.id))
      const order = new Map(c.productIds.map((id, i) => [id, i]))
      m.set(c.id, list.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)))
    }
    return m
  }, [collections, products])

  function create() {
    setEditing(null)
    setOpen(true)
  }

  function edit(c: Collection) {
    setEditing(c)
    setOpen(true)
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Collections"
        description="Group products into drops, seasons or edits. Collections show on your storefront and help shoppers browse."
        actions={
          <Button variant="primary" size="sm" onClick={create}>
            <Plus /> Create collection
          </Button>
        }
      />

      {!ready ? (
        <div role="status" aria-label="Loading collections" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="overflow-hidden rounded-lg border border-line-soft bg-card">
              <Bone className="aspect-[16/10] rounded-none" />
              <div className="grid gap-2 p-4">
                <Bone className="h-4 w-1/2" />
                <Bone className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="Create your first collection"
          body="Put a drop, a season or a fabric together so shoppers can see the pieces side by side."
          action={<Button variant="secondary" size="sm" onClick={create}><Plus /> Create collection</Button>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {collections.map((c, i) => {
            const list = members.get(c.id) ?? []
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => edit(c)}
                  className="group block w-full overflow-hidden rounded-lg border border-line-soft bg-card text-left outline-none transition-colors hover:border-line focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian"
                  aria-label={`Edit ${c.name}`}
                >
                  <span className="relative block aspect-[16/10] overflow-hidden bg-surface">
                    <Image src={c.image.src} alt="" fill sizes="(min-width: 1280px) 360px, (min-width: 640px) 45vw, 100vw" loading={i < 3 ? "eager" : undefined} className="object-cover transition-transform duration-500 ease-out-quint group-hover:scale-[1.02]" />
                    <span className="glass absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100">
                      <Pencil className="size-3.5 text-ink" aria-hidden />
                    </span>
                  </span>
                  <span className="grid gap-1 p-4">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                      <span className="shrink-0 text-xs text-ink-2 tabular">{plural(list.length, "product")}</span>
                    </span>
                    <span className="line-clamp-2 min-h-8 text-xs text-ink-2">{c.description || "No description yet."}</span>
                    <span className="mt-2 flex items-center gap-1.5">
                      {list.slice(0, 5).map((p) => (
                        <Thumb key={p.id} image={p.images[0]} size={32} loading={i < 3 ? "eager" : undefined} />
                      ))}
                      {list.length > 5 ? <span className="text-xs text-ink-3 tabular">+{list.length - 5}</span> : null}
                      {list.length === 0 ? <span className="text-xs text-ink-3">Add products to show it on your storefront.</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <CollectionDialog open={open} onOpenChange={setOpen} collection={editing} collections={collections} brandId={brandId} />
    </div>
  )
}
