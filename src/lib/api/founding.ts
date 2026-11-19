import { api } from "./client"
import type { FoundingBrandRow, FoundingCreateBody, FoundingPatchBody } from "./contracts/founding"
import type { WebsiteCreateBody, WebsiteScanBody, WebsiteScanDto } from "./contracts/from-website"

/**
 * Typed wrappers for the founding-brands endpoints: the Control Center's list, create tray and
 * claim-link actions (all owner-only: brands.founding), and the public /auth/claim page.
 */

export type FoundingListDto = { items: FoundingBrandRow[]; nextCursor: string | null }
export type FoundingHandleDto = { handle: string; status: string; available: boolean; message: string | null }
export type ClaimLinkDto = { id: string; email: string; status: string; createdAt: string; expiresAt: string }
export type IssueClaimLinkDto = { created: boolean; url: string; link: ClaimLinkDto }
export type SetupSessionDto = { brandId: string; handle: string; expiresAt: string; studioUrl: string }

export type ClaimPreviewDto = {
  brand: { id: string; name: string; handle: string; city: string; country: string }
  email: string
  hasAccount: boolean
  signedInMatches: boolean
  expiresAt: string
  agreementVersion: string
  agreementUrl: string
  /** The shop goes live the moment it's claimed. */
  goesLive: boolean
}
export type ClaimAcceptDto = {
  status: "signed_in"
  actor: "brand"
  brandId: string
  redirect: string
  shop: { live: boolean; handle: string; url: string; payoutAccount: boolean; liveProducts: number }
}

export const foundingKeys = {
  list: "admin:founding:list",
  one: (id: string) => `admin:founding:${id}`,
}

const one = (id: string) => `/api/admin/founding-brands/${encodeURIComponent(id)}`

export const listFoundingBrands = (cursor?: string | null) => api<FoundingListDto>("/api/admin/founding-brands", { query: { cursor: cursor ?? undefined, limit: 50 } })
export const getFoundingBrand = (id: string) => api<{ brand: FoundingBrandRow }>(one(id))
export const checkFoundingHandle = (handle: string, signal?: AbortSignal) => api<FoundingHandleDto>("/api/admin/founding-brands/handle", { query: { handle }, signal })
export const createFoundingBrand = (body: FoundingCreateBody) => api<{ brand: FoundingBrandRow }>("/api/admin/founding-brands", { body })
export const updateFoundingBrand = (id: string, body: FoundingPatchBody) => api<{ brand: FoundingBrandRow }>(one(id), { method: "PATCH", body })
export const openSetupSession = (id: string) => api<SetupSessionDto>(`${one(id)}/setup-session`, { method: "POST" })
export const endSetupSession = (id: string) => api<{ ended: number; removed: boolean }>(`${one(id)}/setup-session`, { method: "DELETE" })
export const issueClaimLink = (id: string, body: { email: string; idempotencyKey: string }) => api<IssueClaimLinkDto>(`${one(id)}/claim-link`, { body })
export const revokeClaimLink = (id: string) => api<{ link: ClaimLinkDto }>(`${one(id)}/claim-link`, { method: "DELETE" })

export const previewClaim = (token: string, signal?: AbortSignal) => api<ClaimPreviewDto>("/api/auth/claim/preview", { body: { token }, signal })
export const acceptClaim = (body: { token: string; acceptAgreement: boolean; agreementVersion: string; name?: string; password?: string }) => api<ClaimAcceptDto>("/api/auth/claim/accept", { body })

/** A fresh idempotency key for one user action (reused on that action's retries). */
export const actionKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "")

/* ---------- Publish storefront for a brand (Admin › Brands; brands.restrict) ---------- */

export type PublishForBrandPreviewDto = {
  brand: { id: string; name: string; handle: string; founding: boolean; claimStatus: string }
  published: boolean
  checklist: { items: { key: "logo" | "banner" | "intro" | "products"; label: string; done: boolean; value?: string }[]; warning: string | null }
  blocked: string | null
  payoutAccount: boolean
  goLiveOnClaim: boolean
}
export type PublishForBrandDto = { created: boolean; version: number | null; emailed: number; preview: PublishForBrandPreviewDto }

export const publishForBrandKey = (brandId: string) => `admin:brand-storefront:${brandId}`
const storefrontOf = (brandId: string) => `/api/admin/brand-storefronts/${encodeURIComponent(brandId)}`
export const getPublishForBrand = (brandId: string) => api<PublishForBrandPreviewDto>(storefrontOf(brandId))
export const publishForBrand = (brandId: string) => api<PublishForBrandDto>(storefrontOf(brandId), { method: "POST" })

/* ---------- Create brand from website (Admin › Brands › Founding) ---------- */

const fromWebsite = "/api/admin/founding-brands/from-website"
export const websiteScanKey = (importId: string) => `admin:founding:from-website:${importId}`
export const startWebsiteScan = (body: WebsiteScanBody) => api<WebsiteScanDto>(fromWebsite, { body })
export const getWebsiteScan = (importId: string) => api<WebsiteScanDto>(`${fromWebsite}/${encodeURIComponent(importId)}`)
export const createStoreFromWebsite = (importId: string, body: WebsiteCreateBody) => api<WebsiteScanDto>(`${fromWebsite}/${encodeURIComponent(importId)}/create`, { body })
