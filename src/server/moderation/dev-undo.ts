import "server-only"
import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm"
import { afterCommit, db } from "../db"
import {
  brandLocations,
  brands,
  chartEvents,
  chartFlags,
  conversationParticipants,
  conversations,
  deliveryComplaints,
  locationEvents,
  messages,
  reports,
  socialPosts,
  users,
} from "../db/schema"
import { previewOf } from "../inbox/dto"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { refreshMedia, setMediaModeration } from "./content"
import { tryFeature } from "./shared"

/**
 * Development only, called by devCleanupM inside its transaction. Puts back exactly what one of M's
 * kit decisions changed on SHARED fixtures (a seeded event, Paper Riot's computed flags, u_7's held
 * message, a seeded report or complaint, a brand's status), so a kit can exercise the real decisions
 * on the real sample data and still leave every demo account with the seeded state.
 *
 * Each undo reads the decision's own audit row (its meta records the state before: `from`,
 * `fromReason`, `fromReviewedAt`, `reportFrom`, `heldReason`; `frozenFlags` only on freezes approved
 * by an earlier build, which set flags to "frozen" — approvals now leave flags open) and acts only while the
 * subject is still exactly as that decision left it, so a later decision by a person is never
 * overwritten. Rows are undone newest first, which composes (a suspension then a reinstatement nets
 * out to the status before both).
 */

type AuditRow = { id: string; at: Date; action: string; subjectId: string | null; actorId: string | null; reason: string | null; meta: unknown }
export type UndoOutcome = { auditId: string; action: string; subjectId: string; outcome: "restored" | "unchanged since" | "subject gone" | "nothing to undo" }

const SLACK_MS = 2_000
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v) : null)
const str = (v: unknown) => (typeof v === "string" ? v : null)

/** Reports a decision actioned → back to the status each had (meta.reportFrom), while still as it left them. */
async function undoReports(a: AuditRow, dryRun: boolean): Promise<number> {
  const from = ((a.meta ?? {}) as { reportFrom?: Record<string, unknown> }).reportFrom
  if (!from || typeof from !== "object") return 0
  const d = await db()
  let n = 0
  for (const [id, prev] of Object.entries(from)) {
    if (typeof prev !== "string") continue
    const [r] = await d.select().from(reports).where(eq(reports.id, id)).limit(1)
    if (!r || r.status !== "actioned" || r.decidedBy !== a.actorId || !r.decidedAt || r.decidedAt.getTime() < a.at.getTime() - SLACK_MS) continue
    if (!dryRun) await d.update(reports).set({ status: prev, decidedBy: null, decidedAt: null, decision: prev === "escalated" ? "escalated" : null }).where(eq(reports.id, id))
    n++
  }
  return n
}

