import "server-only"
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, or, sql } from "drizzle-orm"
import type { NewsletterAudienceDto, NewsletterBrandDto, NewsletterCountsDto, NewsletterDetailDto, NewsletterListDto, NewsletterPatchBody, NewsletterPreviewDto, NewsletterRecipientsDto, NewsletterSendBody, NewsletterSummaryDto } from "@/lib/api/contracts/newsletter"
import type { NewsletterFields } from "@/lib/api/contracts/newsletter"
import { countries } from "@/config/markets"
import { NEWSLETTER_MAX_LEAD_MS, NEWSLETTER_MIN_LEAD_MS, NEWSLETTER_OUTBOX_HIGH_WATER, NEWSLETTER_PER_MINUTE, newsletterAudienceMeta, newsletterProblems, type NewsletterAudience, type NewsletterKind, type NewsletterStatus } from "@/lib/newsletter"
import { NEWSLETTER_STATUSES } from "@/lib/api/contracts/enums"
import { writeAudit, type AuditActor } from "../audit"
import type { AdminActor } from "../auth/dal"
import { afterCommit, db, withTx, type Executor, type Tx } from "../db"
import { brands, mediaAssets, shopperFollows, users } from "../db/schema"
import { emailOutbox } from "../db/schema/engagement"
import { newsletterCampaigns, newsletterRecipients } from "../db/schema/newsletter"
import { enqueueEmail } from "../email"
import { renderEmail } from "../email/templates"
import { getEnv } from "../env"
import { badRequest, conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { mediaSrc } from "../media/dto"
import { refreshVisibility } from "../media/visibility"
import { yard } from "../state"
import { countAudience, freezeAudience, type Exec } from "./audience"
import { campaignCounts, feedCampaign, reconcileCampaign } from "./batch"
import { campaignEmailVars, forgetCampaign, type CampaignRow } from "./content"

/**
 * Admin › Newsletter (docs/NEWSLETTER.md). Drafts are autosaved; Send schedules a campaign (now
 * or later); the job `newsletter.run` (every minute) starts due campaigns by freezing their
 * audience, then hands the email outbox at most YARD_NEWSLETTER_PER_MINUTE recipients a minute
 * (default 100) while fewer than NEWSLETTER_OUTBOX_HIGH_WATER campaign emails wait there. The
 * outbox sends them with its own retries, suppression checks and pacing; the job copies each
 * outcome back onto the recipient. Every state change is audited (never the body).
 */
export const IMPL: string = "NEWSLETTER-v1-2026-11-15"

type Row = CampaignRow
const PREFIX = (id: string) => `newsletter:${id}:%`

const opts = () => ({ includeDemo: getEnv().seedDemo })
const perMinute = () => Math.max(1, Math.min(2000, Number(process.env.YARD_NEWSLETTER_PER_MINUTE) || NEWSLETTER_PER_MINUTE))
const templateOf = (kind: string) => (kind === "service" ? "service_notice" : "newsletter")
const iso = (d: Date | null) => (d ? d.toISOString() : null)
const auditActor = (a: AdminActor): AuditActor => ({ kind: "admin", id: a.userId, name: a.name, role: a.role })

export function audienceOf(r: Pick<Row, "audience" | "audienceBrandId" | "audienceCountry">): NewsletterAudience {
  if (r.audience === "followers") return { type: "followers", brandId: r.audienceBrandId ?? "" }
  if (r.audience === "country") return { type: "country", country: r.audienceCountry ?? "" }
  return { type: r.audience === "brands" ? "brands" : "shoppers" }
}

const content = (r: Row) => ({ kind: r.kind as NewsletterKind, subject: r.subject, preheader: r.preheader, heading: r.heading, body: r.body, heroMediaId: r.heroMediaId, heroAlt: r.heroAlt, buttonLabel: r.buttonLabel, buttonUrl: r.buttonUrl, audience: audienceOf(r) })

async function load(ex: Executor, id: string, lock = false): Promise<Row> {
  if (!/^nlc_[\w-]{1,64}$/.test(id)) throw notFound("That campaign doesn't exist.")
  const q = ex.select().from(newsletterCampaigns).where(eq(newsletterCampaigns.id, id)).limit(1)
  const [r] = lock ? await q.for("update") : await q
  if (!r) throw notFound("That campaign doesn't exist.")
  return r
}

const brandNames = async (ex: Executor, ids: string[]) => {
  const out = new Map<string, string>()
  const want = [...new Set(ids.filter(Boolean))]
  if (!want.length) return out
  for (const b of await ex.select({ id: brands.id, name: brands.name }).from(brands).where(inArray(brands.id, want))) out.set(b.id, b.name)
  return out
}

function audienceDto(r: Row, names: Map<string, string>): NewsletterAudienceDto {
  const a = audienceOf(r)
  const brandName = a.type === "followers" ? (names.get(a.brandId) ?? null) : null
  const country = a.type === "country" ? a.country : null
  const label =
    a.type === "followers" ? (brandName ? `Followers of ${brandName}` : newsletterAudienceMeta.followers.label) : a.type === "country" ? (country ? `Shoppers in ${countries[country as keyof typeof countries]?.name ?? country}` : newsletterAudienceMeta.country.label) : newsletterAudienceMeta[a.type].label
  return { type: a.type, label, brandId: a.type === "followers" ? a.brandId || null : null, brandName, country }
}

const toCounts = (total: number, c: Record<string, number>): NewsletterCountsDto => ({
  total,
  pending: c.pending ?? 0,
  queued: c.queued ?? 0,
  sent: c.sent ?? 0,
  failed: c.failed ?? 0,
  suppressed: c.suppressed ?? 0,
  stub: c.stub ?? 0,
  cancelled: c.cancelled ?? 0,
  unsubscribed: c.unsubscribed ?? 0,
})

function summaryOf(r: Row, names: Map<string, string>, counts: Record<string, number>): NewsletterSummaryDto {
  return {
    id: r.id,
    name: r.name,
    subject: r.subject,
    kind: r.kind as NewsletterKind,
    status: r.status as NewsletterStatus,
    audience: audienceDto(r, names),
    scheduledFor: iso(r.scheduledFor),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    cancelledAt: iso(r.cancelledAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedByName ?? r.createdByName ?? null,
    sentBy: r.sentByName ?? null,
    counts: toCounts(r.recipientsTotal, counts),
  }
}

async function detailOf(ex: Executor, r: Row): Promise<NewsletterDetailDto> {
  const names = await brandNames(ex, [r.audienceBrandId ?? ""])
  const counts = await campaignCounts(ex as unknown as Exec, r.id)
  const [o] = await ex.select({ n: sql<number>`count(*)::int` }).from(emailOutbox).where(sql`${emailOutbox.dedupeKey} like ${PREFIX(r.id)}`)
  let hero: NewsletterDetailDto["hero"] = null
  if (r.heroMediaId) {
    const [m] = await ex.select({ id: mediaAssets.id, visibility: mediaAssets.visibility }).from(mediaAssets).where(eq(mediaAssets.id, r.heroMediaId)).limit(1)
    if (m) hero = { mediaId: m.id, src: m.visibility === "public" ? mediaSrc(m.id) : mediaSrc(m.id, "admin") }
  }
  return {
    ...summaryOf(r, names, counts),
    revision: r.revision,
    preheader: r.preheader,
    heading: r.heading,
    body: r.body,
    greet: r.greet,
    hero,
    heroAlt: r.heroAlt,
    buttonLabel: r.buttonLabel,
    buttonUrl: r.buttonUrl,
    problems: r.status === "draft" ? newsletterProblems(content(r), getEnv().publicOrigin) : {},
    outboxRows: Number(o?.n) || 0,
  }
}

/* ---------- Reads ---------- */

/** GET /api/admin/newsletters: the newest 200 campaigns with their counts, and how many there are by status. */
export async function listCampaigns(): Promise<NewsletterListDto> {
  const d = await db()
  const rows = await d.select().from(newsletterCampaigns).orderBy(desc(newsletterCampaigns.updatedAt)).limit(200)
  const names = await brandNames(d, rows.map((r) => r.audienceBrandId ?? ""))
  const byCampaign = new Map<string, Record<string, number>>()
  if (rows.length) {
    const stats = await d
      .select({ id: newsletterRecipients.campaignId, status: newsletterRecipients.status, n: sql<number>`count(*)::int`, unsub: sql<number>`count(${newsletterRecipients.unsubscribedAt})::int` })
      .from(newsletterRecipients)
      .where(inArray(newsletterRecipients.campaignId, rows.map((r) => r.id)))
      .groupBy(newsletterRecipients.campaignId, newsletterRecipients.status)
    for (const s of stats) {
      const c = byCampaign.get(s.id) ?? { unsubscribed: 0 }
      c[s.status] = Number(s.n)
      c.unsubscribed = (c.unsubscribed ?? 0) + Number(s.unsub)
      byCampaign.set(s.id, c)
    }
  }
  const all = await d.select({ status: newsletterCampaigns.status, n: sql<number>`count(*)::int` }).from(newsletterCampaigns).groupBy(newsletterCampaigns.status)
  const counts = Object.fromEntries(NEWSLETTER_STATUSES.map((s) => [s, 0])) as Record<NewsletterStatus, number>
  for (const a of all) counts[a.status as NewsletterStatus] = Number(a.n)
  return { items: rows.map((r) => summaryOf(r, names, byCampaign.get(r.id) ?? {})), counts }
}

export async function getCampaign(id: string): Promise<{ campaign: NewsletterDetailDto }> {
  const d = await db()
  return { campaign: await detailOf(d, await load(d, id)) }
}

/** GET …/{id}/recipients: per-recipient status, 50 at a time. */
export async function campaignRecipients(id: string, q: { status: string; offset: number }): Promise<NewsletterRecipientsDto> {
  const d = await db()
  await load(d, id)
  const where = [eq(newsletterRecipients.campaignId, id)]
  if (q.status === "unsubscribed") where.push(isNotNull(newsletterRecipients.unsubscribedAt))
  else if (q.status !== "all") where.push(eq(newsletterRecipients.status, q.status))
  const rows = await d
    .select()
    .from(newsletterRecipients)
    .where(and(...where))
    .orderBy(asc(newsletterRecipients.email))
    .limit(51)
    .offset(q.offset)
  return {
    items: rows.slice(0, 50).map((r) => ({ userId: r.userId, name: r.name, email: r.email, status: r.status as never, unsubscribed: !!r.unsubscribedAt, sentAt: iso(r.sentAt), lastError: r.lastError })),
    nextOffset: rows.length > 50 ? q.offset + 50 : null,
  }
}

/** GET /api/admin/newsletters/audience: how many people a campaign of this kind would reach right now. */
export async function audienceCount(q: { kind: NewsletterKind; type: NewsletterAudience["type"]; brandId?: string; country?: string }): Promise<{ count: number }> {
  const a: NewsletterAudience = q.type === "followers" ? { type: "followers", brandId: q.brandId ?? "" } : q.type === "country" ? { type: "country", country: q.country ?? "" } : { type: q.type }
  if ((a.type === "followers" && !a.brandId) || (a.type === "country" && !a.country)) return { count: 0 }
  return { count: await countAudience((await db()) as unknown as Exec, a, q.kind, opts()) }
}

/** GET /api/admin/newsletters/brands?q=: brands to pick for "Followers of a brand", with their follower counts. */
export async function searchBrands(q: string): Promise<{ brands: NewsletterBrandDto[] }> {
  const d = await db()
  const term = q.trim().replace(/[%_\\]/g, "")
  const rows = await d
    .select({ id: brands.id, name: brands.name, handle: brands.handle, followers: sql<number>`(select count(*)::int from ${shopperFollows} f where f.brand_id = ${brands.id})` })
    .from(brands)
    .where(term ? or(ilike(brands.name, `%${term}%`), ilike(brands.handle, `%${term}%`)) : undefined)
    .orderBy(desc(sql`(select count(*) from ${shopperFollows} f where f.brand_id = ${brands.id})`), asc(brands.name))
    .limit(20)
  return { brands: rows.map((r) => ({ ...r, followers: Number(r.followers) || 0 })) }
}

/* ---------- Drafts ---------- */

export async function createCampaign(actor: AdminActor, input: { kind?: NewsletterKind }): Promise<{ campaign: NewsletterDetailDto }> {
  return withTx(async (tx) => {
    const id = newId("nlc")
    const [row] = await tx
      .insert(newsletterCampaigns)
      .values({ id, kind: input.kind ?? "marketing", createdBy: actor.userId, createdByName: actor.name, updatedBy: actor.userId, updatedByName: actor.name })
      .returning()
    await writeAudit({ actor: auditActor(actor), action: "newsletter.created", target: "New campaign", subjectType: "newsletter", subjectId: id, meta: { kind: row.kind } })
    return { campaign: await detailOf(tx, row) }
  })
}

/** PATCH …/{id}: autosave. Drafts only; a stale revision (another tab saved since) is refused. */
export async function updateCampaign(actor: AdminActor, id: string, patch: NewsletterPatchBody): Promise<{ campaign: NewsletterDetailDto }> {
  return withTx(async (tx) => {
    const r = await load(tx, id, true)
    if (r.status !== "draft") throw conflict(r.status === "scheduled" ? "This campaign is scheduled. Cancel the schedule to edit it." : "This campaign has already gone out, so it can't be edited.")
    if (patch.revision !== r.revision) throw conflict("This draft was changed in another tab or by another admin. Reload to see the latest version.")
    const { revision: _rev, ...fields } = patch
    void _rev
    const set: Partial<typeof newsletterCampaigns.$inferInsert> = {}
    for (const [k, v] of Object.entries(fields) as [keyof NewsletterFields, unknown][]) if (v !== undefined) (set as Record<string, unknown>)[k] = typeof v === "string" && k !== "body" ? v.trim() : v
    if (fields.heroMediaId) {
      const [m] = await tx.select({ id: mediaAssets.id, purpose: mediaAssets.purpose, moderation: mediaAssets.moderationStatus }).from(mediaAssets).where(eq(mediaAssets.id, fields.heroMediaId)).limit(1)
      if (!m || m.purpose !== "newsletter_image" || m.moderation === "removed") throw badRequest({ heroMediaId: "Upload the image again: that one can't be used." })
    }
    if (fields.audienceBrandId) {
      const [b] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, fields.audienceBrandId)).limit(1)
      if (!b) throw badRequest({ audience: "That brand doesn't exist." })
    }
    const [row] = await tx
      .update(newsletterCampaigns)
      .set({ ...set, revision: r.revision + 1, updatedAt: new Date(), updatedBy: actor.userId, updatedByName: actor.name })
      .where(eq(newsletterCampaigns.id, id))
      .returning()
    if (fields.heroMediaId !== undefined && fields.heroMediaId !== r.heroMediaId) await refreshVisibility([r.heroMediaId, fields.heroMediaId].filter((x): x is string => !!x))
    return { campaign: await detailOf(tx, row) }
  })
}

