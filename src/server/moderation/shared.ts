import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { AdminActor } from "../auth/dal"
import { writeAudit, type AuditInput } from "../audit"
import { afterCommit, db } from "../db"
import { brandMembers, brands, notifications, reports, users } from "../db/schema"
import { conflict, NotImplemented } from "../http/errors"
import { log } from "../log"
import { notify as sendNotification, type Recipient } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { canAdmin, needsRole, type AdminPermission } from "@/lib/permissions"
import { forbidden } from "../http/errors"
import { reportReasonLabels } from "@/lib/api/contracts/reports"
import type { BrandRef, ReportRef } from "@/lib/api/contracts/admin"

/**
 * What every decision handler receives: the admin, checked by the route, and the request's IP hash.
 * `kit`: development only, a request from one of M's kits (the X-Yard-Kit header). Audited views
 * then carry meta.kit, the only way the dev cleanup may remove a view row (they have no reason).
 */
export type DecisionCtx = { actor: AdminActor; ipHash: string | null; kit?: boolean }

/** Development only: the request carries M's kit header. Always false in production. */
export function kitRequest(req: Request) {
  return process.env.NODE_ENV !== "production" && req.headers.get("x-yard-kit") === "1"
}

/** The meta a kit's audited view adds (nothing outside development). */
export const kitMeta = (ctx: DecisionCtx) => (ctx.kit ? { kit: true } : {})

/**
 * Development only: the notification each decision is about to overwrite. notify() upserts by key and
 * refreshes created_at, so the dev cleanup can't tell a refreshed notification from a new one unless
 * the decision records what was there. runDecision opens a store; notify() below records the row
 * before it's overwritten (title, wording, time, read state), and runDecision saves the list to the
 * decision's audit meta (`priorNotes`). The cleanup puts those rows back instead of deleting them.
 * Never in production: audit rows there don't hold notification wording.
 */
export type PriorNote = { kind: Recipient["kind"]; id: string; key: string; was: null | { title: string; wording: string; category: string; href: string | null; createdAt: string; readAt: string | null } }
export const priorNotes = new AsyncLocalStorage<PriorNote[]>()

/** Records the row a notification with this key is about to overwrite (development, inside a decision). */
export async function recordPriorNote(to: Recipient, key: string) {
  const store = priorNotes.getStore()
  if (!store || store.some((n) => n.kind === to.kind && n.id === to.id && n.key === key)) return
  const d = await db()
  const [row] = await d
    .select()
    .from(notifications)
    .where(and(eq(notifications.recipientKind, to.kind), eq(notifications.recipientId, to.id), eq(notifications.eventKey, key)))
    .limit(1)
  store.push({
    kind: to.kind,
    id: to.id,
    key,
    was: row ? { title: row.title, wording: row.body, category: row.category, href: row.href, createdAt: row.createdAt.toISOString(), readAt: row.readAt ? row.readAt.toISOString() : null } : null,
  })
}

/** notify() for decisions: the same call, with the overwritten row recorded first in development. */
export async function notify(to: Recipient, n: Parameters<typeof sendNotification>[1]) {
  await recordPriorNote(to, n.key)
  return sendNotification(to, n)
}

export const ALREADY_DECIDED = "Someone already decided this — refreshed."

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/** 403 unless the admin's role holds `permission` (the dynamic checks: per subject, per outcome). */
export function assertCan(actor: AdminActor, permission: AdminPermission) {
  if (!canAdmin(actor.role, permission)) throw forbidden(`${needsRole(permission)}.`)
}

/** One audit row per decision (§8.2), written as the signed-in admin. */
export function audit(ctx: DecisionCtx, input: Omit<AuditInput, "actor" | "ipHash">) {
  return writeAudit({ ...input, actor: { kind: "admin", id: ctx.actor.userId, name: ctx.actor.name, role: ctx.actor.role }, ipHash: ctx.ipHash })
}

/**
 * Calls a feature contract (charts, around, inbox, social, shipping, media). In wave 2 the owning
 * cluster may not have replaced its stub yet: NotImplemented is logged once and the decision is
 * recorded without that side effect (§9.8). Anything else still throws and rolls back.
 */
export async function tryFeature<T>(label: string, fn: () => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    if (e instanceof NotImplemented) {
      log.once(`moderation-stub:${label}`, "warn", `[yard] moderation: ${label} isn't implemented yet, so decisions are recorded without it`)
      return { ok: false }
    }
    throw e
  }
}

