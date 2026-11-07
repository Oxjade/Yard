import "server-only"
import { createHash } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { BrandActor } from "../auth/dal"
import { db } from "../db"
import { abuseEvents } from "../db/schema"
import { outcome, scoreBrandMessage, topRule, type SpamRule } from "../inbox/spam"

/**
 * Brand-written text the shopper reads on their order page (a complaint reply, an exception note)
 * is scored like a brand Inbox message (§5.2, I's scorer): links and off-platform payment phrases.
 * - Held (score ≥ 6, or a payment phrase from a brand that isn't verified): the shopper never gets
 *   the text, Studio shows that it's held, and admins who read message reports are told.
 * - Flagged (3–5): the shopper gets it with "Keep payments on Yard" above it.
 * Either way an abuse_events row records it: ids, the score and a short hash of the text (so a
 * later, different reply isn't mistaken for the held one). Never the text itself.
 */

export const SCREEN_ACTION = "delivery.brand_text"

export type Screen = { held: boolean; notice: boolean; rule: SpamRule | null; score: number }
export type ScreenSubject = { type: "delivery_complaint" | "shipment_event"; id: string; orderRefId: string; brandId: string }
export type ScreenMark = { held: boolean; notice: boolean; textHash: string }

const CLEAN: Screen = { held: false, notice: false, rule: null, score: 0 }

export const textHash = (text: string) => createHash("sha256").update(text.trim()).digest("hex").slice(0, 16)

export async function screenBrandText(actor: BrandActor, text: string | null | undefined): Promise<Screen> {
  if (!text?.trim()) return CLEAN
  // fromQuickReply skips the duplicate-body rule, which counts Inbox conversations; links and
  // payment phrases are what matter on an order page.
  const s = await scoreBrandMessage({ brandId: actor.brandId, userId: actor.userId, conversationId: "", body: text, fromQuickReply: true })
  const o = outcome("brand", s, { brandVerified: actor.brand.reviewStatus === "verified" })
  if (o.status === "held") return { held: true, notice: false, rule: (o.heldReason as SpamRule | null) ?? topRule(s, "spam_links"), score: s.score }
  if (o.notice) return { held: false, notice: true, rule: topRule(s, "spam_links"), score: s.score }
  return { ...CLEAN, score: s.score }
}

/** Writes the abuse row for a held or flagged text (inside the caller's transaction). */
export async function recordScreen(actor: BrandActor, screen: Screen, subject: ScreenSubject, text: string, ipHash: string | null) {
  if (!screen.held && !screen.notice) return
  const d = await db()
  await d.insert(abuseEvents).values({
    actorKind: "brand",
    actorId: actor.userId,
    ipHash,
    action: SCREEN_ACTION,
    rule: screen.rule ?? "spam_links",
    detail: { subjectType: subject.type, subjectId: subject.id, orderRefId: subject.orderRefId, brandId: subject.brandId, held: screen.held, notice: screen.notice, score: screen.score, textHash: textHash(text) },
  })
}

/** The marks on these subjects, newest last (a subject can be marked again for a new text). */
export async function screensFor(subjectIds: string[]): Promise<Map<string, ScreenMark[]>> {
  const out = new Map<string, ScreenMark[]>()
  const ids = [...new Set(subjectIds)].filter(Boolean)
  if (!ids.length) return out
  const d = await db()
  const rows = await d
    .select({ detail: abuseEvents.detail })
    .from(abuseEvents)
    .where(and(eq(abuseEvents.action, SCREEN_ACTION), inArray(sql<string>`${abuseEvents.detail}->>'subjectId'`, ids)))
    .orderBy(abuseEvents.id)
  for (const r of rows) {
    const x = r.detail as { subjectId?: string; held?: boolean; notice?: boolean; textHash?: string }
    if (!x.subjectId || !x.textHash) continue
    const list = out.get(x.subjectId) ?? []
    list.push({ held: !!x.held, notice: !!x.notice, textHash: x.textHash })
    out.set(x.subjectId, list)
  }
  return out
}

/** The mark that applies to this exact text, if any. */
export function markFor(marks: Map<string, ScreenMark[]>, subjectId: string, text: string | null | undefined): ScreenMark | null {
  if (!text?.trim()) return null
  const h = textHash(text)
  const list = marks.get(subjectId) ?? []
  for (let i = list.length - 1; i >= 0; i--) if (list[i].textHash === h) return list[i]
  return null
}