export async function deleteCampaign(actor: AdminActor, id: string): Promise<{ ok: true }> {
  return withTx(async (tx) => {
    const r = await load(tx, id, true)
    if (r.status !== "draft") throw conflict("Only drafts can be deleted. A sent campaign stays for its stats.")
    await tx.delete(newsletterCampaigns).where(eq(newsletterCampaigns.id, id))
    if (r.heroMediaId) await refreshVisibility([r.heroMediaId])
    await writeAudit({ actor: auditActor(actor), action: "newsletter.deleted", target: r.name || r.subject || "Untitled campaign", subjectType: "newsletter", subjectId: id, meta: { kind: r.kind } })
    return { ok: true as const }
  })
}

/** The campaign as an email, with unsaved composer fields laid over the saved ones. */
function draftVars(r: Row, over: Partial<NewsletterFields>, name: string) {
  const merged = { ...r, ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) } as Row
  const vars: Record<string, string | number> = { ...campaignEmailVars(merged), name }
  return { row: merged, vars }
}

/** POST …/{id}/preview: the real email (template, layout, footer) of what's in the composer now. Sends nothing. */
export async function previewCampaign(actor: AdminActor, id: string, over: Partial<NewsletterFields>): Promise<NewsletterPreviewDto> {
  const r = await load(await db(), id)
  const { row, vars } = draftVars(r, over, actor.name)
  // Placeholders, so an empty draft still previews; Send and test send insist on real words.
  const filled = { ...vars, subject: vars.subject || "Your subject line", heading: vars.heading || "Your heading", body: String(vars.body || "").trim() ? vars.body : "Your message goes here." }
  const unsubscribe = row.kind === "marketing" ? `${getEnv().publicOrigin}/you/settings#set-notify` : null
  const out = renderEmail(templateOf(row.kind), filled, { unsubscribeUrl: unsubscribe })
  return { subject: out.subject, html: out.html, text: out.text }
}

