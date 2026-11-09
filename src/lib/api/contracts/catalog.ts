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