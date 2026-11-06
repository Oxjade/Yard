import { z } from "zod"
import { PUBLISH_VISIBILITIES, SOCIAL_ACCOUNT_STATUSES, SOCIAL_MODES, SOCIAL_POST_KINDS, SOCIAL_POST_SOURCES, SOCIAL_PROVIDERS } from "./enums"

/**
 * Social contracts (cluster S, §6.1): Studio connections and Content Studio, the public feed,
 * OAuth start, and the data-deletion status page. Responses are DTOs: no token ever appears.
 */
export const socialProvider = z.enum(SOCIAL_PROVIDERS)
export type SocialProviderId = z.infer<typeof socialProvider>

export const providerLabels: Record<SocialProviderId, string> = { instagram: "Instagram", tiktok: "TikTok" }

/** Which posts a feed or a Studio filter shows. "uploads" = posts on Yard itself (uploads and seeded samples). */
export const FEED_SOURCES = ["all", "instagram", "tiktok", "uploads"] as const
export const feedSource = z.enum(FEED_SOURCES)
export type FeedSource = z.infer<typeof feedSource>

export const socialAccountDto = z.object({
  /** null while the provider isn't connected (status "not_connected"). */
  id: z.string().nullable(),
  provider: socialProvider,
  mode: z.enum(SOCIAL_MODES).nullable(),
  status: z.enum([...SOCIAL_ACCOUNT_STATUSES, "not_connected"]),
  /** Safe, user-facing detail for error and needs_reauth. */
  statusDetail: z.string().nullable(),
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarSrc: z.string().nullable(),
  accountType: z.string().nullable(),
  connectedAt: z.string().nullable(),
  /** The member who connected it, by name. */
  connectedBy: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  /** The last sync didn't finish (safe copy), or null. */
  syncError: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  /** Posts imported from this account (any visibility). */
  postCount: z.number(),
  /** A sync is running on the server right now. */
  syncing: z.boolean(),
  /** When "Sync now" is allowed again (1 per 5 min), or null when it is now. */
  syncAvailableAt: z.string().nullable(),
  /** Yard's platform keys for this provider are set. */
  configured: z.boolean(),
  /** The development sandbox can stand in for this provider. */
  sandboxAvailable: z.boolean(),
  /** Development only: what an operator registers to switch the live provider on. */
  setup: z.object({ envVars: z.array(z.string()), redirectUri: z.string() }).optional(),
})
export type SocialAccountDto = z.infer<typeof socialAccountDto>

export const socialAccountsResult = z.object({
  accounts: z.array(socialAccountDto),
  /** Yard paused social connections for this brand (a `social_disabled` restriction). */
  paused: z.object({ reason: z.string(), until: z.string().nullable() }).nullable(),
})
export type SocialAccountsResult = z.infer<typeof socialAccountsResult>

export const socialPostMediaDto = z.object({
  src: z.string(),
  alt: z.string(),
  width: z.number(),
  height: z.number(),
  kind: z.enum(["image", "video"]),
  posterSrc: z.string().optional(),
  durationMs: z.number().optional(),
  /** false for a video kept as its poster only (a TikTok cover, or an Instagram video over 50 MB): it plays on the network. */
  playable: z.boolean().optional(),
})
export type SocialPostMediaDto = z.infer<typeof socialPostMediaDto>

export const socialPostDto = z.object({
  id: z.string(),
  brandId: z.string(),
  source: z.enum(SOCIAL_POST_SOURCES),
  /** The network an import (or a sandbox import) came from; null for uploads and samples. */
  provider: socialProvider.nullable(),
  kind: z.enum(SOCIAL_POST_KINDS),
  caption: z.string(),
  permalink: z.string().optional(),
  embedUrl: z.string().optional(),
  postedAt: z.string(),
  media: z.array(socialPostMediaDto),
  productIds: z.array(z.string()),
  featured: z.boolean(),
  featureOrder: z.number().nullable(),
  sample: z.boolean(),
})
export type SocialPostDto = z.infer<typeof socialPostDto>

/** The Studio view of a post adds status fields. */
export const studioSocialPostDto = socialPostDto.extend({
  visibility: z.enum(PUBLISH_VISIBILITIES),
  moderationStatus: z.enum(["ok", "flagged", "removed"]),
  removedReason: z.string().nullable(),
  upstreamMissingAt: z.string().nullable(),
  updatedAt: z.string(),
})
export type StudioSocialPostDto = z.infer<typeof studioSocialPostDto>

/** Content Studio's status tabs. "removed" = removed by Yard. */
export const STUDIO_POST_STATUSES = ["published", "hidden", "draft", "removed"] as const
export type StudioPostStatus = (typeof STUDIO_POST_STATUSES)[number]

export const studioPostsQuery = z
  .object({
    source: feedSource.default("all"),
    visibility: z.enum([...STUDIO_POST_STATUSES, "all"]).default("all"),
  })
  .strict()
export const studioPostsResult = z.object({
  posts: z.array(studioSocialPostDto),
  /** Per status, for the current source filter. */
  counts: z.object({ published: z.number(), hidden: z.number(), draft: z.number(), removed: z.number() }),
})
export type StudioPostsResult = z.infer<typeof studioPostsResult>