/** POST …/{id}/test: the campaign, exactly as written, to the admin's own address. Idempotent per key. */
export async function testCampaign(actor: AdminActor, id: string, key: string, ipHash: string | null = null): Promise<{ to: string; created: boolean }> {
  return withTx(async (tx) => {
    const r = await load(tx, id)
    const problems = newsletterProblems(content(r), getEnv().publicOrigin)
    delete problems.audience
    if (Object.keys(problems).length) throw badRequest(problems, "Finish the highlighted fields first.")
    const [me] = await tx.select({ email: users.email }).from(users).where(eq(users.id, actor.userId)).limit(1)
    if (!me?.email) throw rule("Your account has no email address to send the test to.")
    const dedupeKey = `newsletter_test:${id}:${key}`.slice(0, 200)
    const [prior] = await tx.select({ id: emailOutbox.id }).from(emailOutbox).where(eq(emailOutbox.dedupeKey, dedupeKey)).limit(1)
    if (prior) return { to: me.email, created: false }
    const vars = { ...campaignEmailVars(r), name: actor.name, kind: r.kind }
    renderEmail("newsletter_test", vars)
    await enqueueEmail(tx, { template: "newsletter_test", to: me.email, vars, dedupeKey })
    await writeAudit({ actor: auditActor(actor), action: "newsletter.test_sent", target: r.name || r.subject, subjectType: "newsletter", subjectId: id, ipHash, meta: { kind: r.kind, subject: r.subject, revision: r.revision } })
    return { to: me.email, created: true }
  })
}

