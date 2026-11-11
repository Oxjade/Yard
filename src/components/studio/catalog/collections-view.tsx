"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { AnimatePresence, motion, useIsPresent } from "motion/react"
import { StackIcon as Boxes, PencilSimpleIcon as Pencil, PlusIcon as Plus } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { ApiError, api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import type { StudioCollectionDto } from "@/lib/api/contracts/catalog"
import { useApi } from "@/lib/api/use-api"
import { spring } from "@/lib/motion"
import type { Collection } from "@/lib/data/types"
import { useStudio } from "@/lib/stores/studio"
import { useServerSession } from "@/lib/session/use-server-session"
import { CollectionDialog } from "./collection-dialog"
import type { CollectionDraft } from "./collection-dialog"
import { fromStudioCollection, fromStudioProduct, loadStudioCollections, loadStudioProductDtos, studioCollectionsKey } from "./live"
import { collectionsCopy } from "./page-copy"
import { CatalogueNote, Thumb } from "./parts"
import { CollectionCardsSkeleton } from "./skeletons"
import { useBrandCollections, useCatalog, useCatalogReady } from "./store"
import { plural, slugify } from "./utils"

export function CollectionsView() {
  const session = useServerSession()
  if (session.status === "loading") return <div role="status" aria-label="Loading collections"><CollectionCardsSkeleton /></div>
  if (session.brand && !session.brand.demo) return <LiveCollectionsView key={session.brand.brand.id} brandId={session.brand.brand.id} canManage={session.brand.permissions.includes("content.publish")} />
  return <DemoCollectionsView />
}

function DemoCollectionsView() {
  const ready = useCatalogReady()
  const brandId = useStudio((s) => s.brandId)
  const products = useStudio((s) => s.products)
  const collections = useBrandCollections(brandId)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [open, setOpen] = useState(false)

  async function save(draft: CollectionDraft) {
    const base = slugify(draft.name) || "collection"
    const taken = new Set(collections.filter((item) => item.id !== editing?.id).map((item) => item.handle))
    let handle = editing?.handle ?? base
    for (let suffix = 2; !editing && taken.has(handle); suffix++) handle = `${base}-${suffix}`
    const id = editing?.id ?? `c_${brandId.replace(/^b_/, "")}_${handle.replace(/-/g, "_")}`
    const next: Collection = { id, brandId, handle, name: draft.name, description: draft.description, image: draft.image ?? { src: "/media/missing.svg", alt: draft.name, width: 1200, height: 1500 }, productIds: draft.productIds, status: draft.status }
    useCatalog.getState().upsertCollection(next)
    const wanted = new Set(draft.productIds)
    const at = new Date().toISOString()
    useStudio.setState((state) => ({ products: state.products.map((product) => {
      const has = product.collectionIds.includes(id)
      if (wanted.has(product.id) === has) return product
      return { ...product, collectionIds: has ? product.collectionIds.filter((collectionId) => collectionId !== id) : [...product.collectionIds, id], updatedAt: at }
    }) }))
  }

  async function remove(collection: Collection) {
    useStudio.setState((state) => ({ products: state.products.map((product) => product.collectionIds.includes(collection.id) ? { ...product, collectionIds: product.collectionIds.filter((id) => id !== collection.id) } : product) }))
    useCatalog.getState().removeCollection(collection.id)
  }

  return <CollectionsContent collections={collections} products={products} ready={ready} canManage onCreate={() => { setEditing(null); setOpen(true) }} onEdit={(collection) => { setEditing(collection); setOpen(true) }} dialog={{ open, onOpenChange: setOpen, collection: editing, onSave: save, onDelete: remove, onConflict: () => setOpen(false) }} />
}

function LiveCollectionsView({ brandId, canManage }: { brandId: string; canManage: boolean }) {
  const collectionsQuery = useApi(studioCollectionsKey(brandId), loadStudioCollections, { keepPrevious: false })
  const productsQuery = useApi(`studio.catalog:${brandId}`, loadStudioProductDtos, { keepPrevious: false })
  const collections = useMemo(() => (collectionsQuery.data ?? []).map((dto) => fromStudioCollection(dto, brandId)), [collectionsQuery.data, brandId])
  const products = useMemo(() => (productsQuery.data ?? []).map(fromStudioProduct), [productsQuery.data])
  const [editing, setEditing] = useState<Collection | null>(null)
  const [open, setOpen] = useState(false)
  const failure = collectionsQuery.error ?? productsQuery.error
  const ready = !collectionsQuery.isLoading && !productsQuery.isLoading

  async function save(draft: CollectionDraft, idempotencyKey?: string) {
    const fields = { name: draft.name, description: draft.description, imageMediaId: draft.image?.mediaId ?? null, status: draft.status }
    let result: { collection: StudioCollectionDto }
    if (editing) {
      const productIds = draft.productIds.join("\0") !== editing.productIds.join("\0") ? { productIds: draft.productIds } : {}
      result = await api(`/api/studio/catalog/collections/${encodeURIComponent(editing.id)}`, { method: "PATCH", body: { ...fields, ...productIds, expectedVersion: editing.version } })
    } else {
      result = await api("/api/studio/catalog/collections", { body: fields, headers: { "Idempotency-Key": idempotencyKey ?? "" } })
      if (draft.productIds.length) {
        await api(`/api/studio/catalog/collections/${encodeURIComponent(result.collection.id)}/products`, {
          method: "PUT",
          body: { productIds: draft.productIds, expectedVersion: result.collection.version },
        })
      }
    }
    void collectionsQuery.revalidate()
    void productsQuery.revalidate()
  }

  async function remove(collection: Collection) {
    await api(`/api/studio/catalog/collections/${encodeURIComponent(collection.id)}`, { method: "DELETE", body: { expectedVersion: collection.version } })
    void collectionsQuery.revalidate()
    void productsQuery.revalidate()
  }

  function reloadAfterConflict() {
    setOpen(false)
    void collectionsQuery.revalidate()
    void productsQuery.revalidate()
  }

  if (failure) {
    return (
      <div className="grid gap-6">
        <PageHeader title={collectionsCopy.title} description={collectionsCopy.description} />
        <div role="alert" className="grid max-w-xl gap-3 rounded-lg border border-line bg-surface p-5">
          <h2 className="text-base text-ink">Collections couldn&apos;t be loaded</h2>
          <p className="text-sm text-ink-2">{errorMessage(failure, "Check your connection and try again.")}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => { void collectionsQuery.revalidate(); void productsQuery.revalidate() }}>Try again</Button>
            {failure instanceof ApiError && failure.status === 403 ? <p className="self-center text-xs text-ink-3">Your role can&apos;t view the catalogue.</p> : null}
          </div>
        </div>
      </div>
    )
  }

  return <CollectionsContent collections={collections} products={products} ready={ready} canManage={canManage} onCreate={() => { setEditing(null); setOpen(true) }} onEdit={(collection) => { setEditing(collection); setOpen(true) }} dialog={{ open, onOpenChange: setOpen, collection: editing, uploadedCoversOnly: true, onSave: save, onDelete: remove, onConflict: reloadAfterConflict }} />
}

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  collection: Collection | null
  uploadedCoversOnly?: boolean
  onSave: (draft: CollectionDraft, idempotencyKey?: string) => Promise<void>
  onDelete: (collection: Collection) => Promise<void>
  onConflict: () => void
}

