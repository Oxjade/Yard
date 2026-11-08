import "server-only"
import { and, asc, eq, inArray, isNull, lte, notInArray, or, lt, sql } from "drizzle-orm"
import { afterCommit, db, withTx, type Executor, type Tx } from "../db"
import { users } from "../db/schema"
import { emailOutbox, notificationPreferences } from "../db/schema/engagement"
import { newId } from "../ids"
import { log } from "../log"
import { getEnv } from "../env"
import { yard } from "../state"
import { emailAllowed, unsubscribeApiUrl, unsubscribePageUrl, type OptionalCategory } from "./preferences"
import { emailFrom, emailProvider } from "./provider"
import { renderEmail, resolveTemplate, templateCategory, TRANSACTIONAL, type EmailTemplateKey } from "./templates"

/**
 * ENGAGEMENT email contract (v3). enqueueEmail writes an outbox row inside the caller's
 * transaction (idempotent by dedupeKey); the delivery worker sends it after commit and on a
 * schedule (jobs.deliver, every minute), with retries and backoff. No network I/O ever happens
 * inside a transaction.
 */
export const IMPL: string = "ENGAGEMENT-v3-2026-11-08"

export { emailConfigured } from "./provider"
export { templates as emailTemplates, resolveTemplate, type EmailTemplateKey } from "./templates"
export {
  getPreferences,
  updatePreferences,
  suppress,
  unsubscribeToken,
  readUnsubscribeToken,
  OPTIONAL_CATEGORIES,
  type Preferences,
  type PreferencesPatch,
  type OptionalCategory,
} from "./preferences"

export type EnqueueEmailInput = { template: string; to: string; vars: Record<string, string | number>; dedupeKey: string }

const EMAIL_RE = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/
const MAX_ATTEMPTS = 6
const BACKOFF_MIN = [1, 5, 30, 120, 720]
const BATCH = 25
const LOCK_MS = 2 * 60_000

/**
 * Templates whose `url` carries a raw single-use auth token (AUTH stores only its hash). The outbox
 * keeps that link only while the row can still be sent: it is removed when the row reaches sent,
 * failed or suppressed (and stub in production, where no one reads the stub output), and from any
 * row older than the longest token lifetime (invites: 7 days). Stale stub rows of these templates are
 * never re-queued.
 */
const SECRET_TEMPLATES: readonly string[] = ["verification", "reset", "magic_link", "team_invite"]
const SECRET_RETENTION = "8 days"
/** Finished rows are deleted after this. */
const ROW_RETENTION = "90 days"
const PURGE_EVERY_MS = 60 * 60_000
const TOKEN_RE = /[?&#](token|code|key|secret)=/i

/** vars without anything that could carry a credential: `url` of secret templates and any value holding a token-like query. */
export function scrubVars(template: string, vars: Record<string, string | number>): Record<string, string | number> {
  const secret = SECRET_TEMPLATES.includes(template)
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(vars ?? {})) {
    if (secret && k === "url") continue
    if (typeof v === "string" && TOKEN_RE.test(v)) continue
    out[k] = v
  }
  return out
}

function cleanVars(vars: Record<string, string | number>) {
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(vars ?? {}).slice(0, 30)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) continue
    if (typeof v === "number") out[k] = Number.isFinite(v) ? v : 0
    else if (typeof v === "string") out[k] = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, 500)
  }
  return out
}

/**
 * Queues an email (contract). Call inside the transaction that caused it. Never throws for a
 * bad template or address: the row is stored as failed (with the reason) and logged, so a caller's
 * transaction isn't rolled back by an email problem. A second call with the same dedupeKey is a no-op.
 */
export async function enqueueEmail(tx: Tx | Executor, input: EnqueueEmailInput): Promise<void> {
  const to = String(input.to ?? "").trim()
  const dedupeKey = String(input.dedupeKey ?? "").slice(0, 200)
  if (!dedupeKey) throw new Error("enqueueEmail: dedupeKey is required")
  const key = resolveTemplate(String(input.template ?? ""))
  const vars = cleanVars(input.vars)
  let status: "pending" | "failed" | "suppressed" = "pending"
  let lastError: string | null = null
  const category = key ? templateCategory(key) : "account"
  if (!key) {
    status = "failed"
    lastError = `Unknown email template "${String(input.template).slice(0, 60)}".`
    log.error(`[yard] enqueueEmail: ${lastError}`)
  } else if (!EMAIL_RE.test(to)) {
    status = "failed"
    lastError = "The recipient address isn't valid."
  } else {
    try {
      renderEmail(key, vars, { unsubscribeUrl: null })
    } catch (e) {
      status = "failed"
      lastError = e instanceof Error ? e.message.slice(0, 300) : "render failed"
      log.error(`[yard] enqueueEmail: ${lastError}`)
    }
    if (status === "pending") {
      const allowed = await emailAllowed(tx, to, category)
      if (!allowed.ok) {
        status = "suppressed"
        lastError = allowed.reason ?? "suppressed"
      }
    }
  }
  const inserted = await tx
    .insert(emailOutbox)
    .values({ id: newId("em"), template: key ?? String(input.template).slice(0, 60), category, toEmail: to.slice(0, 320), vars: status === "pending" ? vars : scrubVars(key ?? "", vars), dedupeKey, status, lastError })
    .onConflictDoNothing({ target: emailOutbox.dedupeKey })
    .returning({ id: emailOutbox.id })
  if (inserted.length && status === "pending") afterCommit(() => kickDelivery())
}