/* ---------- Send, schedule, cancel ---------- */

/** Freezes the audience and starts sending (inside the caller's transaction, the row locked). */
async function start(tx: Tx, r: Row, actor: AuditActor) {
  const total = await freezeAudience(tx as unknown as Exec, r.id, audienceOf(r), r.kind as NewsletterKind, opts())
  const [row] = await tx.update(newsletterCampaigns).set({ status: "sending", startedAt: new Date(), recipientsTotal: total, updatedAt: new Date() }).where(eq(newsletterCampaigns.id, r.id)).returning()
  await writeAudit({ actor, action: "newsletter.started", target: r.name || r.subject, subjectType: "newsletter", subjectId: r.id, meta: { kind: r.kind, audience: r.audience, recipients: total } })
  afterCommit(() => kickNewsletter())
  return row
}

/**
 * POST …/{id}/send: "now" freezes the audience at once (refused if it no longer matches the count
 * the admin confirmed); "later" schedules it, and the audience is frozen when it starts. A retry
 * with the same idempotency key returns the campaign as it is. Audited.
 */
export async function sendCampaign(actor: AdminActor, id: string, body: NewsletterSendBody, ipHash: string | null = null): Promise<{ campaign: NewsletterDetailDto }> {
  return withTx(async (tx) => {
    const r = await load(tx, id, true)
    if (r.status !== "draft") {
      if (r.sendKey === body.idempotencyKey) return { campaign: await detailOf(tx, r) }
      throw conflict(r.status === "scheduled" ? "This campaign is already scheduled." : "This campaign has already gone out.")
    }
    const problems = newsletterProblems(content(r), getEnv().publicOrigin)
    if (Object.keys(problems).length) throw badRequest(problems, "Finish the highlighted fields first.")
    let at = new Date()
    if (body.when === "later") {
      if (!body.at) throw badRequest({ at: "Pick when it goes out." })
      at = new Date(body.at)
      const lead = at.getTime() - Date.now()
      if (lead < NEWSLETTER_MIN_LEAD_MS - 60_000) throw badRequest({ at: "Pick a time at least 5 minutes from now, or send it now." })
      if (lead > NEWSLETTER_MAX_LEAD_MS) throw badRequest({ at: "Pick a time in the next 60 days." })
    }
    const count = await countAudience(tx as unknown as Exec, audienceOf(r), r.kind as NewsletterKind, opts())
    if (count === 0) throw rule(r.kind === "marketing" ? "Nobody in this audience has said yes to news and offers yet, so there's no one to send to." : "There's nobody in this audience to send to.")
    if (body.when === "now" && count !== body.expectedCount) throw conflict(`The audience changed while you were checking: it's ${count} ${count === 1 ? "person" : "people"} now. Check the count and send again.`)
    const [row] = await tx
      .update(newsletterCampaigns)
      .set({ status: "scheduled", scheduledFor: at, sendKey: body.idempotencyKey, confirmedCount: body.expectedCount, sentByName: actor.name, updatedAt: new Date(), updatedBy: actor.userId, updatedByName: actor.name })
      .where(eq(newsletterCampaigns.id, id))
      .returning()
    await writeAudit({
      actor: auditActor(actor),
      action: body.when === "now" ? "newsletter.sent_now" : "newsletter.scheduled",
      target: r.name || r.subject,
      subjectType: "newsletter",
      subjectId: id,
      ipHash,
      meta: { kind: r.kind, subject: r.subject, audience: r.audience, audienceBrandId: r.audienceBrandId, audienceCountry: r.audienceCountry, count, scheduledFor: at.toISOString() },
    })
    const final = body.when === "now" ? await start(tx, row, auditActor(actor)) : row
    return { campaign: await detailOf(tx, final) }
  })
}