function CollectionsContent({ collections, products, ready, canManage, onCreate, onEdit, dialog }: { collections: Collection[]; products: import("@/lib/data/types").Product[]; ready: boolean; canManage: boolean; onCreate: () => void; onEdit: (collection: Collection) => void; dialog: DialogProps }) {
  const members = useMemo(() => {
    const productsById = new Map(products.map((product) => [product.id, product]))
    return new Map(collections.map((collection) => [collection.id, collection.productIds.flatMap((id) => productsById.has(id) ? [productsById.get(id)!] : [])]))
  }, [collections, products])

  return (
    <div className="grid gap-6">
      <PageHeader
        title={collectionsCopy.title}
        description={collectionsCopy.description}
        actions={canManage ? <Button id="create-collection" variant="primary" size="sm" className="h-10 md:h-8" onClick={onCreate}><Plus /> Create collection</Button> : undefined}
      >
        <CatalogueNote className="mt-3">{collectionsCopy.note}</CatalogueNote>
      </PageHeader>

      {!ready ? <div role="status" aria-label="Loading collections"><CollectionCardsSkeleton /></div> : collections.length === 0 ? (
        <EmptyState icon={Boxes} title={canManage ? "Create your first collection" : "No collections yet"} body="Put a drop, a season or a fabric together so shoppers can see the pieces side by side." action={canManage ? <Button variant="secondary" size="sm" onClick={onCreate}><Plus /> Create collection</Button> : undefined} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false}>
            {collections.map((collection, index) => {
              const list = members.get(collection.id) ?? []
              return (
                <CardItem key={collection.id}>
                  <button type="button" onClick={() => onEdit(collection)} disabled={!canManage} className="group block w-full overflow-hidden rounded-lg border border-line-soft bg-card text-left outline-none transition-colors hover:border-line focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian disabled:cursor-default" aria-label={canManage ? `Edit ${collection.name}` : collection.name}>
                    <span className="relative block aspect-[16/10] overflow-hidden bg-surface">
                      <Image src={collection.image.src} alt="" fill sizes="(min-width: 1280px) 360px, (min-width: 640px) 45vw, 100vw" unoptimized={collection.image.src.startsWith("/api/")} loading={index < 3 ? "eager" : undefined} className="object-cover transition-transform duration-200 ease-out-quint group-hover:scale-[1.02]" />
                      {canManage ? <span className="glass absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100"><Pencil className="size-3.5 text-ink" aria-hidden /></span> : null}
                    </span>
                    <span className="grid gap-1 p-4">
                      <span className="flex min-w-0 items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium text-ink">{collection.name}</span>
                        <span className="shrink-0 text-xs text-ink-2 tabular">{plural(list.length, "product")}</span>
                      </span>
                      <span className="line-clamp-2 min-h-8 text-xs text-ink-2">{collection.description || "No description yet."}</span>
                      <span className="mt-2 flex items-center gap-1.5">
                        {list.slice(0, 5).map((product) => <Thumb key={product.id} image={product.images[0]} size={32} loading={index < 3 ? "eager" : undefined} />)}
                        {list.length > 5 ? <span className="text-xs text-ink-3 tabular">+{list.length - 5}</span> : null}
                        {collection.status === "draft" ? <span className="ml-auto text-xs text-ink-3">Draft</span> : null}
                        {list.length === 0 ? <span className="flex h-8 items-center text-xs text-ink-3">No products yet. Open it to add some.</span> : null}
                      </span>
                    </span>
                  </button>
                </CardItem>
              )
            })}
          </AnimatePresence>
        </ul>
      )}

      <CollectionDialog {...dialog} collections={collections} products={products} />
    </div>
  )
}

/** A card in the grid. Marked while it fades out, so focus never returns to a card that's leaving. */
function CardItem({ children }: { children: React.ReactNode }) {
  const present = useIsPresent()
  return (
    <motion.li data-leaving={present ? undefined : ""} layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={spring.layout}>
      {children}
    </motion.li>
  )
}
