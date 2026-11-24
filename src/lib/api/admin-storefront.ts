import { api } from "./client"
import type { AdminPayoutAccountsDto, AdminPayoutAccountsQuery } from "./contracts/admin-payout-accounts"
import type { PayoutAccountStatus } from "../admin-storefront"
import type { PublishForBrandPreviewDto } from "./founding"

/* ---------- Admin › Brands › Publish / Unpublish storefront (brands.restrict) ---------- */

export type AdminStorefrontStateDto = {
  live: boolean
  /** Claimed by its owner, not live yet: the action reads "Make live". */
  claimedNotLive: boolean
  hasVersion: boolean
  unpublished: boolean
  closed: boolean
  founding: boolean
  claimStatus: string
  liveProducts: number
  payout: { status: PayoutAccountStatus; bankName: string; accountName: string; last4: string; currency: string; changedAt: string } | null
  publish: { allowed: boolean; noop: boolean; blockers: string[]; warnings: string[] }
  unpublish: { allowed: boolean; noop: boolean; blocker: string | null }
}
export type AdminStorefrontPreviewDto = PublishForBrandPreviewDto & { storefront: AdminStorefrontStateDto }

/** The same cache entry as the founding tray's "Publish storefront for {brand}" (publishForBrandKey). */
export const adminStorefrontKey = (brandId: string) => `admin:brand-storefront:${brandId}`
const storefrontOf = (brandId: string) => `/api/admin/brand-storefronts/${encodeURIComponent(brandId)}`
export const getAdminStorefront = (brandId: string) => api<AdminStorefrontPreviewDto>(storefrontOf(brandId))
export const publishAdminStorefront = (brandId: string) => api<{ created: boolean; version: number | null; emailed: number; preview: AdminStorefrontPreviewDto }>(storefrontOf(brandId), { method: "POST" })
export const unpublishAdminStorefront = (brandId: string) => api<{ changed: boolean; preview: AdminStorefrontPreviewDto }>(storefrontOf(brandId), { method: "DELETE" })

/* ---------- Admin › Finance › Payout accounts (Owner and Finance) ---------- */

export const payoutAccountsKey = (q: Partial<AdminPayoutAccountsQuery>) => `admin:finance:payout-accounts:${q.status ?? "all"}:${q.q ?? ""}:${q.page ?? 1}`
export const listAdminPayoutAccounts = (q: Partial<AdminPayoutAccountsQuery>) =>
  api<AdminPayoutAccountsDto>("/api/admin/finance/payout-accounts", { query: { status: q.status ?? "all", page: q.page ?? 1, pageSize: q.pageSize ?? 50, ...(q.q ? { q: q.q } : {}) } })