/**
 * POST …/{id}/cancel: a scheduled campaign goes back to draft (nothing was sent); a sending one
 * stops: recipients not yet handed over are cancelled and its emails still waiting in the outbox are
 * dropped. Emails already sent stay sent. Audited.
 */
export async function cancelCampaign(actor: AdminActor, id: string, ipHash: string | null = null): Promise<{ campaign: NewsletterDetailDto }> {
  return withTx(async (tx) => {
    const r = await load(tx, id, true)
    if (r.status === "scheduled") {
      const [row] = await tx
        .update(newsletterCampaigns)
        .set({ status: "draft", scheduledFor: null, sendKey: null, confirmedCount: null, sentByName: null, revision: r.revision + 1, updatedAt: new Date(), updatedBy: actor.userId, updatedByName: actor.name })
        .where(eq(newsletterCampaigns.id, id))
        .returning()
      await writeAudit({ actor: auditActor(actor), action: "newsletter.unscheduled", target: r.name || r.subject, subjectType: "newsletter", subjectId: id, ipHash, meta: { kind: r.kind, scheduledFor: iso(r.scheduledFor) } })
      return { campaign: await detailOf(tx, row) }
    }
    if (r.status !== "sending") throw conflict(r.status === "draft" ? "This campaign isn't scheduled." : "This campaign has finished, so there's nothing to stop.")
    const stopped = await tx.update(newsletterRecipients).set({ status: "cancelled" }).where(and(eq(newsletterRecipients.campaignId, id), eq(newsletterRecipients.status, "pending"))).returning({ id: newsletterRecipients.userId })
    const dropped = await tx
      .update(emailOutbox)
      .set({ status: "suppressed", lastError: "The campaign was cancelled.", lockedUntil: null })
      .where(and(sql`${emailOutbox.dedupeKey} like ${PREFIX(id)}`, eq(emailOutbox.status, "pending")))
      .returning({ id: emailOutbox.id })
    const [row] = await tx.update(newsletterCampaigns).set({ status: "cancelled", cancelledAt: new Date(), finishedAt: new Date(), updatedAt: new Date(), updatedBy: actor.userId, updatedByName: actor.name }).where(eq(newsletterCampaigns.id, id)).returning()
    await reconcileCampaign(tx as unknown as Exec, id)
    forgetCampaign(id)
    await writeAudit({ actor: auditActor(actor), action: "newsletter.stopped", target: r.name || r.subject, subjectType: "newsletter", subjectId: id, ipHash, meta: { kind: r.kind, notHandedOver: stopped.length, droppedFromOutbox: dropped.length } })
    return { campaign: await detailOf(tx, row) }
  })
}