/* ---------- Delivery worker ---------- */

/** Starts a delivery run soon after a commit; runs never overlap. */
function kickDelivery() {
  const slots = (yard.slots ??= {})
  if (slots.emailKick) return
  slots.emailKick = setTimeout(() => {
    slots.emailKick = undefined
    void deliverDue().catch((e) => log.error("[yard] email delivery failed", e))
  }, 250)
}

/** Claims up to BATCH due rows (pending, due, unlocked) and locks them. */
async function claimDue(): Promise<(typeof emailOutbox.$inferSelect)[]> {
  return withTx(async (tx) => {
    const now = new Date()
    const rows = await tx
      .select()
      .from(emailOutbox)
      .where(and(inArray(emailOutbox.status, ["pending", "sending"]), lte(emailOutbox.nextAttemptAt, now), or(isNull(emailOutbox.lockedUntil), lt(emailOutbox.lockedUntil, now))))
      .orderBy(asc(emailOutbox.nextAttemptAt))
      .limit(BATCH)
    if (!rows.length) return []
    await tx
      .update(emailOutbox)
      .set({ status: "sending", lockedUntil: new Date(now.getTime() + LOCK_MS) })
      .where(inArray(
        emailOutbox.id,
        rows.map((r) => r.id),
      ))
    return rows
  })
}

/**
 * Sends due outbox rows (jobs.deliver). Re-checks suppressions at send time, renders, sends
 * outside any transaction, then records the outcome. Returns counts.
 */
export async function deliverDue(): Promise<{ sent: number; failed: number; stub: number; suppressed: number }> {
  const slots = (yard.slots ??= {})
  if (slots.emailDelivering) return { sent: 0, failed: 0, stub: 0, suppressed: 0 }
  slots.emailDelivering = true
  const counts = { sent: 0, failed: 0, stub: 0, suppressed: 0 }
  try {
    const provider = emailProvider()
    const from = emailFrom()
    for (let round = 0; round < 8; round++) {
      const rows = await claimDue()
      if (!rows.length) break
      for (const row of rows) {
        const key = resolveTemplate(row.template) as EmailTemplateKey | null
        const d = await db()
        // A finished row (anything but a retry) keeps no credential-bearing link; dev keeps stub links (the local mailbox).
        const finish = (set: Partial<typeof emailOutbox.$inferInsert>) => {
          const done = set.status !== "pending" && (set.status !== "stub" || getEnv().nodeEnv === "production")
          return d.update(emailOutbox).set({ lockedUntil: null, ...set, ...(done ? { vars: scrubVars(row.template, row.vars) } : {}) }).where(eq(emailOutbox.id, row.id))
        }
        if (!key) {
          await finish({ status: "failed", lastError: "Unknown template." })
          counts.failed++
          continue
        }
        const allowed = await emailAllowed(d, row.toEmail, row.category as never)
        if (!allowed.ok) {
          await finish({ status: "suppressed", lastError: allowed.reason ?? "suppressed" })
          counts.suppressed++
          continue
        }
        const optional = !TRANSACTIONAL.has(templateCategory(key))
        let rendered
        try {
          rendered = renderEmail(key, row.vars, { unsubscribeUrl: optional ? unsubscribePageUrl(row.toEmail, row.category as OptionalCategory) : null })
        } catch (e) {
          await finish({ status: "failed", lastError: e instanceof Error ? e.message.slice(0, 300) : "render failed" })
          counts.failed++
          continue
        }
        const headers: Record<string, string> = { "X-Yard-Email-Id": row.id }
        if (optional) {
          headers["List-Unsubscribe"] = `<${unsubscribeApiUrl(row.toEmail, row.category as OptionalCategory)}>`
          headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        }
        const result = await provider.send({ to: row.toEmail, from, subject: rendered.subject, text: rendered.text, html: rendered.html, headers })
        const attempts = row.attempts + 1
        if (result.ok) {
          await finish({ status: "sent", attempts, provider: provider.name, providerMessageId: result.messageId, sentAt: new Date(), lastError: null })
          counts.sent++
        } else if (!provider.live) {
          await finish({ status: "stub", attempts, provider: provider.name, lastError: result.error })
          counts.stub++
        } else if (result.permanent || attempts >= MAX_ATTEMPTS) {
          await finish({ status: "failed", attempts, provider: provider.name, lastError: result.error })
          counts.failed++
        } else {
          const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000
          await finish({ status: "pending", attempts, provider: provider.name, lastError: result.error, nextAttemptAt: new Date(Date.now() + wait) })
        }
      }
      if (rows.length < BATCH) break
    }
  } finally {
    slots.emailDelivering = false
  }
  if (counts.sent + counts.failed + counts.stub) log.info(`[yard] email: ${counts.sent} sent, ${counts.failed} failed, ${counts.stub} not sent (stub), ${counts.suppressed} suppressed`)
  return counts
}

