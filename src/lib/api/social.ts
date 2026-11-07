import { api } from "./client"
import {
  isSafeMediaSrc,
  publicPostsResult,
  socialAccountsResult,
  startResult,
  studioPostsResult,
  type CreatePostsBody,
  type FeedSource,
  type PatchPostBody,
  type PublicPostsResult,
  type SocialAccountsResult,
  type SocialProviderId,
  type StudioPostsResult,
  type StudioPostStatus,
  type StudioSocialPostDto,
} from "./contracts/social"

/** Typed wrappers for the social API (§1.9). Every call goes through api(), so CSRF headers and errors are uniform. */

export const accountsKey = "/api/studio/social/accounts"
export const getAccounts = () => api<SocialAccountsResult>(accountsKey, { schema: socialAccountsResult })

export const studioPostsKey = (source: FeedSource = "all", visibility: StudioPostStatus | "all" = "all") => `/api/studio/social/posts?source=${source}&visibility=${visibility}`
export const getStudioPosts = (key: string) => api<StudioPostsResult>(key, { schema: studioPostsResult })

export const startConnect = (provider: SocialProviderId, sandbox = false) => api<{ url: string }>(`/api/social/${provider}/start`, { method: "POST", query: sandbox ? { mode: "sandbox" } : undefined, schema: startResult })
export const syncNow = (accountId: string) => api<{ accountId: string; syncing: boolean }>(`/api/studio/social/accounts/${encodeURIComponent(accountId)}/sync`, { method: "POST" })
export const disconnectAccount = (accountId: string, deletePosts: boolean) => api<{ posts: number; deleted: boolean }>(`/api/studio/social/accounts/${encodeURIComponent(accountId)}/disconnect`, { body: { deletePosts } })

export const createPosts = (body: CreatePostsBody) => api<{ posts: StudioSocialPostDto[] }>("/api/studio/social/posts", { body })
export const patchPost = (id: string, body: PatchPostBody) => api<{ post: StudioSocialPostDto }>(`/api/studio/social/posts/${encodeURIComponent(id)}`, { method: "PATCH", body })
export const deletePost = (id: string) => api<void>(`/api/studio/social/posts/${encodeURIComponent(id)}`, { method: "DELETE" })
export const bulkVisibility = (ids: string[], visibility: "published" | "hidden") => api<{ posts: StudioSocialPostDto[] }>("/api/studio/social/posts/bulk", { body: { ids, visibility } })
export const setFeaturedOrder = (ids: string[]) => api<{ ids: string[] }>("/api/studio/social/posts/featured-order", { method: "PUT", body: { ids } })

/** The public feed of a brand (storefront, "Seen on the feed"). */
export function publicPostsKey(brandId: string, q: { source?: FeedSource; limit?: number; product?: string; pinned?: string[] } = {}) {
  const p = new URLSearchParams()
  if (q.source && q.source !== "all") p.set("source", q.source)
  if (q.limit) p.set("limit", String(q.limit))
  if (q.product) p.set("product", q.product)
  if (q.pinned?.length) p.set("pinned", q.pinned.slice(0, 12).join(","))
  const s = p.toString()
  return `/api/brands/${encodeURIComponent(brandId)}/social-posts${s ? `?${s}` : ""}`
}
export const getPublicPosts = (key: string) => api<PublicPostsResult>(key, { schema: publicPostsResult })

/** Opening a post counts as a `post_open` signal (§6.3). Fire and forget: a refusal never shows. */
export function reportPostOpen(brandId: string) {
  void api("/api/signals", { body: { kind: "post_open", brandId }, keepalive: true }).catch(() => {})
}

/** A src the client may render (Yard's media route or a seeded /media path), else the fallback. */
export const FALLBACK_COVER = "/media/missing.svg"
export const safeSrc = (src: string | undefined | null) => (isSafeMediaSrc(src) ? src : FALLBACK_COVER)

/** "0:42" for a video's duration. */
export function durationLabel(ms?: number) {
  if (!ms || ms < 500) return null
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
