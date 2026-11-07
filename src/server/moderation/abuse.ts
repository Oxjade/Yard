import "server-only"
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { db } from "../db"
import { abuseAlerts, abuseEvents, accountRestrictions, conversations, messages, reports, users } from "../db/schema"
import { conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { notify } from "../notify"
import { abuseAlertKindLabels, durationLabels, restrictionKindLabels, type AbuseAlertDto, type AbuseListDto, type AbuseRowDto, type RestrictionDto } from "@/lib/api/contracts/admin"
import { assertCan, assertState, audit, brandMap, brandRefOf, dateLabel, iso, publishCountsAfterCommit, userMap, type DecisionCtx } from "./shared"

/**
 * Users › Abuse (§5.2, §8.1): per-account signals over 7 days, open alerts and restrictions.
 * Nothing restricts automatically: an alert waits for an admin to confirm (a restriction) or
 * dismiss it (which ends the shadow hold).
 */

const WINDOW_DAYS = 7
const RATE_RULES = ["rate_limit", "daily_cap", "first_contact_cap", "stream_cap"]
type RestrictionRow = typeof accountRestrictions.$inferSelect
type AlertRow = typeof abuseAlerts.$inferSelect

export async function restrictionDtos(rows: RestrictionRow[]): Promise<RestrictionDto[]> {
  const people = await userMap(rows.flatMap((r) => [r.requestedBy, r.approvedBy]))
  return rows.map((r) => ({
    id: r.id,
    subjectKind: r.subjectKind as RestrictionDto["subjectKind"],
    subjectId: r.subjectId,
    kind: r.kind as RestrictionDto["kind"],
    status: r.status as RestrictionDto["status"],
    until: iso(r.until),
    reason: r.reason,
    requestedBy: { id: r.requestedBy, name: people.get(r.requestedBy)?.name ?? r.requestedBy },
    approvedBy: r.approvedBy ? { id: r.approvedBy, name: people.get(r.approvedBy)?.name ?? r.approvedBy } : null,
    createdAt: r.createdAt.toISOString(),
    liftedAt: iso(r.liftedAt),
  }))
}

/** A plain summary of an alert's evidence: counts and the marking brands, never message text. */
async function alertDtos(rows: AlertRow[]): Promise<AbuseAlertDto[]> {
  const ev = (a: AlertRow) => (a.evidence ?? {}) as Record<string, unknown>
  const brandIds = rows.flatMap((a) => {
    const b = ev(a).brandIds ?? ev(a).brands
    return Array.isArray(b) ? b.filter((x): x is string => typeof x === "string") : []
  })
  const brands = await brandMap(brandIds)
  return rows.map((a) => {
    const e = ev(a)
    const count = Number(e.independentMarks ?? e.marks ?? e.count ?? 0)
    const ids = (Array.isArray(e.brandIds) ? e.brandIds : Array.isArray(e.brands) ? e.brands : []).filter((x): x is string => typeof x === "string")
    const names = ids.map((id) => brandRefOf(brands, id).name)
    const summary =
      a.kind === "spam_marks"
        ? `${count || names.length} independent spam marks${names.length ? ` from ${names.join(", ")}` : ""}`
        : `${abuseAlertKindLabels[a.kind] ?? a.kind}${count ? `: ${count}` : ""}`
    return { id: a.id, subjectKind: a.subjectKind as AbuseAlertDto["subjectKind"], subjectId: a.subjectId, kind: a.kind as AbuseAlertDto["kind"], status: a.status as AbuseAlertDto["status"], summary, createdAt: a.createdAt.toISOString(), decidedAt: iso(a.decidedAt) }
  })
}

async function rowsFor(userIds: string[], since: Date): Promise<AbuseRowDto[]> {
  if (!userIds.length) return []
  const d = await db()
  const [people, hits, held, marks, filed, alerts, restrictions] = await Promise.all([
    d.select().from(users).where(inArray(users.id, userIds)),
    d
      .select({ id: abuseEvents.actorId, n: sql<number>`count(*)::int`, last: sql<Date>`max(${abuseEvents.createdAt})` })
      .from(abuseEvents)
      .where(and(inArray(abuseEvents.actorId, userIds), inArray(abuseEvents.rule, RATE_RULES), gte(abuseEvents.createdAt, since)))
      .groupBy(abuseEvents.actorId),
    d
      .select({ id: messages.senderUserId, n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(inArray(messages.senderUserId, userIds), eq(messages.status, "held"), eq(messages.senderSide, "customer")))
      .groupBy(messages.senderUserId),
    d
      .select({ id: conversations.customerId, n: sql<number>`count(distinct ${conversations.brandId})::int` })
      .from(conversations)
      .where(and(inArray(conversations.customerId, userIds), eq(conversations.spamState, "confirmed")))
      .groupBy(conversations.customerId),
    d
      .select({ id: reports.reporterId, n: sql<number>`count(*)::int`, dismissed: sql<number>`count(*) filter (where ${reports.status} = 'dismissed')::int` })
      .from(reports)
      .where(and(eq(reports.reporterKind, "shopper"), inArray(reports.reporterId, userIds)))
      .groupBy(reports.reporterId),
    d.select().from(abuseAlerts).where(and(eq(abuseAlerts.subjectKind, "user"), inArray(abuseAlerts.subjectId, userIds), eq(abuseAlerts.status, "open"))),
    d
      .select()
      .from(accountRestrictions)
      .where(and(eq(accountRestrictions.subjectKind, "user"), inArray(accountRestrictions.subjectId, userIds), inArray(accountRestrictions.status, ["active", "pending_approval"])))
      .orderBy(desc(accountRestrictions.createdAt)),
  ])
  const alertDto = await alertDtos(alerts)
  const restrictionDto = await restrictionDtos(restrictions)
  const by = <T extends { id: string | null }>(list: T[]) => new Map(list.map((x) => [x.id ?? "", x]))
  const hitMap = by(hits)
  const heldMap = by(held)
  const markMap = by(marks)
  const filedMap = by(filed)
  return people.map((u) => {
    const h = hitMap.get(u.id)
    return {
      user: { id: u.id, name: u.name, email: u.email, status: u.status as AbuseRowDto["user"]["status"], kind: u.kind, demo: u.demo },
      rateLimitHits: Number(h?.n ?? 0),
      heldMessages: Number(heldMap.get(u.id)?.n ?? 0),
      spamMarks: Number(markMap.get(u.id)?.n ?? 0),
      reportsFiled: Number(filedMap.get(u.id)?.n ?? 0),
      reportsDismissed: Number(filedMap.get(u.id)?.dismissed ?? 0),
      alerts: alertDto.filter((a) => a.subjectId === u.id),
      restrictions: restrictionDto.filter((r) => r.subjectId === u.id),
      lastSignalAt: h?.last ? new Date(h.last).toISOString() : null,
    }
  })
}

/** GET /api/admin/abuse: every shopper account with a signal in the window, alerts first. */
export async function listAbuse(): Promise<AbuseListDto> {
  const d = await db()
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const ids = new Set<string>()
  const add = (rows: { id: string | null }[]) => rows.forEach((r) => r.id && ids.add(r.id))
  add(await d.selectDistinct({ id: abuseEvents.actorId }).from(abuseEvents).where(and(eq(abuseEvents.actorKind, "shopper"), inArray(abuseEvents.rule, RATE_RULES), gte(abuseEvents.createdAt, since))))
  add(await d.selectDistinct({ id: messages.senderUserId }).from(messages).where(and(eq(messages.status, "held"), eq(messages.senderSide, "customer"))))
  add(await d.selectDistinct({ id: conversations.customerId }).from(conversations).where(eq(conversations.spamState, "confirmed")))
  add(await d.selectDistinct({ id: reports.reporterId }).from(reports).where(and(eq(reports.reporterKind, "shopper"), eq(reports.status, "dismissed"))))
  add(await d.selectDistinct({ id: abuseAlerts.subjectId }).from(abuseAlerts).where(and(eq(abuseAlerts.subjectKind, "user"), eq(abuseAlerts.status, "open"))))
  add(await d.selectDistinct({ id: accountRestrictions.subjectId }).from(accountRestrictions).where(and(eq(accountRestrictions.subjectKind, "user"), inArray(accountRestrictions.status, ["active", "pending_approval"]))))
  const rows = await rowsFor([...ids].slice(0, 300), since)
  const weight = (r: AbuseRowDto) => (r.alerts.length ? 0 : r.restrictions.length ? 1 : 2)
  rows.sort((a, b) => weight(a) - weight(b) || b.rateLimitHits + b.heldMessages * 3 + b.spamMarks * 5 - (a.rateLimitHits + a.heldMessages * 3 + a.spamMarks * 5) || a.user.name.localeCompare(b.user.name))
  return { items: rows, windowDays: WINDOW_DAYS, nextCursor: null }
}

export async function abuseRowFor(userId: string) {
  return (await rowsFor([userId], new Date(Date.now() - WINDOW_DAYS * 86_400_000)))[0] ?? null
}

export async function listRestrictions(subject?: string) {
  const d = await db()
  const rows = await d
    .select()
    .from(accountRestrictions)
    .where(subject ? eq(accountRestrictions.subjectId, subject) : inArray(accountRestrictions.status, ["active", "pending_approval"]))
    .orderBy(desc(accountRestrictions.createdAt))
    .limit(300)
  return { items: await restrictionDtos(rows) }
}

/* ── Decisions ─────────────────────────────────────────────────────── */

const HOURS = { "24h": 24, "7d": 168, "30d": 720 } as const
const whatPaused = { messaging: "Messaging", uploads: "Uploading", reports: "Reporting" } as const

/** add-restriction: messaging, uploads or reports for a set time. Confirms the alert it came from. */
export async function addRestriction(ctx: DecisionCtx, body: { id: string; subjectKind: "user" | "brand"; kind: "messaging" | "uploads" | "reports"; duration: "24h" | "7d" | "30d"; alertId?: string; reason: string }) {
  assertCan(ctx.actor, body.subjectKind === "brand" ? "brands.restrict" : "users.restrict")
  const d = await db()
  let subjectName: string
  if (body.subjectKind === "user") {
    const u = await d.query.users.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
    if (!u || u.kind === "admin") throw notFound()
    subjectName = u.name
  } else {
    const b = await brandMap([body.id])
    if (!b.has(body.id)) throw notFound()
    subjectName = brandRefOf(b, body.id).name
  }
  const [existing] = await d
    .select()
    .from(accountRestrictions)
    .where(and(eq(accountRestrictions.subjectKind, body.subjectKind), eq(accountRestrictions.subjectId, body.id), eq(accountRestrictions.kind, body.kind), eq(accountRestrictions.status, "active"), sql`(${accountRestrictions.until} is null or ${accountRestrictions.until} > now())`))
  assertState(!existing, `${whatPaused[body.kind]} is already paused for ${subjectName} — refreshed.`)
  let alert: AlertRow | undefined
  if (body.alertId) {
    alert = await d.query.abuseAlerts.findFirst({ where: (x, { eq }) => eq(x.id, body.alertId!) })
    if (!alert || alert.subjectId !== body.id || alert.subjectKind !== body.subjectKind) throw notFound("That alert isn't about this account.")
    assertState(alert.status === "open", "That alert has already been decided — refreshed.")
  }
  const until = new Date(Date.now() + HOURS[body.duration] * 3600_000)
  const [row] = await d
    .insert(accountRestrictions)
    .values({ id: newId("rs"), subjectKind: body.subjectKind, subjectId: body.id, kind: body.kind, until, reason: body.reason, status: "active", requestedBy: ctx.actor.userId, approvedBy: ctx.actor.userId })
    .returning()
  if (alert) await d.update(abuseAlerts).set({ status: "confirmed", decidedBy: ctx.actor.userId, decidedAt: new Date(), decisionReason: body.reason }).where(eq(abuseAlerts.id, alert.id))
  const entry = await audit(ctx, {
    action: "restriction.added",
    target: `${whatPaused[body.kind]} paused for ${subjectName}, ${durationLabels[body.duration]}`,
    subjectType: body.subjectKind,
    subjectId: body.id,
    brandId: body.subjectKind === "brand" ? body.id : null,
    reason: body.reason,
    meta: { restrictionId: row.id, kind: body.kind, until: until.toISOString(), alertId: alert?.id ?? null },
  })
  // The account hears what's paused, until when and why (§8.1: the reason is shared).
  const to = body.subjectKind === "user" ? ({ kind: "shopper", id: body.id } as const) : ({ kind: "brand", id: body.id } as const)
  await notify(to, { key: `restriction:${row.id}`, template: "account.restricted", vars: { what: `${whatPaused[body.kind]} until ${dateLabel(until)}`, reason: body.reason }, href: to.kind === "shopper" ? "/notifications" : "/studio/notifications" })
  publishCountsAfterCommit()
  return { item: (await restrictionDtos([row]))[0], audit: entry }
}

/** lift-restriction: messaging, uploads or reports (freezes and social pauses have their own decisions). */
export async function liftRestriction(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const r = await d.query.accountRestrictions.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!r) throw notFound()
  assertCan(ctx.actor, r.subjectKind === "brand" ? "brands.restrict" : "users.restrict")
  if (r.kind === "charts_freeze") throw rule("Lift a Charts freeze from Admin › Charts.")
  if (r.kind === "social_disabled") throw rule("Resume a brand's social feed from Admin › Content › Integrations.")
  assertState(r.status !== "lifted")
  const [row] = await d.update(accountRestrictions).set({ status: "lifted", liftedAt: new Date(), liftedBy: ctx.actor.userId }).where(and(eq(accountRestrictions.id, r.id), inArray(accountRestrictions.status, ["active", "pending_approval"]))).returning()
  assertState(!!row)
  const name = r.subjectKind === "user" ? ((await userMap([r.subjectId])).get(r.subjectId)?.name ?? r.subjectId) : brandRefOf(await brandMap([r.subjectId]), r.subjectId).name
  const entry = await audit(ctx, {
    action: "restriction.lifted",
    target: `${restrictionKindLabels[r.kind as keyof typeof restrictionKindLabels] ?? r.kind} for ${name}`,
    subjectType: r.subjectKind,
    subjectId: r.subjectId,
    brandId: r.subjectKind === "brand" ? r.subjectId : null,
    reason: body.reason,
    meta: { restrictionId: r.id, kind: r.kind },
  })
  publishCountsAfterCommit()
  return { item: (await restrictionDtos([row]))[0], audit: entry }
}

/** dismiss-abuse-alert: closes the alert and ends its shadow hold. Already-held messages stay held. */
export async function dismissAlert(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const a = await d.query.abuseAlerts.findFirst({ where: (x, { eq }) => eq(x.id, body.id) })
  if (!a) throw notFound()
  if (a.status !== "open") throw conflict("Someone already decided this — refreshed.")
  const [row] = await d.update(abuseAlerts).set({ status: "dismissed", decidedBy: ctx.actor.userId, decidedAt: new Date(), decisionReason: body.reason }).where(and(eq(abuseAlerts.id, a.id), eq(abuseAlerts.status, "open"))).returning()
  assertState(!!row)
  const name = a.subjectKind === "user" ? ((await userMap([a.subjectId])).get(a.subjectId)?.name ?? a.subjectId) : brandRefOf(await brandMap([a.subjectId]), a.subjectId).name
  const entry = await audit(ctx, {
    action: "abuse_alert.dismissed",
    target: `${abuseAlertKindLabels[a.kind] ?? a.kind} on ${name}`,
    subjectType: a.subjectKind,
    subjectId: a.subjectId,
    reason: body.reason,
    meta: { alertId: a.id, kind: a.kind },
  })
  publishCountsAfterCommit()
  return { item: (await alertDtos([row]))[0], audit: entry }
}