export const CAPTION_MAX = 2200
export const POST_PRODUCTS_MAX = 6
export const POST_MEDIA_MAX = 10

export const createPostsBody = z
  .object({
    mediaIds: z.array(z.string().max(80)).min(1, { error: "Add a photo or a video first." }).max(POST_MEDIA_MAX),
    /** A video's poster frame, uploaded as an image: { [videoMediaId]: imageMediaId }. */
    posters: z.record(z.string().max(80), z.string().max(80)).default({}),
    caption: z.string().max(CAPTION_MAX, { error: `Keep the caption to ${CAPTION_MAX} characters.` }).default(""),
    productIds: z.array(z.string().max(80)).max(POST_PRODUCTS_MAX, { error: `Tag up to ${POST_PRODUCTS_MAX} pieces.` }).default([]),
    publish: z.boolean().default(true),
    carousel: z.boolean().default(false),
  })
  .strict()
export type CreatePostsBody = z.input<typeof createPostsBody>
export type CreatePostsData = z.output<typeof createPostsBody>

export const patchPostBody = z
  .object({
    visibility: z.enum(PUBLISH_VISIBILITIES).optional(),
    featured: z.boolean().optional(),
    productIds: z.array(z.string().max(80)).max(POST_PRODUCTS_MAX, { error: `Tag up to ${POST_PRODUCTS_MAX} pieces.` }).optional(),
    caption: z.string().max(CAPTION_MAX, { error: `Keep the caption to ${CAPTION_MAX} characters.` }).optional(),
  })
  .strict()
export type PatchPostBody = z.infer<typeof patchPostBody>

/** Content Studio's bulk bar: show or hide several posts at once (one transaction). */
export const bulkVisibilityBody = z
  .object({ ids: z.array(z.string().max(80)).min(1).max(100), visibility: z.enum(["published", "hidden"]) })
  .strict()
export const featuredOrderBody = z.object({ ids: z.array(z.string().max(80)).max(50) }).strict()
export const disconnectBody = z.object({ deletePosts: z.boolean() }).strict()

export const postResult = z.object({ post: studioSocialPostDto })
export const postsResult = z.object({ posts: z.array(studioSocialPostDto) })

/** POST /api/social/{provider}/start → the authorize URL the browser navigates to. */
export const startQuery = z.object({ mode: z.enum(["sandbox"]).optional() }).strict()
export const startResult = z.object({ url: z.string() })

/** GET /api/brands/{brandId}/social-posts (public). */
export const publicPostsQuery = z
  .object({
    source: feedSource.default("all"),
    limit: z.coerce.number().int().min(1).max(24).default(12),
    /** Only posts tagging this product ("Seen on the feed"). */
    product: z.string().max(80).optional(),
    /** Pinned post ids (comma separated, up to 12): returned first, whatever the limit. */
    pinned: z
      .string()
      .max(12 * 81)
      .optional()
      .transform((v) => (v ? v.split(",").filter(Boolean).slice(0, 12) : [])),
  })
  .strict()
export const publicPostsResult = z.object({ posts: z.array(socialPostDto) })
export type PublicPostsResult = z.infer<typeof publicPostsResult>

/** GET /api/social/data-deletion/{code}: status only, for the status page. */
export const dataDeletionStatus = z.object({ status: z.enum(["received", "completed"]) })

/** Payloads this feature publishes (imported by contracts/realtime.ts). */
export const socialRealtimeEvents = {
  "social.status": z.object({ accountId: z.string(), status: z.enum(SOCIAL_ACCOUNT_STATUSES) }),
}

/** What the OAuth callback says when it redirects back to Studio (?result=). */
export const CONNECT_RESULTS = ["connected", "denied", "invalid_state", "error", "already_connected"] as const
export type ConnectResult = (typeof CONNECT_RESULTS)[number]

/**
 * The only media sources a client renders: Yard's media route and seeded /media/ paths. Anything
 * else (a remote URL, a data: URL) gets the fallback, never a fetch to another host (§6 intro).
 */
export function isSafeMediaSrc(src: string | undefined | null): src is string {
  return !!src && (/^\/api\/media\/[A-Za-z0-9_-]+(\?as=(shopper|brand|admin))?$/.test(src) || /^\/media\/[\w./-]+$/.test(src)) && !src.includes("..")
}

/** TikTok embeds are rendered only from this prefix (checked on write and on render, §6.1). */
export const TIKTOK_EMBED_PREFIX = "https://www.tiktok.com/embed/"
export const isSafeEmbed = (url: string | undefined | null): url is string => !!url && url.startsWith(TIKTOK_EMBED_PREFIX) && !/[\s"'<>]/.test(url)

/** Permalinks open only on the networks themselves (https, instagram.com or tiktok.com). */
export const isSafePermalink = (url: string | undefined | null): url is string => !!url && /^https:\/\/(www\.)?(instagram|tiktok)\.com\/[^\s"'<>]*$/.test(url)
