import { api } from "./client"
import type {
  AbuseListDto,
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
  HeldViewResult,
  HolidayDto,
  MessageCaseDto,
  MessageListDto,
  MessageTab,
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
export const listHolidays = (country?: string) => api<{ items: HolidayDto[] }>("/api/admin/holidays", { query: { country } })
export const listAbuse = (user?: string) => api<AbuseListDto>("/api/admin/abuse", { query: { user } })
export const listRestrictions = (subject?: string) => api<{ items: RestrictionDto[] }>("/api/admin/restrictions", { query: { subject } })
export const listAudit = (q: { subjectType?: string; subjectId?: string; actorKind?: string; cursor?: string; limit?: number } = {}) => api<AuditListResult>("/api/admin/audit", { query: q })
export const getStatuses = (kind: "user" | "brand", ids: string[]) => api<{ statuses: Record<string, string> }>("/api/admin/statuses", { query: { kind, ids: ids.join(",") } })

/** POST /api/admin/decisions/{action}. Throws ApiError (403 forbidden, 409 conflict, …) for the dialog to show. */
export function decide<K extends DecisionKey, T = unknown>(action: K, body: DecisionBody<K>) {
  return api<DecisionResult<T>>(`/api/admin/decisions/${action}`, { body })
}
