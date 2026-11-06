import { and, eq, like } from "drizzle-orm"
import { swapToken } from "@/server/auth/session"
import { connection, type NextRequest } from "next/server"
import { writeAudit } from "@/server/audit"
import { db, withTx } from "@/server/db"
import { auditLog, notifications, realtimeEvents, sessions } from "@/server/db/schema"
import { getEnv } from "@/server/env"
import { newId, randomToken } from "@/server/ids"
import { sha256hex } from "@/server/security/crypto"
import { route } from "@/server/http/route"
import { notify } from "@/server/notify"
import { publish, subscribe, type BusEvent } from "@/server/realtime/bus"
import { channels } from "@/server/realtime/channels"

/**
 * POST /api/dev/selftest/tx (dev only, admin audit.view): proves the single-connection
 * discipline (§1.3, §9.1). Inside one withTx: writeAudit + publish + notify + a nested withTx;
 * then a variant that throws. Expect { committed: 3, rolledBackPublished: 0 } within 2 s, and
 * exactly one `selftest` event on the admin channel. It also checks three guards no browser can
 * reach: two parallel token rotations of one session (exactly one wins), audit meta scrubbing at
 * every depth, and notify() refusing an off-site href.
 */
const handler = route({ auth: "admin", permission: "audit.view" }, async ({ actor }) => {
  const started = performance.now()
  const run = newId("st")
  const runRollback = `${run}_rb`
  const seen: BusEvent[] = []
  const unsubscribe = subscribe([channels.admin], (e) => {
    if (e.type === "selftest") seen.push(e)
  })
  const who = { kind: "admin" as const, id: actor.userId, name: actor.name, role: actor.role }
  try {
    let publishedSeq: number | undefined
    await withTx(async () => {
      await writeAudit({ actor: who, action: "dev.selftest", target: "Transaction self-test", subjectType: "selftest", subjectId: run, meta: { step: "audit" } })
      publishedSeq = await publish(channels.admin, "selftest", { run, variant: "commit" })
      await notify({ kind: "admin", id: actor.userId }, { key: `selftest:${run}`, template: "selftest", vars: { run } })
      await withTx(() => writeAudit({ actor: who, action: "dev.selftest", target: "Transaction self-test", subjectType: "selftest", subjectId: run, meta: { step: "nested" } }))
    })

    let rolledBack = false
    try {
      await withTx(async () => {
        await writeAudit({ actor: who, action: "dev.selftest", target: "Transaction self-test (rollback)", subjectType: "selftest", subjectId: runRollback, meta: { step: "audit" } })
        await publish(channels.admin, "selftest", { run: runRollback, variant: "rollback" })
        throw new Error("selftest rollback")
      })
    } catch {
      rolledBack = true
    }

    // After-commit work runs before withTx returns; give the emitter a tick anyway.
    await new Promise((r) => setTimeout(r, 25))
    const d = await db()
    const audits = await d.select({ id: auditLog.id, meta: auditLog.meta }).from(auditLog).where(eq(auditLog.subjectId, run))
    const events = publishedSeq ? await d.select({ seq: realtimeEvents.seq }).from(realtimeEvents).where(eq(realtimeEvents.seq, publishedSeq)) : []
    const steps = new Set(audits.map((a) => (a.meta as { step?: string }).step))
    const committed = (steps.has("audit") ? 1 : 0) + (events.length ? 1 : 0) + (steps.has("nested") ? 1 : 0)
    const rolledBackRows = (await d.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.subjectId, runRollback))).length
    const notified = (await d.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.recipientId, actor.userId), eq(notifications.eventKey, `selftest:${run}`)))).length
    // The self-test notification is test data: remove it so the admin bell stays clean.
    await d.delete(notifications).where(like(notifications.eventKey, "selftest:%"))

    // Rotation race: two requests at the renewal boundary with the same row (no cookies here).
    const now = Date.now()
    const [probe] = await d
      .insert(sessions)
      .values({ id: newId("ses"), tokenHash: sha256hex(randomToken(32)), userId: "u_t_f1", actor: "shopper", activeBrandId: null, createdAt: new Date(now - 86_400_000 * 2), lastSeenAt: new Date(now - 86_400_000 * 2), idleExpiresAt: new Date(now + 86_400_000), absoluteExpiresAt: new Date(now + 86_400_000 * 30), userAgent: "selftest", ipHash: null })
      .returning()
    const race = await Promise.all([swapToken("shopper", probe), swapToken("shopper", probe)])
    const [final] = await d.select({ tokenHash: sessions.tokenHash }).from(sessions).where(eq(sessions.id, probe.id))
    const winner = race.find((r) => r.won)
    await d.delete(sessions).where(eq(sessions.id, probe.id))
    const rotation = { winners: race.filter((r) => r.won).length, dbHasWinnersToken: !!winner && winner.won && final?.tokenHash === winner.newHash }

    // Audit meta: exact keys dropped at every depth; look-alike keys kept.
    const scrubbed = await writeAudit({
      actor: who,
      action: "dev.selftest",
      target: "Audit meta scrub",
      subjectType: "selftest",
      subjectId: `${run}_meta`,
      meta: { platform: "instagram", template: "t", relatedReportId: "rp_1", latest: true, detail: { access_token: "x", body: "hi", escalated: true }, lat: 6.5 },
    })
    const [metaRow] = await d.select({ meta: auditLog.meta }).from(auditLog).where(eq(auditLog.id, scrubbed.id))
    const m = metaRow.meta as Record<string, unknown> & { detail?: Record<string, unknown> }
    const auditMeta = {
      kept: ["platform", "template", "relatedReportId", "latest"].every((k) => k in m) && m.detail?.escalated === true,
      dropped: !("lat" in m) && !!m.detail && !("access_token" in m.detail) && !("body" in m.detail),
    }

    // notify() refuses an href that isn't a path on Yard, and writes nothing.
    let foreignHrefRefused = false
    try {
      await notify({ kind: "admin", id: actor.userId }, { key: `selftest:${run}:href`, template: "selftest", vars: { run }, href: "https://evil.example/x" })
    } catch {
      foreignHrefRefused = (await d.select({ id: notifications.id }).from(notifications).where(eq(notifications.eventKey, `selftest:${run}:href`))).length === 0
    }
    return {
      committed,
      rolledBackPublished: seen.filter((e) => (e.payload as { run?: string }).run === runRollback).length,
      rolledBackRows,
      rolledBack,
      adminStreamEvents: seen.filter((e) => (e.payload as { run?: string }).run === run).length,
      notified,
      rotation,
      auditMeta,
      foreignHrefRefused,
      ms: Math.round(performance.now() - started),
    }
  } finally {
    unsubscribe()
  }
})

export async function POST(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return handler(req, ctx)
}
