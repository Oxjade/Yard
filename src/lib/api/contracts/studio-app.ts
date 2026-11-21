import { z } from "zod"
import { countries } from "@/config/markets"
import { safeId, safeLine } from "./common"

/**
 * Studio in the Yard apps (docs/APP.md › Studio in the app): the shopper session's brand
 * memberships, the shopper → brand session switch, the short "Sell on Yard" application, the app
 * dashboard and Studio push preferences. Category-neutral on purpose: categories always come from
 * GET /api/catalog/categories, never from a list in the app.
 */

/** Where a brand stands, in the words the app branches on. */
export type BrandMembershipStatus = "pending_review" | "approved" | "claimed" | "restricted" | "suspended"

export type BrandMembershipDto = {
  id: string
  handle: string
  name: string
  /**
   * The brand's logo, or null (show `initials`). A public logo (`/api/media/<id>`) loads without a
   * cookie; a private one (`/api/media/<id>?as=brand`, a brand that isn't live yet) loads only once
   * the brand session is open.
   */
  logoSrc: string | null
  /** Initials for a missing logo (the website's mark text). */
  initials: string
  role: "owner" | "admin" | "designer" | "fulfilment" | "finance" | "viewer"
  status: BrandMembershipStatus
  /** False for a suspended brand: POST /api/studio/session/switch refuses it. */
  canOpenStudio: boolean
}

/** POST /api/studio/session/switch. */
export const studioSwitchBody = z.strictObject({ brandId: safeId() })

const instagramHandle = /^[A-Za-z0-9._]{1,30}$/

/** "@kachi", "kachi" or an instagram.com link → "kachi"; null when it isn't one. */
export function instagramHandleOf(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  let h = s
  const m = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#\s]+)/i.exec(s)
  if (m) h = m[1]
  h = h.replace(/^@/, "")
  return instagramHandle.test(h) ? h : null
}

const countryCode = z.string().refine((c) => Object.hasOwn(countries, c), { error: "Choose a country Yard sells in." })

/**
 * POST /api/studio/apply: the short application. At least one of `instagram` or `website`.
 * `category` is a slug from GET /api/catalog/categories (the server checks it). Currency follows
 * the country.
 */
export const studioApplyBody = z
  .strictObject({
    brandName: safeLine({ max: 40 }).pipe(z.string().trim().min(2, { error: "Enter your shop's name." })),
    instagram: z.string().max(200).optional(),
    website: z.string().max(500).optional(),
    category: safeId(),
    city: safeLine({ max: 80 }).pipe(z.string().trim().min(2, { error: "Enter your city." })),
    country: countryCode,
    /** Optional: one line about what you sell (shown to Yard's reviewers). */
    about: safeLine({ max: 160 }).optional(),
  })
  .superRefine((b, ctx) => {
    const ig = b.instagram?.trim()
    const web = b.website?.trim()
    if (!ig && !web) ctx.addIssue({ code: "custom", path: ["instagram"], message: "Add your Instagram or your website, so Yard can see what you sell." })
    if (ig && !instagramHandleOf(ig)) ctx.addIssue({ code: "custom", path: ["instagram"], message: "Enter an Instagram handle like @yourshop." })
    if (web && !/^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]{2,}$/i.test(web)) ctx.addIssue({ code: "custom", path: ["website"], message: "Enter your website address, like yourshop.com." })
  })
export type StudioApplyBody = z.output<typeof studioApplyBody>

export type StudioApplicationDto = {
  id: string
  status: "draft" | "submitted" | "approved" | "rejected"
  /** "app" for this short application; "studio" for the website's full application. */
  source: "app" | "studio"
  brand: { id: string; handle: string; name: string } | null
  submittedAt: string | null
  reviewedAt: string | null
  /** What to change, after a rejection only. */
  reviewNote: string | null
}

export type StudioApplyResult = {
  application: StudioApplicationDto
  /** The website pre-scan for Yard's reviewers: started, or skipped with why. */
  websiteScan: { status: "started"; importId: string } | { status: "skipped"; reason: string } | null
}

/* ---------- App dashboard ---------- */

export const studioDashboardQuery = z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30)])).default(7) })

export type SalesWindowDto = { orders: number; grossMinor: number; refundedMinor: number; netMinor: number }
export type StudioDashboardDto = {
  brand: { id: string; handle: string; name: string; currency: string; timeZone: string }
  /** Captured (paid) orders, in the brand's currency and calendar (its time zone). */
  sales: { today: SalesWindowDto; week: SalesWindowDto; month: SalesWindowDto }
  /** One point per calendar day, oldest first, `days` long (today last). */
  series: { days: 7 | 30; points: { date: string; orders: number; grossMinor: number; netMinor: number }[] }
  toShip: { total: number; paid: number; processing: number }
  lowStock: { variants: number; products: number; threshold: number }
  /** Unread conversations; null when the member's role can't read the inbox. */
  unreadMessages: number | null
  /** "New from your website" pieces waiting. */
  websitePieces: number
  topProducts: { productId: string; title: string; currency: string; units: number; revenueMinor: number; image: { src: string; alt: string } | null }[]
  /** Storefront views counted for Yard Charts (bots and fraud excluded). */
  storeViews: { today: number; week: number; month: number }
}

/* ---------- Studio push preferences ---------- */

export type StudioPushTopic = "orders" | "messages" | "lowStock" | "payouts"
export type StudioPushPreferencesDto = { push: Record<StudioPushTopic, boolean> }
export const studioPushPreferencesBody = z.strictObject({
  push: z.strictObject({ orders: z.boolean().optional(), messages: z.boolean().optional(), lowStock: z.boolean().optional(), payouts: z.boolean().optional() }),
})
