import { api } from "./client"
import type {
  AbuseListDto,
  AdminCatalogProductsDto,
  AuditListResult,
  ChartFlagDetailDto,
  ChartFlagsDto,
  ChartsOverviewDto,
  ContentListDto,
  ContentTab,
  DecisionBody,
  DecisionKey,
  DecisionResult,
  DeliveryListDto,
  DeliveryTab,
  EvidenceResult,
  HeldNoteViewResult,
  HeldViewResult,
  HolidayDto,
  MessageCaseDto,
  MessageListDto,
  MessageTab,
  OnboardingApplicationsDto,
  QueueCountsDto,
  RestrictionDto,
  SponsoredRowDto,
} from "./contracts/admin"

/**
 * Typed wrappers for the Control Center's v2 endpoints (§8.2). Every call carries the admin
 * cookie (same-origin) and X-Yard-Client; decisions are POSTs that answer { item, audit }.
 */

export const adminKeys = {
  counts: "admin:counts",
  onboardings: "admin:catalog:onboardings",
  catalogProducts: "admin:catalog:products",
  messages: (tab: MessageTab) => `admin:messages:${tab}`,
  content: (tab: ContentTab) => `admin:content:${tab}`,
  chartsOverview: "admin:charts:overview",
  chartFlags: (status: string) => `admin:charts:flags:${status}`,
  chartFlag: (id: string) => `admin:charts:flag:${id}`,
  sponsored: "admin:charts:sponsored",
  delivery: (tab: DeliveryTab, country?: string) => `admin:delivery:${tab}:${country ?? ""}`,
  abuse: "admin:abuse",
  audit: (subjects: string) => `admin:audit:${subjects}`,
  statuses: (kind: string, ids: string) => `admin:statuses:${kind}:${ids}`,
}

export const getQueueCounts = () => api<QueueCountsDto>("/api/admin/queues/counts")
export const listMessages = (tab: MessageTab) => api<MessageListDto>("/api/admin/messages", { query: { tab } })
export const getMessageCase = (id: string) => api<MessageCaseDto>(`/api/admin/messages/${encodeURIComponent(id)}`)
export const viewEvidence = (reportId: string) => api<EvidenceResult>(`/api/admin/messages/${encodeURIComponent(reportId)}/evidence`, { method: "POST" })
export const viewHeldMessage = (messageId: string) => api<HeldViewResult>(`/api/admin/messages/held/${encodeURIComponent(messageId)}/view`, { method: "POST" })
export const listContent = (tab: ContentTab) => api<ContentListDto>("/api/admin/content", { query: { tab } })
export const getChartsOverview = () => api<ChartsOverviewDto>("/api/admin/charts/overview")
export const listChartFlags = (status: "open" | "decided" | "frozen" | "all") => api<ChartFlagsDto>("/api/admin/charts/flags", { query: { status } })
export const getChartFlag = (id: string) => api<ChartFlagDetailDto>(`/api/admin/charts/flags/${encodeURIComponent(id)}`)
export const listSponsored = () => api<{ items: SponsoredRowDto[] }>("/api/admin/charts/sponsored")
export const listDelivery = (tab: DeliveryTab, country?: string) => api<DeliveryListDto>("/api/admin/delivery", { query: { tab, country } })
/** POST: a held brand note's text (audited delivery_note.viewed; Support, Trust & safety and owners). */
export const viewHeldNote = (id: string) => api<HeldNoteViewResult>(`/api/admin/delivery/notes/${encodeURIComponent(id)}/view`, { method: "POST" })
export const listHolidays = (country?: string) => api<{ items: HolidayDto[] }>("/api/admin/holidays", { query: { country } })
export const listAbuse = (user?: string) => api<AbuseListDto>("/api/admin/abuse", { query: { user } })
export const listRestrictions = (subject?: string) => api<{ items: RestrictionDto[] }>("/api/admin/restrictions", { query: { subject } })
export const listAudit = (q: { subjectType?: string; subjectId?: string; actorKind?: string; cursor?: string; limit?: number } = {}) => api<AuditListResult>("/api/admin/audit", { query: q })
export const getStatuses = (kind: "user" | "brand", ids: string[]) => api<{ statuses: Record<string, string>; reinstateTo?: Record<string, "pending_review" | "verified"> }>("/api/admin/statuses", { query: { kind, ids: ids.join(",") } })
export const listOnboardingApplications = () => api<OnboardingApplicationsDto>("/api/admin/catalog/onboardings", { query: { limit: 200 } })
export const reviewOnboardingApplication = (id: string, body: { decision: "approve" | "reject"; note?: string }) =>
  api<{ onboardingId: string; status: "approved" | "rejected"; brandId: string }>(`/api/admin/catalog/onboardings/${encodeURIComponent(id)}/review`, { body })
export const listAdminCatalogProducts = () => api<AdminCatalogProductsDto>("/api/admin/catalog/products", { query: { limit: 200 } })
export const moderateProduct = (id: string, body: { hidden: boolean; reason: string }) =>
  api<{ productId: string; moderationStatus: "hidden" | "ok" }>(`/api/admin/catalog/products/${encodeURIComponent(id)}/moderation`, { body })

/** POST /api/admin/decisions/{action}. Throws ApiError (403 forbidden, 409 conflict, …) for the dialog to show. */
export function decide<K extends DecisionKey, T = unknown>(action: K, body: DecisionBody<K>) {
  return api<DecisionResult<T>>(`/api/admin/decisions/${action}`, { body })
}
