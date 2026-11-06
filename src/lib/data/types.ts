import type { CountryCode, CurrencyCode } from "@/config/markets"

/**
 * Domain types shared by the frontend. They mirror the backend domains planned in the
 * blueprint (§13) so the local data layer can be swapped for the database without
 * changing the pages.
 */

export type ImageAsset = {
  src: string
  alt: string
  width: number
  height: number
}

export type CategorySlug =
  | "fashion"
  | "streetwear"
  | "sneakers"
  | "accessories"
  | "beauty"
  | "technology"
  | "art-design"
  | "jewelry"
  | "home-lifestyle"
  | "creative"

export type Category = {
  slug: CategorySlug
  name: string
  description: string
  image: ImageAsset
  subcategories: string[]
}

export type Aesthetic =
  | "minimalist"
  | "vintage"
  | "avant-garde"
  | "streetwear"
  | "contemporary"
  | "luxury"
  | "experimental"

/* ---------- Storefront (constrained customization) ---------- */

export type StorefrontTemplate = "editorial" | "minimal" | "street" | "studio"
export type StorefrontTypePreset = "condensed" | "grotesk" | "expanded"
/** Brand accents are picked from a curated set so contrast always holds on obsidian. */
export type StorefrontAccent = "violet" | "acid" | "ink" | "ember" | "aqua" | "rose"

export type StorefrontSectionType =
  | "hero"
  | "featured-products"
  | "collections"
  | "drops"
  | "story"
  | "lookbook"
  | "all-products"

export type StorefrontSection = {
  id: string
  type: StorefrontSectionType
  enabled: boolean
  /** Optional heading override; every section has a sensible default. */
  title?: string
  /** For product/collection sections: what to show. */
  productIds?: string[]
  collectionIds?: string[]
}

export type StorefrontConfig = {
  template: StorefrontTemplate
  accent: StorefrontAccent
  typePreset: StorefrontTypePreset
  intro: string
  announcement?: { text: string; href?: string } | null
  sections: StorefrontSection[]
}

/* ---------- Brands ---------- */

export type BrandMark = {
  /** Short text rendered as the logo mark (1–3 characters). */
  text: string
  style: "condensed" | "expanded" | "grotesk"
}

export type Brand = {
  id: string
  handle: string
  name: string
  tagline: string
  description: string
  story: string[]
  mark: BrandMark
  cover: ImageAsset
  country: CountryCode
  city: string
  currency: CurrencyCode
  categories: CategorySlug[]
  aesthetics: Aesthetic[]
  founded: number
  founder: { name: string; role: string; avatar?: ImageAsset }
  followers: number
  /** Follower growth over the last 30 days, as a ratio (0.12 = +12%). */
  followerGrowth30d: number
  verified: boolean
  joinedAt: string
  social: { instagram?: string; tiktok?: string; x?: string; website?: string }
  storefront: StorefrontConfig
  shipsFrom: CountryCode
  processingDays: [number, number]
  returnsDays: number
}

/* ---------- Catalogue ---------- */

export type ProductStatus = "draft" | "published" | "scheduled" | "archived"
export type ProductBadge = "new" | "limited" | "restock" | "exclusive" | "last-pieces"

export type ColourValue = { name: string; hex: string }

export type ProductOption =
  | { name: "Size"; values: string[] }
  | { name: "Colour"; values: ColourValue[] }

export type Variant = {
  id: string
  sku: string
  /** e.g. { Size: "M", Colour: "Black" } */
  options: Record<string, string>
  stock: number
  reserved: number
}