/** Brand names, handles and statuses by id. */
export async function brandMap(ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter((x): x is string => !!x))]
  const out = new Map<string, { id: string; name: string; handle: string; reviewStatus: string; verified: boolean }>()
  if (!want.length) return out
  const d = await db()
  const rows = await d.select({ id: brands.id, name: brands.name, handle: brands.handle, reviewStatus: brands.reviewStatus, verified: brands.verified }).from(brands).where(inArray(brands.id, want))
  for (const r of rows) out.set(r.id, r)
  return out
}

export function brandRefOf(map: Awaited<ReturnType<typeof brandMap>>, id: string | null | undefined): BrandRef {
  const b = id ? map.get(id) : undefined
  return b ? { id: b.id, name: b.name, handle: b.handle } : { id: id ?? "", name: id ? "Unknown brand" : "No brand", handle: null }
}

/** User names by id. */
export async function userMap(ids: (string | null | undefined)[]) {
  const want = [...new Set(ids.filter((x): x is string => !!x))]
  const out = new Map<string, { id: string; name: string; email: string; status: string; kind: string; demo: boolean }>()
  if (!want.length) return out
  const d = await db()
  const rows = await d.select({ id: users.id, name: users.name, email: users.email, status: users.status, kind: users.kind, demo: users.demo }).from(users).where(inArray(users.id, want))
  for (const r of rows) out.set(r.id, r)
  return out
}

export const nameOf = (map: Map<string, { name: string }>, id: string | null | undefined, fallback = "Unknown") => (id ? (map.get(id)?.name ?? fallback) : fallback)

export const reasonLabel = (r: string) => reportReasonLabels[r]?.label ?? r.replace(/_/g, " ")

type ReportRow = typeof reports.$inferSelect

/** The name a report's reporter shows under (a brand reporter may be recorded as the member or the brand). */
export async function reporterNames(rows: Pick<ReportRow, "reporterKind" | "reporterId">[]) {
  const people = await userMap(rows.map((r) => r.reporterId))
  const bs = await brandMap(rows.filter((r) => r.reporterId.startsWith("b_")).map((r) => r.reporterId))
  return (r: Pick<ReportRow, "reporterKind" | "reporterId">) => {
    if (r.reporterKind === "system") return "Yard"
    return people.get(r.reporterId)?.name ?? bs.get(r.reporterId)?.name ?? r.reporterId
  }
}

export const OPEN_REPORT = ["open", "in_review", "escalated"] as const

/** The newest open report per subject, with how many others are open (for queue rows). */
export async function openReportsFor(subjectType: string | string[], subjectIds: string[]): Promise<Map<string, ReportRef>> {
  const out = new Map<string, ReportRef>()
  if (!subjectIds.length) return out
  const d = await db()
  const types = Array.isArray(subjectType) ? subjectType : [subjectType]
  const rows = await d
    .select()
    .from(reports)
    .where(and(inArray(reports.subjectType, types), inArray(reports.subjectId, subjectIds), inArray(reports.status, [...OPEN_REPORT])))
    .orderBy(sql`${reports.createdAt} desc`)
  const name = await reporterNames(rows)
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.subjectId, (counts.get(r.subjectId) ?? 0) + 1)
  for (const r of rows) if (!out.has(r.subjectId)) out.set(r.subjectId, toReportRef(r, name(r), (counts.get(r.subjectId) ?? 1) - 1))
  return out
}

/** Every report about each subject, open or closed, newest first (at most 20 each): the record's history. */
export async function reportIdsFor(subjectType: string, subjectIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!subjectIds.length) return out
  const d = await db()
  const rows = await d
    .select({ id: reports.id, subjectId: reports.subjectId })
    .from(reports)
    .where(and(eq(reports.subjectType, subjectType), inArray(reports.subjectId, subjectIds)))
    .orderBy(sql`${reports.createdAt} desc`)
  for (const r of rows) {
    const list = out.get(r.subjectId) ?? []
    if (list.length < 20) list.push(r.id)
    out.set(r.subjectId, list)
  }
  return out
}

export function toReportRef(r: ReportRow, reporterName: string, others = 0): ReportRef {
  return {
    id: r.id,
    reason: r.reason,
    reasonLabel: reasonLabel(r.reason),
    status: r.status as ReportRef["status"],
    reporter: { kind: r.reporterKind as ReportRef["reporter"]["kind"], id: r.reporterId, name: reporterName },
    createdAt: r.createdAt.toISOString(),
    others,
  }
}

