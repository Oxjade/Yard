import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CollectionView } from "@/components/storefront/collection-view"
import { brandById, collections, collectionsOf, getBrand, productById } from "@/lib/data"
import type { Product } from "@/lib/data/types"

/**
 * layout.tsx checks the address first, so an unknown collection answers with a real 404 and this
 * page can sit under a loading state. Every known one is prerendered below.
 */
export const instant = false
/**
 * The whole route is static output, so an address that wasn't prerendered waits for its own
 * render (where the check runs before anything is sent) instead of being served the shared
 * fallback shell with a 200 first.
 */
export const ensureStatic = "navigation"

export function generateStaticParams() {
  return collections.map((c) => ({ handle: brandById.get(c.brandId)!.handle, collection: c.handle }))
}

function find(handle: string, collectionHandle: string) {
  const brand = getBrand(handle)
  const collection = brand ? collectionsOf(brand.id).find((c) => c.handle === collectionHandle) : undefined
  return brand && collection ? { brand, collection } : null
}

export async function generateMetadata({ params }: PageProps<"/brands/[handle]/collections/[collection]">): Promise<Metadata> {
  const { handle, collection } = await params
  const found = find(handle, collection)
  if (!found) return { title: "Collection not found" }
  return { title: `${found.collection.name}, ${found.brand.name}`, description: found.collection.description }
}

export default async function BrandCollectionPage({ params }: PageProps<"/brands/[handle]/collections/[collection]">) {
  const { handle, collection: collectionHandle } = await params
  const found = find(handle, collectionHandle)
  if (!found) notFound()
  const { brand, collection } = found

  const products = collection.productIds
    .map((id) => productById.get(id))
    .filter((p): p is Product => !!p && p.status === "published" && p.brandId === brand.id)
  const others = collectionsOf(brand.id).filter((c) => c.id !== collection.id)

  return <CollectionView brand={brand} collection={collection} products={products} others={others} />
}