export async function undoKitDecisions(rows: AuditRow[], opts: { dryRun: boolean }): Promise<UndoOutcome[]> {
  const d = await db()
  const out: UndoOutcome[] = []
  let chartsChanged = false
  let aroundChanged = false
  const media: (string | null | undefined)[] = []
  const brandMedia = new Set<string>()
  const resyncChannels = new Set<string>()
  const { dryRun } = opts

  for (const a of [...rows].sort((x, y) => y.at.getTime() - x.at.getTime())) {
    const meta = (a.meta ?? {}) as Record<string, unknown>
    const id = a.subjectId ?? ""
    let outcome: UndoOutcome["outcome"] = "nothing to undo"
    const done = (ok: boolean, exists = true) => (outcome = ok ? "restored" : exists ? "unchanged since" : "subject gone")

    switch (a.action) {
      case "chart_flag.cleared":
      case "chart_flag.confirmed": {
        const [f] = await d.select().from(chartFlags).where(eq(chartFlags.id, id)).limit(1)
        const want = a.action === "chart_flag.cleared" ? "cleared" : "confirmed"
        const ok = !!f && f.status === want && f.decisionReason === a.reason
        if (ok && !dryRun) {
          await d.update(chartFlags).set({ status: str(meta.from) ?? "open", decidedBy: null, decidedAt: null, decisionReason: null }).where(eq(chartFlags.id, id))
          // Clearing re-counted the flag's own excluded signals; they go back to excluded.
          if (want === "cleared") await d.update(chartEvents).set({ verdict: "excluded_fraud" }).where(and(eq(chartEvents.flagId, id), eq(chartEvents.verdict, "counted")))
        }
        if (ok) chartsChanged = true
        done(ok, !!f)
        break
      }
      case "chart.freeze_approved": {
        const ids = Array.isArray(meta.frozenFlags) ? meta.frozenFlags.filter((x): x is string => typeof x === "string") : []
        if (!ids.length) break
        const frozen = await d.select({ id: chartFlags.id }).from(chartFlags).where(and(inArray(chartFlags.id, ids), eq(chartFlags.status, "frozen"), a.reason ? eq(chartFlags.decisionReason, a.reason) : undefined))
        if (frozen.length && !dryRun) await d.update(chartFlags).set({ status: "open", decidedBy: null, decidedAt: null, decisionReason: null }).where(inArray(chartFlags.id, frozen.map((f) => f.id)))
        if (frozen.length) chartsChanged = true
        done(frozen.length > 0)
        break
      }
      case "location_event.approved":
      case "location_event.hidden":
      case "location_event.removed": {
        const [e] = await d.select().from(locationEvents).where(eq(locationEvents.id, id)).limit(1)
        const to = { "location_event.approved": "approved", "location_event.hidden": "rejected", "location_event.removed": "removed" }[a.action]
        const ok = !!e && e.moderationStatus === to && (to === "approved" ? e.moderationReason === null : e.moderationReason === a.reason) && !!str(meta.from)
        if (ok && !dryRun) {
          await d.update(locationEvents).set({ moderationStatus: str(meta.from)!, moderationReason: str(meta.fromReason), reviewedAt: iso(meta.fromReviewedAt) }).where(eq(locationEvents.id, id))
          if (to === "removed" && meta.from !== "removed") await setMediaModeration([e.image?.mediaId], "ok")
          media.push(e.image?.mediaId)
        }
        if (ok) aroundChanged = true
        done(ok, !!e)
        break
      }
      case "location.approved":
      case "location.rejected":
      case "location.removed":
      case "location.restored": {
        const [p] = await d.select().from(brandLocations).where(eq(brandLocations.id, id)).limit(1)
        const to = { "location.approved": "approved", "location.rejected": "rejected", "location.removed": "removed", "location.restored": "approved" }[a.action]
        const ok = !!p && p.moderationStatus === to && (to === "approved" ? p.moderationReason === null : p.moderationReason === a.reason) && !!str(meta.from)
        if (ok && !dryRun) {
          await d.update(brandLocations).set({ moderationStatus: str(meta.from)!, moderationReason: str(meta.fromReason), reviewedAt: iso(meta.fromReviewedAt) }).where(eq(brandLocations.id, id))
          const events = await d.select({ image: locationEvents.image, status: locationEvents.moderationStatus }).from(locationEvents).where(eq(locationEvents.locationId, id))
          const ids = [...p.images.map((i) => i.mediaId), ...events.map((x) => x.image?.mediaId)]
          // An event Yard removed on its own keeps its image removed.
          if (to === "removed" && meta.from !== "removed") await setMediaModeration([...p.images.map((i) => i.mediaId), ...events.filter((x) => x.status !== "removed").map((x) => x.image?.mediaId)], "ok")
          if (a.action === "location.restored") await setMediaModeration(ids, "removed")
          media.push(...ids)
        }
        if (ok) aroundChanged = true
        done(ok, !!p)
        break
      }
      case "post.hidden":
      case "post.removed":
      case "post.restored": {
        const [p] = await d.select().from(socialPosts).where(eq(socialPosts.id, id)).limit(1)
        const to = { "post.hidden": "flagged", "post.removed": "removed", "post.restored": "ok" }[a.action]
        const ok = !!p && p.moderationStatus === to && !!str(meta.from)
        if (ok && !dryRun) {
          await d.update(socialPosts).set({ moderationStatus: str(meta.from)!, removedReason: str(meta.fromReason) }).where(eq(socialPosts.id, id))
          const ids = p.media.flatMap((m) => [m.mediaId, m.posterMediaId])
          if (to === "removed" && meta.from !== "removed") await setMediaModeration(ids, "ok")
          if (a.action === "post.restored" && meta.from === "removed") await setMediaModeration(ids, "removed")
          media.push(...ids)
        }
        done(ok, !!p)
        break
      }
      case "message.released": {
        // Back to held: the brand never saw it in the seeded state. Preview, unread counts and the
        // receiver's bell item are put back as the delivered messages say; open tabs refetch.
        const [m] = await d.select().from(messages).where(eq(messages.id, id)).limit(1)
        const heldReason = str(meta.heldReason)
        const ok = !!m && m.status === "sent" && m.heldReason === null && !!heldReason
        if (ok && !dryRun) {
          await d.update(messages).set({ status: "held", heldReason }).where(eq(messages.id, id))
          const [c] = await d.select().from(conversations).where(eq(conversations.id, m.conversationId)).limit(1)
          if (c) {
            const [last] = await d
              .select()
              .from(messages)
              .where(and(eq(messages.conversationId, c.id), eq(messages.status, "sent"), ne(messages.senderSide, "system")))
              .orderBy(desc(messages.seq))
              .limit(1)
            await d
              .update(conversations)
              .set(last ? { lastMessageSeq: last.seq, lastMessageAt: last.createdAt, lastPreview: previewOf({ kind: last.kind, body: last.body, productName: last.productSnapshot?.name }) } : { lastMessageSeq: 0, lastMessageAt: null, lastPreview: "" })
              .where(eq(conversations.id, c.id))
            for (const side of ["customer", "brand"] as const)
              await d
                .update(conversationParticipants)
                .set({
                  unreadCount: sql`(select count(*)::int from messages um where um.conversation_id = ${c.id} and um.sender_side = ${side === "customer" ? "brand" : "customer"} and um.status = 'sent' and um.seq > ${conversationParticipants.lastReadSeq})`,
                })
                .where(and(eq(conversationParticipants.conversationId, c.id), eq(conversationParticipants.side, side)))
            // A release that was the conversation's first delivered shopper message recorded message_started.
            if (m.senderSide === "customer")
              await d.delete(chartEvents).where(and(eq(chartEvents.kind, "message_started"), eq(chartEvents.brandId, c.brandId!), eq(chartEvents.actorId, c.customerId!), gte(chartEvents.createdAt, new Date(a.at.getTime() - SLACK_MS))))
            resyncChannels.add(channels.user(c.customerId!))
            resyncChannels.add(channels.brand(c.brandId!))
          }
        }
        done(ok, !!m)
        break
      }
      case "report.dismissed":
      case "report.escalated": {
        const [r] = await d.select().from(reports).where(eq(reports.id, id)).limit(1)
        const prev = str(meta.from)
        const ok = !!r && !!prev && (a.action === "report.dismissed" ? r.status === "dismissed" && r.decidedBy === a.actorId : r.status === "escalated")
        if (ok && !dryRun) await d.update(reports).set({ status: prev!, decidedBy: null, decidedAt: null, decision: prev === "escalated" ? "escalated" : null }).where(eq(reports.id, id))
        done(ok, !!r)
        break
      }
      case "delivery.resolved":
      case "delivery.contacted_brand":
      case "delivery.escalated": {
        const prev = str(meta.from)
        if (!id.startsWith("dc_") || !prev) break
        const [c] = await d.select().from(deliveryComplaints).where(eq(deliveryComplaints.id, id)).limit(1)
        const now = { "delivery.resolved": "resolved", "delivery.contacted_brand": "waiting_brand", "delivery.escalated": "escalated" }[a.action]
        const ok = !!c && c.status === now && (a.action !== "delivery.resolved" || c.resolvedBy === a.actorId) && prev !== now
        if (ok && !dryRun) await d.update(deliveryComplaints).set(a.action === "delivery.resolved" ? { status: prev, resolution: null, resolvedAt: null, resolvedBy: null } : { status: prev }).where(eq(deliveryComplaints.id, id))
        done(ok, !!c)
        break
      }
      case "brand.status_changed": {
        const [b] = await d.select().from(brands).where(eq(brands.id, id)).limit(1)
        const to = str(meta.to)
        const prev = str(meta.from)
        const ok = !!b && !!to && !!prev && b.reviewStatus === to
        if (ok && !dryRun) {
          await d.update(brands).set({ reviewStatus: prev!, verified: prev === "verified" }).where(eq(brands.id, id))
          brandMedia.add(id)
        }
        if (ok) {
          chartsChanged = true
          aroundChanged = true
        }
        done(ok, !!b)
        break
      }
      case "user.status_changed": {
        const [u] = await d.select().from(users).where(eq(users.id, id)).limit(1)
        const to = str(meta.to)
        const prev = str(meta.from)
        const ok = !!u && !!to && !!prev && u.status === to
        if (ok && !dryRun) await d.update(users).set({ status: prev! }).where(eq(users.id, id))
        done(ok, !!u)
        break
      }
    }
    const reportsBack = await undoReports(a, dryRun)
    if (reportsBack && outcome === "nothing to undo") outcome = "restored"
    if (outcome !== "nothing to undo") out.push({ auditId: a.id, action: a.action, subjectId: id, outcome })
  }

  if (dryRun) return out
  // A restored brand status changes which media can be public (§5.4): every file of its posts and places.
  for (const brandId of brandMedia) {
    const [posts, places, events] = await Promise.all([
      d.select({ media: socialPosts.media }).from(socialPosts).where(eq(socialPosts.brandId, brandId)),
      d.select({ images: brandLocations.images }).from(brandLocations).where(eq(brandLocations.brandId, brandId)),
      d.select({ image: locationEvents.image }).from(locationEvents).where(eq(locationEvents.brandId, brandId)),
    ])
    media.push(...posts.flatMap((p) => p.media.flatMap((m) => [m.mediaId, m.posterMediaId])), ...places.flatMap((p) => p.images.map((i) => i.mediaId)), ...events.map((e) => e.image?.mediaId))
  }
  await refreshMedia(media)
  if (chartsChanged) {
    const charts = await import("../charts")
    await tryFeature("charts.invalidate", () => charts.invalidate())
  }
  if (aroundChanged) {
    const around = await import("../around")
    await tryFeature("around.invalidate", () => around.invalidate())
  }
  if (resyncChannels.size)
    afterCommit(async () => {
      for (const ch of resyncChannels) await publish(ch, "resync", {}, { durable: false })
    })
  return out
}