/**
 * Closes the open reports on a subject as actioned (the decision that acted on them), and tells
 * each reporter it was reviewed, without the moderator's reason (§5.3).
 */
export async function actionReports(ctx: DecisionCtx, subjectType: string | string[], subjectId: string, opts: { onlyId?: string; subjectLabel: string }) {
  const d = await db()
  const types = Array.isArray(subjectType) ? subjectType : [subjectType]
  const where = and(inArray(reports.subjectType, types), eq(reports.subjectId, subjectId), inArray(reports.status, [...OPEN_REPORT]), opts.onlyId ? eq(reports.id, opts.onlyId) : undefined)
  // The status each report had, so the audit row records what the decision changed (meta.reportFrom).
  const before = new Map((await d.select({ id: reports.id, status: reports.status }).from(reports).where(where)).map((r) => [r.id, r.status]))
  const rows = await d.update(reports).set({ status: "actioned", decidedBy: ctx.actor.userId, decidedAt: new Date(), decision: "actioned" }).where(where).returning()
  for (const r of rows) await notifyReporter(r, opts.subjectLabel)
  return rows.map((r) => Object.assign(r, { fromStatus: before.get(r.id) ?? "open" }))
}

/** The audit meta for reports a decision actioned: their ids and the status each had before (dev-undo reads it). */
export function reportMeta(rows: { id: string; fromStatus: string }[]) {
  return { reportIds: rows.map((r) => r.id), reportFrom: Object.fromEntries(rows.map((r) => [r.id, r.fromStatus])) }
}

/**
 * The reporter's recipient: a shopper, or the brand a member reported FOR. F2 records a brand
 * reporter as the member (reporter_id = userId), so the brand comes from what the report proves:
 * - a snapshot that names the reporting brand (`snapshot.reporter.brandId`, when F2 records it);
 * - a message or conversation report: only a party can file it, so it is the conversation's brand
 *   (report.brand_id), provided the member still belongs to it;
 * - otherwise, a member of exactly one brand (the only brand they could act as).
 * A member of several brands reporting a post or a place gets no note rather than one sent to a
 * brand they may not have been acting for.
 */
export async function reporterRecipient(r: Pick<ReportRow, "reporterKind" | "reporterId" | "brandId" | "subjectType" | "snapshot">): Promise<Recipient | null> {
  if (r.reporterKind === "shopper") return { kind: "shopper", id: r.reporterId }
  if (r.reporterKind !== "brand") return null
  if (r.reporterId.startsWith("b_")) return { kind: "brand", id: r.reporterId }
  const d = await db()
  const memberships = (await d.select({ brandId: brandMembers.brandId, status: brandMembers.status }).from(brandMembers).where(eq(brandMembers.userId, r.reporterId))).filter((m) => m.status === "active")
  const recorded = (r.snapshot as { reporter?: { brandId?: unknown } } | null)?.reporter?.brandId
  const acting = typeof recorded === "string" ? recorded : r.subjectType === "message" || r.subjectType === "conversation" ? r.brandId : null
  if (acting) return memberships.some((m) => m.brandId === acting) ? { kind: "brand", id: acting } : null
  return memberships.length === 1 ? { kind: "brand", id: memberships[0].brandId } : null
}

export async function notifyReporter(r: ReportRow, subjectLabel: string) {
  const to = await reporterRecipient(r)
  if (!to) return
  await notify(to, { key: `report:${r.id}`, template: "report.decided", vars: { subject: subjectLabel }, href: to.kind === "shopper" ? "/notifications" : "/studio/notifications" })
}

/**
 * After commit: tells every admin stream that the queues changed (§4.2 moderation.counts). The
 * shared `admin` channel reaches every role, so the event carries no counts: each client refetches
 * GET /api/admin/queues/counts, which returns only the queues its role may view (§8.2).
 */
export function publishCountsAfterCommit() {
  afterCommit(async () => {
    await publish(channels.admin, "moderation.counts", {})
  })
}

/** 409 when a decision finds its subject already in the state it would set. */
export function assertState(ok: boolean, message = ALREADY_DECIDED) {
  if (!ok) throw conflict(message)
}

export function dateLabel(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}
