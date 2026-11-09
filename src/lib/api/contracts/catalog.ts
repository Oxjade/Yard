export type StudioProductDto = {
  id: string
  slug: string
  brandId: string
  title: string
  description: string
  details: string[]
  category: string
  subcategory: string | null
  tags: string[]
  badges: string[]
  priceMinor: number
  compareAtMinor: number | null
  currency: string
  images: { id: string; src: string; alt: string; width: number | null; height: number | null; mediaId: string | null }[]
  options: { name: string; values: { value: string; hex?: string }[] }[]
  variants: { id: string; sku: string; options: Record<string, string>; label: string; priceMinor: number; available: number; inStock: boolean; status: string; onHand: number; held: number; priceOverrideMinor: number | null }[]
  available: number
  processingDays: [number, number] | null
  dropId: string | null
  collectionIds: string[]
  publishedAt: string | null
  createdAt: string
  status: string
  publishAt: string | null
  moderationStatus: string
  moderationReason: string | null
  version: number
  updatedAt: string
}

export type StudioProductsPage = { products: StudioProductDto[]; total: number; nextOffset: number | null }

export type StudioProductStatusAction = "publish" | "schedule" | "unpublish" | "archive" | "restore"

export type StudioProductStatusBody = {
  action: StudioProductStatusAction
  publishAt?: string
  expectedVersion: number
}

export type StudioProductCreateBody = {
  title: string
  slug?: string
  description?: string
  details?: string[]
  categorySlug: string
  subcategory?: string | null
  tags?: string[]
  badges?: string[]
  priceMinor: number
  compareAtMinor?: number | null
  processingDays?: [number, number] | null
  dropId?: string | null
  options?: { name: string; values: { value: string; hex?: string }[] }[]
  variants: { id?: string; sku: string; options?: Record<string, string>; priceMinor?: number | null; initialStock?: number }[]
  images?: { id?: string; mediaId?: string; alt?: string }[]
  collectionIds?: string[]
}

export type StudioProductUpdateBody = Partial<StudioProductCreateBody> & { expectedVersion: number }

export type StudioProductResponse = { product: StudioProductDto }
export type StudioCollectionDto = {
  id: string
  handle: string
  name: string
  description: string
  status: string
  position: number
  imageMediaId: string | null
  imageSrc: string | null
  productIds: string[]
  updatedAt: string
}

export type StudioCollectionsResponse = { collections: StudioCollectionDto[] }
export type StudioCollectionResponse = { collection: StudioCollectionDto }
