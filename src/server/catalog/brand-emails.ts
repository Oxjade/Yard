import "server-only"
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm"
import type { BrandEmailContextDto, BrandEmailHistoryItemDto, BrandEmailPreviewDto, BrandEmailSendBody, BrandEmailSendResult, StudioEmailSettingsDto } from "@/lib/api/contracts/brand-emails"
import { BRAND_EMAIL_DAILY_PER_BRAND, brandEmailHistoryLabels } from "@/lib/brand-emails"
import { writeAudit } from "../audit"
import type { AdminActor, BrandActor } from "../auth/dal"
import { db, withTx, type Executor } from "../db"
import { auditLog, brands } from "../db/schema"
import { enqueueEmail } from "../email"
import { renderEmail } from "../email/templates"
import { forbidden, notFound, rule } from "../http/errors"
import { brandLeads } from "../orders/brand-email"
import { refuseSampleBrand } from "./sample-guard"

/**
 * Brand emails from Yard, the admin side (Admin › Brands › Email the brand, brands.email) and the
 * brand's own reminder setting (Studio › Settings › Emails from Yard). The copy lives in
 * src/lib/brand-emails.ts; sending goes through the email outbox (sent after commit, retried,
 * suppressed on bounce); every send is audited, and the audit rows are the sent history.
 */

const HISTORY_ACTIONS = Object.keys(brandEmailHistoryLabels)
const DAY_MS = 24 * 3600_000

async function brandRow(ex: Executor, brandId: string) {
  refuseSampleBrand(brandId)
  const [b] = await ex
    .select({ id: brands.id, name: brands.name, handle: brands.handle, founding: brands.founding, claimStatus: brands.claimStatus, nudges: brands.nudgeEmails })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1)
  if (!b) throw notFound("That brand doesn't exist.")
  return b
}

/** The last 12 emails Yard sent this brand: one-tap emails, reminders and decision emails that went to someone. */
async function history(ex: Executor, brandId: string): Promise<BrandEmailHistoryItemDto[]> {
  const rows = await ex
    .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, actorKind: auditLog.actorKind, actorName: auditLog.actorName, meta: auditLog.meta })
    .from(auditLog)
    .where(and(eq(auditLog.brandId, brandId), inArray(auditLog.action, HISTORY_ACTIONS), sql`coalesce((${auditLog.meta}->>'emailed')::int, 0) > 0`))
    .orderBy(desc(auditLog.at))
    .limit(12)
  return rows.map((r) => {
    const m = (r.meta ?? {}) as Record<string, unknown>
    return {
      id: r.id,
      at: r.at.toISOString(),
      action: r.action,
      label: brandEmailHistoryLabels[r.action] ?? r.action,
      subject: typeof m.subject === "string" ? m.subject : null,
      preset: typeof m.preset === "string" ? m.preset : null,
      by: r.actorKind === "system" ? null : (r.actorName ?? "Yard"),
      emailed: Number(m.emailed) || 0,
    }
  })
}

