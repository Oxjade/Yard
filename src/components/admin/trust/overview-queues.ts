"use client"

import { adminKeys, getQueueCounts, listAudit, listChartFlags, listContent, listDelivery, listMessages } from "@/lib/api/admin"
import { complaintKindLabels } from "@/lib/api/contracts/admin"
import type { AuditEntryDto } from "@/lib/api/contracts/common"
import { useApi } from "@/lib/api/use-api"
import { canAdmin, type AdminPermission } from "@/lib/permissions"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"
import { useQueueLive } from "./shared"

/**
 * The Overview's decision queue gains the v2 server queues (§8.3): Messages, Content, Places,
 * Charts and Delivery. Each shows only for an admin whose role can view it; rows link to the case.
 */

export type ServerQueueTab = "messages" | "content" | "places" | "charts" | "delivery"
export const SERVER_QUEUE_TABS: ServerQueueTab[] = ["messages", "content", "places", "charts", "delivery"]
const label: Record<ServerQueueTab, string> = { messages: "Messages", content: "Content", places: "Places", charts: "Charts", delivery: "Delivery" }
const permission: Record<ServerQueueTab, AdminPermission> = { messages: "messages.view_reports", content: "content.moderate", places: "places.moderate", charts: "charts.review", delivery: "shipping.view" }
export const isServerQueueTab = (t: string): t is ServerQueueTab => (SERVER_QUEUE_TABS as string[]).includes(t)

export type QueueRow = { id: string; title: string; meta: string; badge?: { text: string; tone: "attention" | "danger" | "muted" | "purple" }; href: string }

async function rowsFor(tab: ServerQueueTab): Promise<QueueRow[]> {
  if (tab === "messages") {
    const [reported, held] = await Promise.all([listMessages("reported"), listMessages("held")])
    return [...reported.items, ...held.items].slice(0, 6).map((c) => ({
      id: c.id,
      title: c.subjectGone && !c.customer.id ? `${c.brand.name}, subject deleted` : `${c.customer.name} and ${c.brand.name}`,
      meta: c.kind === "report" ? `Reported by ${c.reporter?.name ?? "someone"}` : `Held, sent by the ${c.side === "brand" ? "brand" : "shopper"}`,
      badge: { text: c.reasonLabel, tone: c.reason?.includes("offplatform") ? "danger" : "attention" },
      href: `/admin/messages?${c.kind === "held" ? "tab=held&" : ""}case=${encodeURIComponent(c.id)}`,
    }))
  }
  if (tab === "content") {
    const [posts, uploads] = await Promise.all([listContent("posts"), listContent("uploads")])
    const all = [...(posts.tab === "posts" ? posts.posts : []), ...(uploads.tab === "uploads" ? uploads.posts : [])].filter((p) => p.report)
    return all.slice(0, 6).map((p) => ({
      id: p.id,
      title: `${p.brand.name}, ${p.source === "upload" ? "upload" : "post"}`,
      meta: `Reported by ${p.report!.reporter.name}`,
      badge: { text: p.report!.reasonLabel, tone: "attention" },
      href: `/admin/content?tab=${p.source === "upload" ? "uploads" : "posts"}&case=${encodeURIComponent(p.id)}`,
    }))
  }
  if (tab === "places") {
    const r = await listContent("places")
    const places = r.tab === "places" ? r.places : []
    return places
      .filter((p) => p.moderationStatus === "pending_review" || p.report || p.events.some((e) => e.moderationStatus === "pending_review" || e.report))
      .slice(0, 6)
      .map((p) => {
        const ev = p.events.find((e) => e.report || e.moderationStatus === "pending_review")
        const why = p.report ? p.report.reasonLabel : p.moderationStatus === "pending_review" ? "To review" : ev?.report ? `Event: ${ev.report.reasonLabel.toLowerCase()}` : "Event to review"
        return { id: p.id, title: p.name, meta: `${p.brand.name}, ${p.city}`, badge: { text: why, tone: p.report || ev?.report ? "attention" : "purple" }, href: `/admin/content?tab=places&case=${encodeURIComponent(p.id)}` }
      })
  }
  if (tab === "charts") {
    const r = await listChartFlags("open")
    const pending = r.freezes.filter((f) => f.status === "pending_approval")
    return [
      ...pending.map((f) => ({ id: f.id, title: f.brand.name, meta: `Freeze requested by ${f.requestedBy.name}`, badge: { text: "Needs a second admin", tone: "attention" as const }, href: "/admin/charts?tab=frozen" })),
      ...r.items.map((f) => ({ id: f.id, title: f.brand.name, meta: f.detectorLabel, badge: { text: `${f.severity} severity`, tone: f.severity === "high" ? ("danger" as const) : ("attention" as const) }, href: `/admin/charts?tab=flags&case=${encodeURIComponent(f.id)}` })),
    ].slice(0, 6)
  }
  // The same work the Delivery count holds: open complaints, orders with a brand note held for review,
  // then late orders measured against a promise.
  const [complaints, exceptions, late] = await Promise.all([listDelivery("complaints"), listDelivery("exceptions"), listDelivery("late")])
  return [
    ...complaints.items.map((i) => ({
      id: i.id,
      title: `Order ${i.reference}, ${i.brand.name}`,
      meta: `${i.customer.name}${i.city ? `, ${i.city}` : ""}`,
      badge: { text: i.complaintKind ? complaintKindLabels[i.complaintKind] : "Complaint", tone: "attention" as const },
      href: `/admin/delivery?tab=complaints&case=${encodeURIComponent(i.id)}`,
    })),
    ...exceptions.items
      .filter((i) => i.heldNotes > 0)
      .map((i) => ({
        id: `held-${i.orderId}`,
        title: `Order ${i.reference}, ${i.brand.name}`,
        meta: `${i.customer.name}${i.city ? `, ${i.city}` : ""}`,
        badge: { text: "Held note", tone: "attention" as const },
        href: `/admin/delivery?tab=exceptions&case=${encodeURIComponent(i.id)}`,
      })),
    ...late.items.map((i) => ({
      id: i.id,
      title: `Order ${i.reference}, ${i.brand.name}`,
      meta: `${i.customer.name}${i.city ? `, ${i.city}` : ""}`,
      badge: { text: i.daysLate ? `${i.daysLate} ${i.daysLate === 1 ? "day" : "days"} late` : "Late", tone: "attention" as const },
      href: `/admin/delivery?case=${encodeURIComponent(i.id)}`,
    })),
  ].slice(0, 6)
}