/* ---------- The job ---------- */

const SYSTEM: AuditActor = { kind: "system", name: "Newsletter" }

/** Starts a run soon (after Send now); runs never overlap. */
export function kickNewsletter() {
  const slots = (yard.slots ??= {})
  if (slots.newsletterKick) return
  slots.newsletterKick = setTimeout(() => {
    slots.newsletterKick = undefined
    void runNewsletter().catch((e) => log.error("[yard] newsletter run failed", e))
  }, 300)
}

/**
 * One run (newsletter.run, every minute): start due scheduled campaigns, feed sending ones within
 * this minute's budget, copy outbox outcomes back, and finish campaigns with nobody left to hand over.
 * Safe to run twice or after a restart: recipients are claimed with SKIP LOCKED and handed over
 * with a unique outbox dedupe key.
 */
export async function runNewsletter(): Promise<{ started: number; queued: number; finished: number }> {
  const slots = (yard.slots ??= {})
  if (slots.newsletterRunning) return { started: 0, queued: 0, finished: 0 }
  slots.newsletterRunning = true
  const out = { started: 0, queued: 0, finished: 0 }
  try {
    const d = await db()
    const due = await d
      .select({ id: newsletterCampaigns.id })
      .from(newsletterCampaigns)
      .where(and(eq(newsletterCampaigns.status, "scheduled"), sql`${newsletterCampaigns.scheduledFor} <= now()`))
      .orderBy(asc(newsletterCampaigns.scheduledFor))
      .limit(10)
    for (const c of due) {
      await withTx(async (tx) => {
        const r = await load(tx, c.id, true)
        if (r.status !== "scheduled") return
        await start(tx, r, SYSTEM)
        out.started++
      })
    }

    const [backlog] = await d
      .select({ n: sql<number>`count(*)::int` })
      .from(emailOutbox)
      .where(and(inArray(emailOutbox.template, ["newsletter", "service_notice"]), inArray(emailOutbox.status, ["pending", "sending"])))
    let budget = Math.min(perMinute(), Math.max(0, NEWSLETTER_OUTBOX_HIGH_WATER - (Number(backlog?.n) || 0)))
    const sending = await d.select().from(newsletterCampaigns).where(eq(newsletterCampaigns.status, "sending")).orderBy(asc(newsletterCampaigns.startedAt)).limit(20)
    const deps = { withTx: <T>(fn: (tx: Exec) => Promise<T>) => withTx((tx) => fn(tx as unknown as Exec)), enqueue: (tx: Exec, input: Parameters<typeof enqueueEmail>[1]) => enqueueEmail(tx as unknown as Tx, input) }
    for (const c of sending) {
      const fed = await feedCampaign(deps, { id: c.id, template: templateOf(c.kind) }, budget)
      budget -= fed.queued
      out.queued += fed.queued
      await reconcileCampaign(d as unknown as Exec, c.id)
      if (fed.remaining === 0) {
        await withTx(async (tx) => {
          const r = await load(tx, c.id, true)
          if (r.status !== "sending") return
          await tx.update(newsletterCampaigns).set({ status: "sent", finishedAt: new Date(), updatedAt: new Date() }).where(eq(newsletterCampaigns.id, c.id))
          const counts = await campaignCounts(tx as unknown as Exec, c.id)
          await writeAudit({ actor: SYSTEM, action: "newsletter.finished", target: r.name || r.subject, subjectType: "newsletter", subjectId: c.id, meta: { kind: r.kind, recipients: r.recipientsTotal, ...counts } })
          out.finished++
        })
      }
    }

    // Outcomes keep arriving after a campaign has handed everyone over (retries, the stub).
    const recent = await d
      .select({ id: newsletterCampaigns.id })
      .from(newsletterCampaigns)
      .where(and(inArray(newsletterCampaigns.status, ["sent", "cancelled"]), gt(newsletterCampaigns.finishedAt, new Date(Date.now() - 3 * 24 * 3600_000))))
      .limit(50)
    for (const c of recent) await reconcileCampaign(d as unknown as Exec, c.id)
  } finally {
    slots.newsletterRunning = false
  }
  if (out.started + out.queued + out.finished) log.info(`[yard] newsletter: ${out.started} started, ${out.queued} handed to the outbox, ${out.finished} finished`)
  return out
}

export const jobs = {
  /** Every minute. */
  run: () => runNewsletter(),
}
