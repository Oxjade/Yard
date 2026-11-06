import "server-only"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { AdminActor } from "../auth/dal"
import { writeAudit, type AuditInput } from "../audit"
import { afterCommit, db } from "../db"
import { brandMembers, brands, reports, users } from "../db/schema"
import { conflict, NotImplemented } from "../http/errors"
import { log } from "../log"
import { notify, type Recipient } from "../notify"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { canAdmin, needsRole, type AdminPermission } from "@/lib/permissions"
import { forbidden } from "../http/errors"
import { reportReasonLabels } from "@/lib/api/contracts/reports"
import type { BrandRef, ReportRef } from "@/lib/api/contracts/admin"

/** What every decision handler receives: the admin, checked by the route, and the request's IP hash. */
export type DecisionCtx = { actor: AdminActor; ipHash: string | null }

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
  const rows = await d
    .update(reports)
    .set({ status: "actioned", decidedBy: ctx.actor.userId, decidedAt: new Date(), decision: "actioned" })
    .where(and(inArray(reports.subjectType, types), eq(reports.subjectId, subjectId), inArray(reports.status, [...OPEN_REPORT]), opts.onlyId ? eq(reports.id, opts.onlyId) : undefined))
    .returning()
  for (const r of rows) await notifyReporter(r, opts.subjectLabel)
  return rows
}

/** The reporter's recipient: a shopper, or the brand a brand member reported for. */
export async function reporterRecipient(r: Pick<ReportRow, "reporterKind" | "reporterId" | "brandId">): Promise<Recipient | null> {
  if (r.reporterKind === "shopper") return { kind: "shopper", id: r.reporterId }
  if (r.reporterKind !== "brand") return null
  if (r.reporterId.startsWith("b_")) return { kind: "brand", id: r.reporterId }
  const d = await db()
  const memberships = await d.select({ brandId: brandMembers.brandId }).from(brandMembers).where(eq(brandMembers.userId, r.reporterId))
  const own = memberships.find((m) => m.brandId === r.brandId) ?? memberships[0]
  return own ? { kind: "brand", id: own.brandId } : null
}

export async function notifyReporter(r: ReportRow, subjectLabel: string) {
  const to = await reporterRecipient(r)
  if (!to) return
  await notify(to, { key: `report:${r.id}`, template: "report.decided", vars: { subject: subjectLabel }, href: to.kind === "shopper" ? "/notifications" : "/studio/notifications" })
}

/** After commit: every admin stream gets fresh queue counts (§4.2 moderation.counts). */
export function publishCountsAfterCommit() {
  afterCommit(async () => {
    const { allQueueCounts } = await import("./counts")
    const counts = await allQueueCounts()
    await publish(channels.admin, "moderation.counts", counts)
  })
}

/** 409 when a decision finds its subject already in the state it would set. */
export function assertState(ok: boolean, message = ALREADY_DECIDED) {
  if (!ok) throw conflict(message)
}

export function dateLabel(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
}
