import { api } from "./client"
import type { BrandEmailContextDto, BrandEmailPreviewDto, BrandEmailSendBody, BrandEmailSendResult, StudioEmailSettingsDto } from "./contracts/brand-emails"

/** Typed wrappers over the brand-email routes: /api/admin/brand-emails/{brandId} (brands.email) and /api/studio/settings/emails. */

const ADMIN = (brandId: string) => `/api/admin/brand-emails/${encodeURIComponent(brandId)}`

export const brandEmailKeys = { one: (brandId: string) => `admin:brand-emails:${brandId}`, studio: "studio.email_settings" }

export const getBrandEmails = (brandId: string) => api<BrandEmailContextDto>(ADMIN(brandId))
export const sendBrandEmail = (brandId: string, body: BrandEmailSendBody) => api<BrandEmailSendResult>(ADMIN(brandId), { body })
export const previewBrandEmail = (brandId: string, body: Omit<BrandEmailSendBody, "idempotencyKey">) => api<BrandEmailPreviewDto>(`${ADMIN(brandId)}/preview`, { body })

export const getStudioEmailSettings = () => api<StudioEmailSettingsDto>("/api/studio/settings/emails")
export const updateStudioEmailSettings = (nudges: boolean) => api<StudioEmailSettingsDto>("/api/studio/settings/emails", { method: "PUT", body: { nudges } })