/** The server tabs this admin may see, their counts, and the rows of the active one. */
export function useServerQueues(active: string) {
  const admin = useServerSession((s) => s.admin)
  const sessionReady = useServerSession((s) => s.status !== "loading")
  const allowed = admin ? SERVER_QUEUE_TABS.filter((t) => canAdmin(admin.role, permission[t])) : []
  const counts = useApi(admin ? `${adminKeys.counts}:${admin.id}` : null, getQueueCounts, { refreshInterval: 60_000 })
  const tab = isServerQueueTab(active) && allowed.includes(active) ? active : null
  const list = useApi(tab && admin ? `admin:overview:${admin.id}:${tab}` : null, () => rowsFor(tab!), { refreshInterval: 60_000 })
  useQueueLive(() => {
    void counts.revalidate()
    void list.revalidate()
  })
  return {
    sessionReady,
    tabs: allowed.map((t) => ({ value: t, label: label[t], count: counts.data?.[t] })),
    rows: list.data,
    loading: !!tab && !list.data && !list.error,
    error: list.error,
    retry: () => void list.revalidate(),
  }
}

/** Sign-ins, sign-outs and development housekeeping aren't decisions: Security › Audit log keeps them. */
const notADecision = (action: string) => action === "admin.signed_in" || action === "admin.signed_out" || action.startsWith("dev.")

/** The latest server decisions for the Overview's trail (none without an audit.view session). */
export function useServerAuditTrail(): AuditEntryDto[] {
  const admin = useServerSession((s) => s.admin)
  const ok = !!admin && canAdmin(admin.role, "audit.view")
  const q = useApi(ok ? `admin:audit:trail:${admin!.id}` : null, () => listAudit({ limit: 60 }), { refreshInterval: 30_000 })
  useRealtimeEvent("moderation.counts", () => void q.revalidate())
  return (q.data?.items ?? []).filter((e) => !notADecision(e.action)).slice(0, 10)
}

/** The server queues' total for this admin (the Overview headline adds it to the legacy queues). */
export function useServerQueueTotal(): { total: number; ready: boolean } {
  const admin = useServerSession((s) => s.admin)
  const counts = useApi(admin ? `${adminKeys.counts}:${admin.id}` : null, getQueueCounts, { refreshInterval: 60_000 })
  useQueueLive(() => void counts.revalidate())
  const c = counts.data
  // Abuse alerts aren't an Overview tab; the headline counts what the Decision queue shows.
  return { total: c ? (c.messages ?? 0) + (c.content ?? 0) + (c.places ?? 0) + (c.charts ?? 0) + (c.delivery ?? 0) : 0, ready: !admin || !!c }
}
