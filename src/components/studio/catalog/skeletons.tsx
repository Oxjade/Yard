import Link from "next/link"
import { PlusIcon as Plus } from "@phosphor-icons/react/ssr"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { collectionsCopy, inventoryCopy, productsCopy } from "./page-copy"
import { CatalogueNote } from "./parts"

/**
 * Content-shaped placeholders for the catalogue pages. The route `loading.tsx` files and the
 * pages themselves (while this browser's saved catalogue loads) use the same shapes, so
 * nothing shifts when the content arrives. Server-safe: no client hooks.
 */

/** PageHeader's shape: title, one line of description, the action on the right. */
export function HeaderSkeleton({ action = true, note = false, back = false }: { action?: boolean; note?: boolean; back?: boolean }) {
  return (
    <div className="grid gap-2">
      {back ? <Bone className="h-3 w-20" /> : null}
      <div className="flex flex-col gap-4 border-b border-line-soft pb-5 md:flex-row md:items-end md:justify-between">
        <div className="grid min-w-0 gap-2">
          <Bone className="h-7 w-40" />
          <Bone className="h-4 w-[28rem] max-w-full" />
          {note ? <Bone className="mt-1 h-3.5 w-80 max-w-full" /> : null}
        </div>
        {action ? <Bone className="h-8 w-32" /> : null}
      </div>
    </div>
  )
}

/** StatusTabs' shape: a row of short tabs over a hairline. */
export function TabsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex h-10 items-center gap-6 border-b border-line-soft px-3" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <Bone key={i} className={cn("h-4", i === 0 ? "w-10" : "w-20")} />
      ))}
    </div>
  )
}

/** DataTable's shape: toolbar, a card with a header row, rows with a thumbnail, and the pager. */
export function TableCardSkeleton({ rows = 6, thumb = true, toolbar = 2 }: { rows?: number; thumb?: boolean; toolbar?: number }) {
  return (
    <div className="grid gap-3" aria-hidden>
      {toolbar ? (
        <div className="flex flex-wrap gap-2">
          <Bone className="h-9 w-full sm:w-72" />
          {toolbar > 1 ? <Bone className="h-9 w-full sm:w-44" /> : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-line-soft bg-card">
        <div className="flex items-center gap-6 border-b border-line-soft bg-[#111111] px-4 py-3">
          <Bone className="size-4" />
          <Bone className="h-3 w-24" />
          <Bone className="ml-auto h-3 w-16" />
          <Bone className="hidden h-3 w-16 sm:block" />
          <Bone className="hidden h-3 w-16 md:block" />
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 border-b border-line-soft px-4 py-3 last:border-0">
            <Bone className="size-4 shrink-0" />
            {thumb ? <Bone className="size-10 shrink-0" /> : null}
            <div className="grid min-w-0 flex-1 gap-1.5">
              <Bone className="h-3.5 w-40 max-w-full" />
              <Bone className="h-3 w-24" />
            </div>
            <Bone className="h-6 w-20 shrink-0" />
            <Bone className="hidden h-3.5 w-20 shrink-0 sm:block" />
            <Bone className="hidden h-3.5 w-16 shrink-0 md:block" />
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-line-soft px-4 py-2.5">
          <Bone className="h-3 w-20" />
          <Bone className="h-7 w-28" />
        </div>
      </div>
    </div>
  )
}

/*
 * The list pages' loading states render the real header (its words are fixed) and keep
 * Bones for the data regions only, as the storefront editor's loading state does.
 */

export function ProductsPageSkeleton() {
  return (
    <div className="grid gap-6">
      <PageHeader
        title={productsCopy.title}
        description={productsCopy.description}
        actions={
          <Button asChild variant="primary" size="sm" className="h-10 md:h-8">
            <Link href="/studio/products/new"><Plus /> Add product</Link>
          </Button>
        }
      >
        <CatalogueNote className="mt-3" />
      </PageHeader>
      <div role="status" aria-label="Loading products" className="grid gap-4">
        <TabsSkeleton />
        <TableCardSkeleton />
      </div>
    </div>
  )
}

export function InventoryPageSkeleton() {
  return (
    <div className="grid gap-6">
      <PageHeader title={inventoryCopy.title} description={inventoryCopy.description} actions={<Bone className="h-10 w-36 md:h-8" />}>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <SampleDataNote />
          <CatalogueNote>{inventoryCopy.note}</CatalogueNote>
        </div>
      </PageHeader>
      <div role="status" aria-label="Loading inventory" className="grid gap-4">
        <TabsSkeleton count={3} />
        <TableCardSkeleton rows={8} toolbar={1} />
      </div>
    </div>
  )
}

export function CollectionCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-line-soft bg-card">
          <Bone className="aspect-[16/10] rounded-none" />
          <div className="grid gap-2 p-4">
            <Bone className="h-4 w-1/2" />
            <Bone className="h-3 w-3/4" />
            <div className="mt-2 flex gap-1.5">
              {[0, 1, 2].map((t) => (
                <Bone key={t} className="size-8" />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function CollectionsPageSkeleton() {
  return (
    <div className="grid gap-6">
      <PageHeader title={collectionsCopy.title} description={collectionsCopy.description} actions={<Bone className="h-10 w-40 md:h-8" />}>
        <CatalogueNote className="mt-3">{collectionsCopy.note}</CatalogueNote>
      </PageHeader>
      <div role="status" aria-label="Loading collections">
        <CollectionCardsSkeleton />
      </div>
    </div>
  )
}

/** The product form: two columns of panels from lg, one column below. */
export function ProductEditorSkeleton() {
  return (
    <div role="status" aria-label="Loading product" className="grid gap-6">
      <HeaderSkeleton back />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-6">
          <Bone className="h-60 rounded-lg" />
          <Bone className="h-80 rounded-lg" />
          <Bone className="h-36 rounded-lg" />
        </div>
        <div className="grid content-start gap-6">
          <Bone className="h-36 rounded-lg" />
          <Bone className="h-60 rounded-lg" />
          <Bone className="h-40 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
