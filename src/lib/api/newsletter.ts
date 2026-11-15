import { api } from "./client"
import type { NewsletterBrandDto, NewsletterDetailDto, NewsletterFields, NewsletterListDto, NewsletterPatchBody, NewsletterPreviewDto, NewsletterRecipientsDto, NewsletterSendBody } from "./contracts/newsletter"
import type { NewsletterAudienceType, NewsletterKind } from "../newsletter"

/** Typed wrappers over /api/admin/newsletters (comms.newsletter). */

const BASE = "/api/admin/newsletters"
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`

export const newsletterKeys = { list: "admin.newsletters.list", one: (id: string) => `admin.newsletters.one:${id}` }

export const listNewsletters = () => api<NewsletterListDto>(BASE)
export const createNewsletter = (kind?: NewsletterKind) => api<{ campaign: NewsletterDetailDto }>(BASE, { body: kind ? { kind } : {} })
export const getNewsletter = (id: string) => api<{ campaign: NewsletterDetailDto }>(one(id))
export const saveNewsletter = (id: string, body: NewsletterPatchBody) => api<{ campaign: NewsletterDetailDto }>(one(id), { method: "PATCH", body })
export const deleteNewsletter = (id: string) => api<{ ok: true }>(one(id), { method: "DELETE" })
export const previewNewsletter = (id: string, body: Partial<NewsletterFields>, signal?: AbortSignal) => api<NewsletterPreviewDto>(`${one(id)}/preview`, { body, signal })
export const testNewsletter = (id: string, idempotencyKey: string) => api<{ to: string; created: boolean }>(`${one(id)}/test`, { body: { idempotencyKey } })
export const sendNewsletter = (id: string, body: NewsletterSendBody) => api<{ campaign: NewsletterDetailDto }>(`${one(id)}/send`, { body })
export const cancelNewsletter = (id: string) => api<{ campaign: NewsletterDetailDto }>(`${one(id)}/cancel`, { method: "POST" })
export const newsletterRecipients = (id: string, status: string, offset = 0) => api<NewsletterRecipientsDto>(`${one(id)}/recipients`, { query: { status, offset } })
export const newsletterAudienceCount = (q: { kind: NewsletterKind; type: NewsletterAudienceType; brandId?: string | null; country?: string | null }, signal?: AbortSignal) =>
  api<{ count: number }>(`${BASE}/audience`, { query: { kind: q.kind, type: q.type, brandId: q.brandId ?? undefined, country: q.country ?? undefined }, signal })
export const newsletterBrands = (q: string) => api<{ brands: NewsletterBrandDto[] }>(`${BASE}/brands`, { query: { q } })
