import "server-only"
import { and, count, eq, gte, inArray } from "drizzle-orm"
import { REPORT_REASONS, reportReasonLabels, type ReportSubject } from "@/lib/api/contracts/reports"
import type { AdminPermission } from "@/lib/permissions"
import { activeRestriction, type Actor } from "../auth/dal"
import { db, withTx } from "../db"
import { reports } from "../db/schema"
import { badRequest, conflict, forbidden, rateLimited, restricted } from "../http/errors"
import { newId } from "../ids"
import { notifyAdmins } from "../notify"
import type { TemplateKey } from "../notify-templates"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { freezeSubject } from "./snapshot"

/**
 * POST /api/reports?as=shopper|brand (§5.3). Validates that the subject exists and that the
 * reporter can see it (404 otherwise), freezes bounded evidence, inserts the report (one open
 * report per reporter and subject: 409 on a repeat) and notifies only the admins whose role holds
 * that queue's view permission. The notification names the reason and the subject type, never
 * the reported text or the reporter's details (§2.7).
 * At most DAILY_REPORTS reports a day per reporter, counted from the reports actually filed, so a
 * refused attempt (404, 409) never uses up the day; attempts are limited to 5 a minute by the route.
 */
export const DAILY_REPORTS = 10
export type ReportInput = { subjectType: ReportSubject; subjectId: string; reason: string; details?: string }

const queue: Record<ReportSubject, { permission: AdminPermission; template: TemplateKey; href: (id: string) => string }> = {
  message: { permission: "messages.view_reports", template: "report.admin_new", href: (id) => `/admin/messages?report=${id}` },
  conversation: { permission: "messages.view_reports", template: "report.admin_new", href: (id) => `/admin/messages?report=${id}` },
  social_post: { permission: "content.moderate", template: "report.admin_new_post", href: (id) => `/admin/content?report=${id}` },
  location: { permission: "places.moderate", template: "report.admin_new_place", href: (id) => `/admin/content?tab=places&report=${id}` },
  location_event: { permission: "places.moderate", template: "report.admin_new_place", href: (id) => `/admin/content?tab=places&report=${id}` },
}

/** Reasons that put a report at the top of the queue. */
const HIGH = new Set(["scam_or_offplatform_payment", "harassment", "hate", "sexual_content", "unsafe"])

const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: unknown } | null
  return !!err && (err.code === "23505" || isUniqueViolation(err.cause))
}

const alreadyReported = () => conflict("You've already reported this. Yard's trust and safety team is reviewing it.")

export async function createReport(actor: Actor, input: ReportInput): Promise<{ id: string; status: string; createdAt: string }> {
  if (actor.kind === "admin") throw forbidden("Admins act on reports in the Control Center.")
  if (!(REPORT_REASONS[input.subjectType] as readonly string[]).includes(input.reason)) throw badRequest({ reason: "Choose one of the reasons." })
  const r = (await activeRestriction("user", actor.userId, "reports")) ?? (actor.kind === "brand" ? await activeRestriction("brand", actor.brandId, "reports") : null)
  if (r) throw restricted("Reporting is paused on your account.")

  const frozen = await freezeSubject(actor, input.subjectType, input.subjectId)
  const reporterKind = actor.kind
  const d = await db()
  const open = await d
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.reporterKind, reporterKind), eq(reports.reporterId, actor.userId), eq(reports.subjectType, input.subjectType), eq(reports.subjectId, input.subjectId), inArray(reports.status, ["open", "in_review"])))
    .limit(1)
  if (open.length) throw alreadyReported()

  const q = queue[input.subjectType]
  const id = newId("rp")
  try {
    return await withTx(async () => {
      const tx = await db()
      const now = new Date()
      const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      const [filed] = await tx
        .select({ n: count() })
        .from(reports)
        .where(and(eq(reports.reporterKind, reporterKind), eq(reports.reporterId, actor.userId), gte(reports.createdAt, dayStart)))
      if ((filed?.n ?? 0) >= DAILY_REPORTS) throw rateLimited(Math.max(1, Math.ceil((dayStart.getTime() + 86_400_000 - now.getTime()) / 1000)), "You've reached today's limit for reports. Try again tomorrow.")
      const [row] = await tx
        .insert(reports)
        .values({
          id,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          brandId: frozen.brandId,
          reporterKind,
          reporterId: actor.userId,
          reason: input.reason,
          details: input.details?.trim() ? input.details.trim().slice(0, 1000) : null,
          snapshot: frozen.snapshot,
          priority: HIGH.has(input.reason) ? 1 : 2,
        })
        .returning()
      const label = reportReasonLabels[input.reason]?.label ?? "Something else"
      await notifyAdmins(q.permission, {
        key: `report:${row.id}`,
        template: q.template,
        vars: { reason: label.charAt(0).toLowerCase() + label.slice(1), subject: input.subjectType, brand: frozen.brandName ?? undefined },
        href: q.href(row.id),
      })
      // An empty signal, sent once the report commits: each admin refetches the queue counts their
      // role may see, so the sidebar badges move for roles this notification doesn't reach (M2).
      await publish(channels.admin, "moderation.counts", {})
      return { id: row.id, status: row.status, createdAt: row.createdAt.toISOString() }
    })
  } catch (e) {
    if (isUniqueViolation(e)) throw alreadyReported()
    throw e
  }
}
