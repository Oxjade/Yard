import { z } from "zod"
import { currencyCodes } from "@/config/markets"
import { safeId, safeLine, safeText } from "@/lib/api/contracts/common"

/**
 * CATALOG request contracts (zod 4). Bodies are strict: unknown fields are a 400, so a client can
 * never name a brandId, a stock count or a version it doesn't own. Money is integer minor units.
 */

const slug = z
  .string()
  .min(2, { error: "Use at least 2 characters." })
  .max(80, { error: "Keep it to 80 characters." })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "Use lowercase letters, numbers and single hyphens." })
const minor = z.number().int({ error: "Use a whole number of minor units." }).positive({ error: "Use an amount above zero." }).max(1_000_000_000_000)
const qty = z.number().int({ error: "Use a whole number." })

export const PRODUCT_BADGES = ["new", "limited", "restock", "exclusive", "last-pieces"] as const

const optionValue = z.strictObject({ value: safeLine({ max: 40 }).min(1), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: "Use a hex colour like #111111." }).optional() })
const option = z.strictObject({ name: safeLine({ max: 30 }).min(1), values: z.array(optionValue).min(1).max(40) })

const variantInput = z.strictObject({
  /** An existing variant of this product to keep (omit for a new one). */
  id: safeId().optional(),
  sku: safeLine({ max: 64 }).min(1),
  options: z.record(safeLine({ max: 30 }), safeLine({ max: 40 })).default({}),
  priceMinor: minor.nullable().optional(),
  /** New variants only: the opening stock (written as a stock movement). Existing stock changes go through the stock endpoint. */
  initialStock: qty.min(0).max(1_000_000).optional(),
})

const imageInput = z.strictObject({
  /** An existing image of this product to keep (sample photos have no media id). */
  id: safeId().optional(),
  /** A brand upload of the active brand. */
  mediaId: safeId().optional(),
  alt: safeLine({ max: 200 }).default(""),
})

/** Product fields without defaults (the update body is these, all optional). */
const productFields = {
  title: safeLine({ max: 120 }).min(2, { error: "Name your product." }),
  slug: slug.optional(),
  description: safeText({ max: 4000 }),
  details: z.array(safeLine({ max: 200 })).max(20),
  categorySlug: safeId(),
  subcategory: safeLine({ max: 60 }).nullable().optional(),
  tags: z.array(safeLine({ max: 40 })).max(20),
  badges: z.array(z.enum(PRODUCT_BADGES)).max(5),
  priceMinor: minor,
  compareAtMinor: minor.nullable().optional(),
  processingDays: z.tuple([z.number().int().min(0).max(60), z.number().int().min(0).max(60)]).nullable().optional(),
  dropId: safeId().nullable().optional(),
  options: z.array(option).max(3),
  variants: z.array(variantInput).min(1, { error: "Add at least one variant." }).max(200),
  images: z.array(imageInput).max(12),
  collectionIds: z.array(safeId()).max(20),
}

export const productCreateBody = z.strictObject({
  ...productFields,
  description: productFields.description.default(""),
  details: productFields.details.default([]),
  tags: productFields.tags.default([]),
  badges: productFields.badges.default([]),
  options: productFields.options.default([]),
  images: productFields.images.default([]),
  collectionIds: productFields.collectionIds.default([]),
})
export type ProductCreateBody = z.output<typeof productCreateBody>

export const productUpdateBody = z.strictObject(productFields).partial().extend({ expectedVersion: z.number().int().positive() })
export type ProductUpdateBody = z.output<typeof productUpdateBody>

export const productPublishBody = z.strictObject({
  action: z.enum(["publish", "schedule", "unpublish", "archive", "restore"]),
  publishAt: z.iso.datetime({ offset: true }).optional(),
  expectedVersion: z.number().int().positive(),
})
export type ProductPublishBody = z.output<typeof productPublishBody>