export type Product = {
  id: string
  slug: string
  brandId: string
  name: string
  description: string
  details: string[]
  category: CategorySlug
  subcategory: string
  tags: string[]
  price: number
  compareAt?: number
  currency: CurrencyCode
  images: ImageAsset[]
  options: ProductOption[]
  variants: Variant[]
  badges: ProductBadge[]
  status: ProductStatus
  createdAt: string
  /** Last edit in Brand Studio. */
  updatedAt?: string
  /** When a scheduled product goes live. */
  publishAt?: string
  /** Overrides the brand's processing time for this product, in business days [min, max]. */
  processingDays?: [number, number]
  collectionIds: string[]
  dropId?: string
  stats: { views7d: number; wishlists: number; sales30d: number; trend: number }
}

export type Collection = {
  id: string
  brandId: string
  handle: string
  name: string
  description: string
  image: ImageAsset
  productIds: string[]
}

/** Platform-curated editorial collections (not owned by one brand). */
export type CuratedCollection = {
  id: string
  slug: string
  name: string
  description: string
  image: ImageAsset
  brandIds: string[]
  productIds: string[]
  sponsoredBy?: string
}

/* ---------- Drops ---------- */

export type DropAccess = "first-come" | "draw" | "early-access"

export type Drop = {
  id: string
  slug: string
  brandId: string
  name: string
  description: string
  image: ImageAsset
  productIds: string[]
  /** Hours from the moment the demo loads. Negative = already released. Backend stores absolute UTC. */
  releaseOffsetHours: number
  /** How long the drop stays live, in hours. */
  durationHours: number
  access: DropAccess
  limitPerCustomer: number
  totalUnits: number
  unitsLeft: number
  sponsored?: boolean
}

export type DropPhase = "upcoming" | "live" | "sold-out" | "ended"

/* ---------- Stories ---------- */

export type StoryBlock =
  | { type: "text"; body: string }
  | { type: "quote"; body: string; cite?: string }
  | { type: "image"; image: ImageAsset; caption?: string; layout: "full" | "inset" }
  | { type: "pair"; images: [ImageAsset, ImageAsset]; caption?: string }
  | { type: "products"; productIds: string[] }

export type StoryKind =
  | "origins"
  | "behind-the-scenes"
  | "design-process"
  | "product-launch"
  | "collection"
  | "collaboration"

export type Story = {
  id: string
  slug: string
  brandId: string
  kind: StoryKind
  title: string
  dek: string
  cover: ImageAsset
  publishedAt: string
  readMinutes: number
  blocks: StoryBlock[]
}

/* ---------- Orders (customer + merchant views) ---------- */

export type MerchantOrderStatus =
  | "pending_payment"
  | "paid"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refund_requested"
  | "refunded"

export type PaymentStatus = "pending" | "authorized" | "captured" | "failed" | "refunded" | "partially_refunded"

export type OrderLine = {
  productId: string
  variantId: string
  name: string
  variantLabel: string
  image: ImageAsset
  quantity: number
  unitPrice: number
}

export type MerchantOrder = {
  id: string
  reference: string
  groupId: string
  brandId: string
  customerId: string
  status: MerchantOrderStatus
  paymentStatus: PaymentStatus
  currency: CurrencyCode
  lines: OrderLine[]
  subtotal: number
  shipping: number
  tax: number
  total: number
  commission: number
  placedAt: string
  shippingAddress: { name: string; line1: string; city: string; country: CountryCode; postcode?: string; phone?: string }
  shippingMethod: string
  tracking?: { carrier: string; number: string; url?: string }
  timeline: { at: string; label: string }[]
  /** The shopper's return request, once they've made one. */
  returnRequest?: { at: string; reason: string; reasonLabel: string; note?: string; variantIds: string[] }
  /** Why the brand cancelled, when it did. */
  cancelReason?: string
}

export type CheckoutGroup = {
  id: string
  reference: string
  customerId: string
  placedAt: string
  currency: CurrencyCode
  orderIds: string[]
  total: number
}

export type Customer = {
  id: string
  name: string
  email: string
  avatar?: ImageAsset
  country: CountryCode
  city: string
  joinedAt: string
  interests: CategorySlug[]
  aesthetics: Aesthetic[]
}