/** One-tap emails to this brand in the last 24 hours (rolling), and when the oldest of them leaves the window. */
async function sentToday(ex: Executor, brandId: string) {
  const [row] = await ex
    .select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${auditLog.at})` })
    .from(auditLog)
    .where(and(eq(auditLog.brandId, brandId), eq(auditLog.action, "brand_email.sent"), gt(auditLog.at, new Date(Date.now() - DAY_MS))))
  const n = Number(row?.n) || 0
  return { n, nextSendAt: n >= BRAND_EMAIL_DAILY_PER_BRAND && row?.oldest ? new Date(new Date(row.oldest).getTime() + DAY_MS) : null }
}

/** "Mon 11:04 PM UTC": when a capped brand can be emailed again (the server's own clock and zone). */
const whenUtc = (d: Date) => `${d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`

async function context(ex: Executor, brandId: string): Promise<BrandEmailContextDto> {
  const b = await brandRow(ex, brandId)
  const leads = await brandLeads(ex, brandId)
  const sent = await sentToday(ex, brandId)
  return {
    brand: { id: b.id, name: b.name, handle: b.handle, founding: b.founding, claimStatus: b.claimStatus },
    recipients: leads.map((l) => ({ name: l.name, email: l.email, role: l.role })),
    history: await history(ex, brandId),
    sentToday: sent.n,
    dailyLimit: BRAND_EMAIL_DAILY_PER_BRAND,
    nextSendAt: sent.nextSendAt?.toISOString() ?? null,
    nudges: b.nudges,
  }
}

/** GET /api/admin/brand-emails/{brandId}: who'd get an email, what was sent lately, and today's count. */
export async function brandEmailContext(brandId: string): Promise<BrandEmailContextDto> {
  return context(await db(), brandId)
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ""

/** POST …/preview: the email exactly as the brand would get it (nothing is sent or recorded). */
export async function previewBrandEmail(actor: AdminActor, brandId: string, body: Omit<BrandEmailSendBody, "idempotencyKey">): Promise<BrandEmailPreviewDto> {
  const b = await brandRow(await db(), brandId)
  const r = renderEmail("brand_message", { brand: b.name, preset: body.preset, subject: body.subject, body: body.body, signoff: firstName(actor.name) })
  return { subject: r.subject, html: r.html, text: r.text }
}

/**
 * POST /api/admin/brand-emails/{brandId}: one admin email to the brand's owners and admins.
 * Idempotent per idempotencyKey (a retry sends nothing new); at most BRAND_EMAIL_DAILY_PER_BRAND in any
 * 24 hours (rolling) per brand across every admin; audited with the preset and subject (never the body).
 */
export async function sendBrandEmail(actor: AdminActor, brandId: string, body: BrandEmailSendBody, ipHash: string | null = null): Promise<BrandEmailSendResult> {
  return withTx(async (tx) => {
    const b = await brandRow(tx, brandId)
    // Serialises sends to one brand, so two admins can't both take the last slot of the day.
    await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).for("update")
    const [prior] = await tx
      .select({ id: auditLog.id, meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.brandId, brandId), eq(auditLog.action, "brand_email.sent"), sql`${auditLog.meta}->>'requestKey' = ${body.idempotencyKey}`))
      .limit(1)
    if (prior) return { ...(await context(tx, brandId)), emailed: Number((prior.meta as Record<string, unknown>).emailed) || 0, created: false }

    const leads = await brandLeads(tx, brandId)
    if (!leads.length) {
      throw rule(b.claimStatus === "unclaimed" ? `${b.name} has no owner yet, so there's no one to email. Send the claim link first.` : `${b.name} has no active owner or admin with an email address.`)
    }
    const sent = await sentToday(tx, brandId)
    if (sent.n >= BRAND_EMAIL_DAILY_PER_BRAND) {
      throw rule(`${b.name} already got ${BRAND_EMAIL_DAILY_PER_BRAND} emails from Yard in the last 24 hours. Give them some breathing room${sent.nextSendAt ? `: you can send again ${whenUtc(sent.nextSendAt)}` : ""}.`)
    }

    const vars = { brand: b.name, preset: body.preset, subject: body.subject, body: body.body, signoff: firstName(actor.name) }
    // Render once here so a problem is a clear error, not a failed outbox row.
    renderEmail("brand_message", vars)
    for (const l of leads) await enqueueEmail(tx, { template: "brand_message", to: l.email, vars, dedupeKey: `brand_message:${brandId}:${body.idempotencyKey}:${l.email.toLowerCase()}`.slice(0, 200) })
    await writeAudit({
      actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
      action: "brand_email.sent",
      target: b.name,
      subjectType: "brand",
      subjectId: brandId,
      brandId,
      reason: body.subject,
      ipHash,
      meta: { template: "brand_message", preset: body.preset, subject: body.subject, emailed: leads.length, requestKey: body.idempotencyKey },
    })
    return { ...(await context(tx, brandId)), emailed: leads.length, created: true }
  })
}

/* ---------- Studio: the brand's own reminder setting ---------- */

const mayEdit = (actor: BrandActor) => actor.role === "owner" || actor.role === "admin"

export async function studioEmailSettings(actor: BrandActor): Promise<StudioEmailSettingsDto> {
  const [b] = await (await db()).select({ nudges: brands.nudgeEmails }).from(brands).where(eq(brands.id, actor.brandId)).limit(1)
  if (!b) throw notFound("That brand doesn't exist.")
  return { nudges: b.nudges, canEdit: mayEdit(actor) }
}

/** PUT /api/studio/settings/emails { nudges }: owners and admins switch reminder emails on or off. Audited. */
export async function updateStudioEmailSettings(actor: BrandActor, input: { nudges: boolean }, ipHash: string | null = null): Promise<StudioEmailSettingsDto> {
  if (!mayEdit(actor)) throw forbidden("Only the brand's owners and admins can change emails from Yard.")
  return withTx(async (tx) => {
    const [before] = await tx.select({ nudges: brands.nudgeEmails, name: brands.name }).from(brands).where(eq(brands.id, actor.brandId)).for("update").limit(1)
    if (!before) throw notFound("That brand doesn't exist.")
    if (before.nudges !== input.nudges) {
      await tx.update(brands).set({ nudgeEmails: input.nudges }).where(eq(brands.id, actor.brandId))
      await writeAudit({ actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role }, action: input.nudges ? "brand_email.reminders_on" : "brand_email.reminders_off", target: before.name, subjectType: "brand", subjectId: actor.brandId, brandId: actor.brandId, ipHash })
    }
    return { nudges: input.nudges, canEdit: true }
  })
}
