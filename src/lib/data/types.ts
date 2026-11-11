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
  /** The catalogue image row, when this asset is one (live server photos only). */
  imageId?: string
  /** The uploaded media behind the asset, when it has one (live server photos only). */
  mediaId?: string
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
  /** v2 (§6.1): posts from Instagram and TikTok, and posts uploaded in Content Studio. */
  | "social-feed"

export type StorefrontSection = {
  id: string
  type: StorefrontSectionType
  enabled: boolean
  /** Optional heading override; every section has a sensible default. */
  title?: string
  /** For product/collection sections: what to show. */
  productIds?: string[]
  collectionIds?: string[]
  /** v2 Social feed section (§6.1): which posts, how laid out, how many (3–12). */
  feed?: { source: "all" | "instagram" | "tiktok" | "uploads"; layout: "grid" | "rail"; count: number }
  /** v2 Social feed section: posts pinned first, in this order. */
  postIds?: string[]
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
  /** Live server price override in minor units, when the variant has its own price. */
  priceOverrideMinor?: number | null
}

export type Product = {
  id: string
  slug: string
  brandId: string
  /** Live catalogue identity for brands that aren't in the local sample directory. */
  brandSummary?: Pick<Brand, "id" | "handle" | "name" | "verified" | "city" | "country">
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
  status?: "draft" | "published"
  position?: number
  version?: number
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
  /**
   * Sample drops: the release as a time a brand would pick, in its own time zone, counted from the
   * day the demo loads ("18:00, two days from today"), or the first whole hour `hoursOut` hours
   * after it loads. dropWindow resolves it; `releaseOffsetHours` stays the approximate offset the
   * server groups and sorts by. It holds only while `releaseOffsetHours` is still `fromOffset`, so
   * a drop whose release was set afresh (rescheduled, copied) goes by its offset.
   */
  releaseLocal?: ({ daysOut: number; time: string } | { hoursOut: number }) & { fromOffset: number }
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
  /** The shopper's return request, once they've made one, and the decision on it once there is one. */
  returnRequest?: { at: string; reason: string; reasonLabel: string; note?: string; variantIds: string[]; decision?: ReturnDecision }
  /**
   * A refund approved on this order, in the order currency (minor units, like the order's other
   * figures), for the returned lines. A partial refund keeps the order delivered with payment
   * "partially_refunded". Approved and recorded: no payment provider is connected in this build,
   * so nothing has been sent.
   */
  refund?: { amount: number; variantIds: string[]; at: string }
  /** Why the brand cancelled, when it did. */
  cancelReason?: string
  /** v2: the delivery estimate known in this browser (from the server, or computed here and labelled so, §6.5). */
  delivery?: DeliverySnapshot
  /** v2: when payment was confirmed, the order shipped and was delivered (ISO). */
  paidAt?: string
  shippedAt?: string
  deliveredAt?: string
}

/**
 * A delivery estimate as stored with an order (§6.5). Always an estimate: `guaranteed` is false
 * unless a future carrier guarantees dates. `source` says where it was computed.
 */
export type DeliverySnapshot = {
  basis: "quote" | "placed" | "shipped" | "in_transit" | "out_for_delivery" | "delivered" | "late" | "exception"
  dispatchFrom?: string
  shipBy?: string
  arrivalFrom?: string
  arrivalTo?: string
  deliveredOn?: string
  late?: boolean
  guaranteed: false
  service?: "standard" | "express" | "pickup"
  /** "server": Yard's estimate; "browser": computed in this browser because the server never saw the order. */
  source: "server" | "browser"
  computedAt: string
}

/**
 * What the receipt says about payment (§6.6). No payment provider is connected in this build,
 * so live checkouts read "Not charged"; nothing ever implies money moved.
 */
export type PaymentSnapshot = {
  status: "not_charged" | "pending" | "authorized" | "captured" | "failed" | "refunded"
  /** The method the shopper chose, as words ("Card", "Bank transfer"), never card numbers. */
  method?: string
  note?: string
}

/** The decision on a shopper's return request: the brand's (in Studio) or the platform's (in Finance). */
export type ReturnDecision = {
  status: "approved" | "declined"
  at: string
  by: "brand" | "platform"
  /** A decline's reason, shown to the shopper. */
  reason?: string
  /** An approval's refund, in the order currency (minor units). */
  amount?: number
  /** True when only some of the order's items are refunded. */
  partial?: boolean
  /** The audit entry a platform decision wrote, so its notifications are keyed by that decision. */
  ref?: string
}

export type CheckoutGroup = {
  id: string
  reference: string
  customerId: string
  placedAt: string
  currency: CurrencyCode
  orderIds: string[]
  total: number
  /** v2: what the receipt shows about payment (§6.6). */
  payment?: PaymentSnapshot
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
