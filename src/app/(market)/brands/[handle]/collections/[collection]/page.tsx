import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CollectionView } from "@/components/storefront/collection-view"
import { toCatalogProduct, type PublicCatalogProduct } from "@/lib/api/catalog-products"
import type { CountryCode, CurrencyCode } from "@/config/markets"
import type { Brand, CategorySlug, Collection, Product, StorefrontConfig } from "@/lib/data/types"
import { listPublicProducts, publicCollection, publicStorefront } from "@/server/catalog/public"
import { HttpError } from "@/server/http/errors"

/** Collection visibility and existence are resolved from live catalogue data before the page renders. */
export const instant = false
const fallbackConfig: StorefrontConfig = { template: "editorial", accent: "ink", typePreset: "grotesk", intro: "", sections: [] }

async function loadCollectionPage(handle: string, collectionHandle: string) {
  const [{ collection: row }, storefront] = await Promise.all([publicCollection(handle, collectionHandle), publicStorefront(handle)])
  const ids = row.productIds
  const chunks: string[][] = []
  for (let index = 0; index < ids.length; index += 60) chunks.push(ids.slice(index, index + 60))
  const pages = await Promise.all(chunks.map((chunk) => listPublicProducts({ ids: chunk, limit: 60, offset: 0, sort: "new" })))
  const byId = new Map<string, Product>()
  for (const product of pages.flatMap((page) => page.products)) byId.set(product.id, toCatalogProduct(product as PublicCatalogProduct))
  const products = ids.flatMap((id) => {
    const product = byId.get(id)
    return product ? [product] : []
  })

  const brandRow = storefront.brand
  const config = (storefront.storefront?.config as StorefrontConfig | null) ?? fallbackConfig
  const brand: Brand = {
    id: brandRow.id,
    handle: brandRow.handle,
    name: brandRow.name,
    tagline: `Independent pieces from ${brandRow.name}.`,
    description: "",
    story: [],
    mark: { text: brandRow.name.slice(0, 2).toUpperCase(), style: "condensed" },
    cover: { src: row.imageSrc ?? products[0]?.images[0]?.src ?? "/media/missing.svg", alt: brandRow.name, width: 1200, height: 1500 },
    country: brandRow.country as CountryCode,
    city: brandRow.city,
    currency: brandRow.currency as CurrencyCode,
    categories: brandRow.categories as CategorySlug[],
    aesthetics: ["contemporary"],
    founded: brandRow.joinedAt ? Number(brandRow.joinedAt.slice(0, 4)) : new Date().getFullYear(),
    founder: { name: brandRow.name, role: "Independent brand" },
    followers: brandRow.followersBase,
    followerGrowth30d: 0,
    verified: brandRow.verified,
    joinedAt: brandRow.joinedAt ?? new Date().toISOString().slice(0, 10),
    social: {},
    storefront: config,
    shipsFrom: brandRow.country as CountryCode,
    processingDays: [2, 5],
    returnsDays: 14,
  }
  const collection: Collection = {
    id: row.id,
    brandId: brand.id,
    handle: row.handle,
    name: row.name,
    description: row.description,
    image: { src: row.imageSrc ?? products[0]?.images[0]?.src ?? "/media/missing.svg", alt: row.name, width: 1200, height: 1500 },
    productIds: ids,
    status: "published",
  }
  const others: Collection[] = storefront.collections.filter((item) => item.id !== row.id).map((item) => ({
    id: item.id,
    brandId: brand.id,
    handle: item.handle,
    name: item.name,
    description: item.description,
    image: { src: item.imageSrc ?? "/media/missing.svg", alt: item.name, width: 1200, height: 1500 },
    productIds: item.productIds,
    status: "published",
  }))
  return { brand, collection, products, others, config }
}

export async function generateMetadata({ params }: PageProps<"/brands/[handle]/collections/[collection]">): Promise<Metadata> {
  const { handle, collection } = await params
  try {
    const found = await loadCollectionPage(handle, collection)
    return { title: `${found.collection.name}, ${found.brand.name}`, description: found.collection.description }
  } catch {
    return { title: "Collection not found" }
  }
}

export default async function BrandCollectionPage({ params }: PageProps<"/brands/[handle]/collections/[collection]">) {
  const { handle, collection: collectionHandle } = await params
  let found: Awaited<ReturnType<typeof loadCollectionPage>>
  try {
    found = await loadCollectionPage(handle, collectionHandle)
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
  return <CollectionView brand={found.brand} collection={found.collection} products={found.products} others={found.others} storefrontConfig={found.config} />
}
