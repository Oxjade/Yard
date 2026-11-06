import { z } from "zod"
import { PUBLISH_VISIBILITIES, SOCIAL_ACCOUNT_STATUSES, SOCIAL_MODES, SOCIAL_POST_KINDS, SOCIAL_POST_SOURCES, SOCIAL_PROVIDERS } from "./enums"

/** Social contracts (F1 draft; cluster S owns this file in wave 2, §6.1). */
export const socialProvider = z.enum(SOCIAL_PROVIDERS)

export const socialAccountDto = z.object({
  id: z.string().nullable(),
  provider: socialProvider,
  mode: z.enum(SOCIAL_MODES).nullable(),
  status: z.enum([...SOCIAL_ACCOUNT_STATUSES, "not_connected"]),
  statusDetail: z.string().nullable(),
  handle: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarSrc: z.string().nullable(),
  accountType: z.string().nullable(),
  connectedAt: z.string().nullable(),
  connectedBy: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  postCount: z.number(),
  configured: z.boolean(),
  sandboxAvailable: z.boolean(),
  /** Development only. */
  setup: z.object({ envVars: z.array(z.string()), redirectUri: z.string() }).optional(),
})
export type SocialAccountDto = z.infer<typeof socialAccountDto>

export const socialPostMediaDto = z.object({ src: z.string(), alt: z.string(), width: z.number(), height: z.number(), kind: z.enum(["image", "video"]), posterSrc: z.string().optional() })

export const socialPostDto = z.object({
  id: z.string(),
  brandId: z.string(),
  source: z.enum(SOCIAL_POST_SOURCES),
  kind: z.enum(SOCIAL_POST_KINDS),
  caption: z.string(),
  permalink: z.string().optional(),
  embedUrl: z.string().optional(),
  postedAt: z.string(),
  media: z.array(socialPostMediaDto),
  productIds: z.array(z.string()),
  featured: z.boolean(),
  sample: z.boolean(),
})
export type SocialPostDto = z.infer<typeof socialPostDto>

/** The Studio view of a post adds status fields. */
export const studioSocialPostDto = socialPostDto.extend({
  visibility: z.enum(PUBLISH_VISIBILITIES),
  moderationStatus: z.enum(["ok", "flagged", "removed"]),
  removedReason: z.string().nullable(),
  featureOrder: z.number().nullable(),
  upstreamMissingAt: z.string().nullable(),
})
export type StudioSocialPostDto = z.infer<typeof studioSocialPostDto>

export const createPostsBody = z
  .object({
    mediaIds: z.array(z.string()).min(1).max(10),
    caption: z.string().max(2200).default(""),
    productIds: z.array(z.string()).max(6).default([]),
    publish: z.boolean().default(true),
    carousel: z.boolean().default(false),
  })
  .strict()
export const patchPostBody = z
  .object({ visibility: z.enum(PUBLISH_VISIBILITIES).optional(), featured: z.boolean().optional(), productIds: z.array(z.string()).max(6).optional(), caption: z.string().max(2200).optional() })
  .strict()
export const featuredOrderBody = z.object({ ids: z.array(z.string()).max(50) }).strict()
export const disconnectBody = z.object({ deletePosts: z.boolean() }).strict()

/** Payloads this feature publishes (imported by contracts/realtime.ts). */
export const socialRealtimeEvents = {
  "social.status": z.object({ accountId: z.string(), status: z.enum(SOCIAL_ACCOUNT_STATUSES) }),
}