/** Puts 'stub' rows back in the queue once a provider is configured (admin action / boot). */
export async function requeueStubbed(): Promise<number> {
  if (!emailProvider().live) return 0
  const d = await db()
  const rows = await d
    .update(emailOutbox)
    .set({ status: "pending", nextAttemptAt: new Date(), attempts: 0, lastError: null })
    .where(and(eq(emailOutbox.status, "stub"), notInArray(emailOutbox.template, [...SECRET_TEMPLATES]), sql`${emailOutbox.createdAt} > now() - interval '2 days'`))
    .returning({ id: emailOutbox.id })
  return rows.length
}

/**
 * Retention (hourly, from jobs.deliver): removes credential-bearing links from rows older than the
 * longest auth-token lifetime whatever their status (an unsent one is marked failed: its link has
 * expired), and deletes finished rows older than ROW_RETENTION.
 */
export async function purgeOutbox(): Promise<{ scrubbed: number; deleted: number }> {
  const d = await db()
  const old = await d
    .select({ id: emailOutbox.id, template: emailOutbox.template, vars: emailOutbox.vars, status: emailOutbox.status })
    .from(emailOutbox)
    .where(and(sql`${emailOutbox.createdAt} < now() - ${sql.raw(`interval '${SECRET_RETENTION}'`)}`, sql`(${inArray(emailOutbox.template, [...SECRET_TEMPLATES])} or ${emailOutbox.vars}::text ~* '[?&#](token|code|key|secret)=')`))
    .limit(1000)
  let scrubbed = 0
  for (const r of old) {
    const vars = scrubVars(r.template, r.vars)
    if (Object.keys(vars).length === Object.keys(r.vars ?? {}).length) continue
    const unsent = r.status === "pending" || r.status === "sending"
    await d
      .update(emailOutbox)
      .set({ vars, ...(unsent ? { status: "failed", lockedUntil: null, lastError: "The link expired before the email could be sent." } : {}) })
      .where(eq(emailOutbox.id, r.id))
    scrubbed++
  }
  const deleted = await d
    .delete(emailOutbox)
    .where(and(inArray(emailOutbox.status, ["sent", "failed", "suppressed", "stub"]), sql`${emailOutbox.createdAt} < now() - ${sql.raw(`interval '${ROW_RETENTION}'`)}`))
    .returning({ id: emailOutbox.id })
  return { scrubbed, deleted: deleted.length }
}

/** Outbox status for one dedupe key (AUTH can tell a user whether their email went out). */
export async function emailStatus(dedupeKey: string): Promise<{ status: string; sentAt: Date | null } | null> {
  const d = await db()
  const [row] = await d.select({ status: emailOutbox.status, sentAt: emailOutbox.sentAt }).from(emailOutbox).where(eq(emailOutbox.dedupeKey, dedupeKey)).limit(1)
  return row ?? null
}

export const jobs = {
  /** Every minute. */
  deliver: async () => {
    const slots = (yard.slots ??= {})
    const last = typeof slots.emailPurgedAt === "number" ? slots.emailPurgedAt : 0
    if (Date.now() - last > PURGE_EVERY_MS) {
      slots.emailPurgedAt = Date.now()
      await purgeOutbox().catch((e) => log.error("[yard] email outbox purge failed", e))
    }
    await requeueStubbed()
    return deliverDue()
  },
}

/**
 * AUTH erasure hook (src/server/auth/erasure.ts; runs before the users row is anonymised). Deletes
 * the shopper's notification preferences and every outbox row to their address, except the
 * account_deleted confirmation (it may not be delivered yet; the 8-day scrub and 90-day purge
 * remove it). Suppressions stay: they are the do-not-contact list for that address.
 */
export async function eraseCustomerData(tx: Tx | Executor, userId: string): Promise<{ erased: number }> {
  const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  await tx.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId))
  if (!u?.email) return { erased: 0 }
  const rows = await tx
    .delete(emailOutbox)
    .where(and(sql`lower(${emailOutbox.toEmail}) = ${u.email.trim().toLowerCase()}`, sql`${emailOutbox.template} <> 'account_deleted'`))
    .returning({ id: emailOutbox.id })
  return { erased: rows.length }
}