export const stockAdjustBody = z.strictObject({
  /** adjust: add `qty` (may be negative); set: make on-hand exactly `qty` (a stock count). */
  mode: z.enum(["adjust", "set"]),
  qty: qty.min(-1_000_000).max(1_000_000),
  reason: z.enum(["adjustment", "restock", "return", "correction"]).default("adjustment"),
  note: safeLine({ max: 200 }).optional(),
})
export type StockAdjustBody = z.output<typeof stockAdjustBody>

export const studioProductsQuery = z.object({
  status: z.enum(["draft", "scheduled", "published", "archived", "all"]).default("all"),
  q: safeLine({ max: 80 }).optional(),
  collectionId: safeId().optional(),
  lowStock: z.enum(["1", "0"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
})

export const collectionBody = z.strictObject({
  name: safeLine({ max: 80 }).min(2),
  handle: slug.optional(),
  description: safeText({ max: 1000 }).default(""),
  imageMediaId: safeId().nullable().optional(),
  status: z.enum(["draft", "published"]).default("published"),
  position: z.number().int().min(0).max(10_000).optional(),
})
export type CollectionBody = z.output<typeof collectionBody>
export const collectionUpdateBody = collectionBody.partial()
export type CollectionUpdateBody = z.output<typeof collectionUpdateBody>
export const collectionProductsBody = z.strictObject({ productIds: z.array(safeId()).max(500) })

/* ---------- Public reads ---------- */

export const publicProductsQuery = z.object({
  brand: safeId().optional(),
  category: safeId().optional(),
  subcategory: safeLine({ max: 60 }).optional(),
  collection: safeId().optional(),
  tag: safeLine({ max: 40 }).optional(),
  drop: safeId().optional(),
  ids: z.array(safeId()).max(100).optional(),
  inStock: z.enum(["1", "0"]).optional(),
  sort: z.enum(["new", "price_asc", "price_desc", "title"]).default("new"),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
})
export type PublicProductsQuery = z.output<typeof publicProductsQuery>

export const variantsQuery = z.object({ ids: z.array(safeId()).min(1).max(100) })

/* ---------- Storefront ---------- */

const section = z.strictObject({
  id: safeId(),
  type: z.enum(["hero", "featured-products", "collections", "drops", "story", "lookbook", "all-products", "social-feed"]),
  enabled: z.boolean(),
  title: safeLine({ max: 80 }).optional(),
  productIds: z.array(safeId()).max(48).optional(),
  collectionIds: z.array(safeId()).max(24).optional(),
  feed: z.strictObject({ source: z.enum(["all", "instagram", "tiktok", "uploads"]), layout: z.enum(["grid", "rail"]), count: z.number().int().min(3).max(12) }).optional(),
  postIds: z.array(safeId()).max(12).optional(),
})

export const storefrontConfig = z.strictObject({
  template: z.enum(["editorial", "minimal", "street", "studio"]),
  accent: z.enum(["violet", "acid", "ink", "ember", "aqua", "rose"]),
  typePreset: z.enum(["condensed", "grotesk", "expanded"]),
  intro: safeText({ max: 600 }).default(""),
  announcement: z
    .strictObject({ text: safeLine({ max: 140 }).min(1), href: z.string().max(300).regex(/^\/(?![/\\])[\w\-./?=&%#]*$/, { error: "Use a link inside Yard, starting with /." }).optional() })
    .nullable()
    .optional(),
  coverMediaId: safeId().nullable().optional(),
  /** A library cover (/media/… path), e.g. from onboarding or the sample storefronts. */
  coverPath: z.string().max(300).regex(/^\/media\/[\w-]+(?:\/[\w-]+)*\.[a-z0-9]+$/, { error: "Choose a photo from the library." }).nullable().optional(),
  mark: z.strictObject({ text: z.string().regex(/^[A-Za-z0-9&]{1,3}$/), style: z.enum(["condensed", "expanded", "grotesk"]) }).optional(),
  sections: z.array(section).max(20),
})
export type StorefrontConfigInput = z.output<typeof storefrontConfig>

export const storefrontDraftBody = z.strictObject({ config: storefrontConfig, baseRevision: z.number().int().min(0) })
export const storefrontPublishBody = z.strictObject({ draftRevision: z.number().int().positive(), expectedVersion: z.number().int().min(0), note: safeLine({ max: 200 }).optional() })

/* ---------- Onboarding ---------- */

const currency = z.enum(currencyCodes as [string, ...string[]])

export const onboardingStepSchemas = {
  account: z.strictObject({ name: safeLine({ max: 80 }).min(2), email: z.email().max(200).optional() }),
  brand: z.strictObject({
    name: safeLine({ max: 40 }).min(2, { error: "Enter your brand name." }),
    handle: z
      .string()
      .min(3)
      .max(30)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "Use lowercase letters, numbers and single hyphens." }),
    category: safeId(),
    markText: z.string().regex(/^[A-Za-z0-9&]{1,3}$/, { error: "Use 1 to 3 letters or numbers." }).optional(),
    markStyle: z.enum(["condensed", "expanded", "grotesk"]).default("condensed"),
    logoMediaId: safeId().nullable().optional(),
    description: safeLine({ max: 160 }).min(20, { error: "Write at least 20 characters, so shoppers know what you make." }),
  }),
  storefront: z.strictObject({
    coverMediaId: safeId().nullable().optional(),
    coverPath: z.string().regex(/^\/media\/[\w./-]+$/).optional(),
    accent: z.enum(["violet", "acid", "ink", "ember", "aqua", "rose"]),
    typePreset: z.enum(["condensed", "grotesk", "expanded"]),
    template: z.enum(["editorial", "minimal", "street", "studio"]),
  }),
  business: z.strictObject({
    country: z.string().regex(/^[A-Z]{2}$/),
    city: safeLine({ max: 80 }).min(2),
    address: safeLine({ max: 200 }).default(""),
    currency,
    sellerType: z.enum(["individual", "company"]),
    legalName: safeLine({ max: 120 }).default(""),
    contactEmail: z.email().max(200),
    phone: z.string().max(24).regex(/^\+?[\d\s\-()]{7,24}$/, { error: "Enter a phone number with its country code." }),
  }),
  product: z.strictObject({
    name: safeLine({ max: 80 }).min(2),
    description: safeText({ max: 2000 }).refine((s) => s.trim().length >= 20, { error: "Describe it in at least 20 characters." }),
    priceMinor: minor,
    /** Library photos (/media/… paths) or the applicant's own image uploads (media ids). */
    images: z
      .array(z.union([z.strictObject({ path: z.string().max(300).regex(/^\/media\/[\w./-]+$/), alt: safeLine({ max: 200 }).default("") }), z.strictObject({ mediaId: safeId(), alt: safeLine({ max: 200 }).default("") })]))
      .max(8)
      .default([]),
    sizes: z.array(z.strictObject({ label: safeLine({ max: 20 }).min(1), stock: qty.min(0).max(100_000) })).min(1).max(30),
  }),
  payments: z.strictObject({
    method: z.enum(["bank", "mobile"]),
    holder: safeLine({ max: 120 }).min(2),
    bankName: safeLine({ max: 120 }).default(""),
    /** Only the last four digits: full account details go to LEDGER's encrypted bank-account flow. */
    accountLast4: z.string().regex(/^\d{4}$/).optional(),
    delivery: z.array(z.enum(["domestic", "regional", "international", "pickup"])).min(1),
    processingMin: z.number().int().min(0).max(60),
    processingMax: z.number().int().min(0).max(60),
    returnsDays: z.union([z.literal(14), z.literal(30)]),
  }),
} as const
export type OnboardingStep = keyof typeof onboardingStepSchemas

export const onboardingStepBody = z.strictObject({ data: z.unknown(), revision: z.number().int().min(0) })
export const onboardingSubmitBody = z.strictObject({ revision: z.number().int().positive() })
export const handleQuery = z.object({ handle: z.string().max(40) })
