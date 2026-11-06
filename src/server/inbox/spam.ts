import "server-only"
import { createHash } from "node:crypto"
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm"
import { brandById } from "@/lib/data/brands"
import { db } from "../db"
import { abuseAlerts, abuseEvents, brandMembers, conversations, messages } from "../db/schema"
import { getEnv } from "../env"

/**
 * Spam heuristics (§5.2), scored on every message from either side. Scores add up from named
 * signals; the outcome is decided by `outcome()`. Nothing here stores or logs message text:
 * abuse rows get counts and ids only.
 */

export type SpamRule = "spam_links" | "spam_offplatform" | "spam_duplicate" | "spam_brand_offplatform" | "spam_marked_by_brand"
export type SpamScore = { score: number; rules: Partial<Record<SpamRule, number>>; payment: boolean; urls: number }

/** Off-platform payment phrases (§5.2). One match is +3, however many phrases a message holds. */
export const PAYMENT_PHRASES = [/whats\s?app/i, /telegram/i, /cash\s?app/i, /western\s?union/i, /gift\s?card/i, /\bpay\s+(me\s+)?(via|by|through|outside)\b/i, /bank\s+transfer/i, /\b(crypto|usdt|btc)\b/i]

const TLDS = "com|net|org|io|co|me|app|link|ly|xyz|shop|store|ng|gh|ke|za|uk|info|biz|site|online|top|click|gg|to|tk|ru|cn|in|us|de|fr|kr|jp|mx|ca|au|eu|tv|cc|ws|pw|live|club|vip|pro|page|dev"
/** URLs with a scheme, www-hosts, and bare domains on common TLDs (so "Mr.Smith" isn't a link). */
const URL_RE = new RegExp(String.raw`\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|\b(?:[a-z0-9-]+\.)+(?:${TLDS})\b(?:\/[^\s<>"']*)?`, "gi")

export function findUrls(text: string): string[] {
  return text.match(URL_RE) ?? []
}

export function hostOf(url: string) {
  return url
    .replace(/^https?:\/\//i, "")
    .split(/[/?#:]/)[0]
    .toLowerCase()
    .replace(/^www\./, "")
}

const hostIn = (host: string, allowed: string[]) => allowed.some((a) => host === a || host.endsWith(`.${a}`))

function allowlist(brandId?: string) {
  const out = ["instagram.com", "tiktok.com"]
  try {
    out.push(new URL(getEnv().publicUrl).hostname.toLowerCase())
  } catch {
    /* no public URL: the two social hosts only */
  }
  const site = brandId ? brandById.get(brandId)?.social?.website : undefined
  if (site) out.push(hostOf(site))
  return out
}

/** Lower-case, collapsed whitespace, digits → '#', then sha256: the duplicate-body key (§5.2). */
export function normalisedHash(body: string) {
  const n = body.toLowerCase().replace(/\s+/g, " ").trim().replace(/\d/g, "#")
  return createHash("sha256").update(n).digest("hex")
}

export const hasPaymentPhrase = (text: string) => PAYMENT_PHRASES.some((r) => r.test(text))

function linkPoints(text: string, allowed: string[]) {
  const urls = findUrls(text)
  let points = Math.max(0, urls.length - 1) * 2
  for (const u of urls) if (!hostIn(hostOf(u), allowed)) points += 1
  return { urls: urls.length, points }
}

const add = (s: SpamScore, rule: SpamRule | null, points: number) => {
  if (points <= 0) return
  s.score += points
  if (rule) s.rules[rule] = (s.rules[rule] ?? 0) + points
}

/**
 * The marking users of confirmed spam marks on a shopper within `days`, counted as independent
 * marks: users who share a brand membership (active or invited) count once together, so one
 * person in several brands, or two staff of one brand, is a single mark (§5.2).
 */
export async function independentSpamMarks(customerId: string, days: number) {
  const d = await db()
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await d
    .select({ markedBy: sql<string>`${abuseEvents.detail}->>'markedBy'`, brandId: sql<string>`${abuseEvents.detail}->>'brandId'`, conversationId: sql<string>`${abuseEvents.detail}->>'conversationId'` })
    .from(abuseEvents)
    .where(and(eq(abuseEvents.rule, "spam_marked_by_brand"), gte(abuseEvents.createdAt, since), sql`${abuseEvents.detail}->>'customerId' = ${customerId}`))
  // Only marks whose conversation is still marked as spam count.
  const convIds = [...new Set(rows.map((r) => r.conversationId).filter(Boolean))]
  const still = convIds.length ? await d.select({ id: conversations.id }).from(conversations).where(and(inArray(conversations.id, convIds), eq(conversations.spamState, "confirmed"))) : []
  const live = new Set(still.map((r) => r.id))
  const marks = rows.filter((r) => r.markedBy && live.has(r.conversationId))
  const users = [...new Set(marks.map((r) => r.markedBy))]
  if (!users.length) return { count: 0, users: [] as string[], brands: [] as string[], conversations: [] as string[] }
  const memberships = await d.select({ userId: brandMembers.userId, brandId: brandMembers.brandId }).from(brandMembers).where(inArray(brandMembers.userId, users))
  const brandsOf = new Map<string, Set<string>>()
  for (const u of users) brandsOf.set(u, new Set())
  for (const m of memberships) brandsOf.get(m.userId)?.add(m.brandId)
  // Connected components of "shares a brand": each component is one independent mark.
  const parent = new Map(users.map((u) => [u, u]))
  const find = (u: string): string => (parent.get(u) === u ? u : find(parent.get(u)!))
  for (let i = 0; i < users.length; i++)
    for (let j = i + 1; j < users.length; j++) {
      const a = brandsOf.get(users[i])!
      if ([...brandsOf.get(users[j])!].some((b) => a.has(b))) parent.set(find(users[i]), find(users[j]))
    }
  const count = new Set(users.map(find)).size
  return { count, users, brands: [...new Set(marks.map((r) => r.brandId))], conversations: [...new Set(marks.map((r) => r.conversationId))] }
}

/** An open spam_marks alert on a shopper, with the brands that marked them (the shadow hold, §5.2). */
export async function openSpamAlert(customerId: string) {
  const d = await db()
  const [row] = await d
    .select()
    .from(abuseAlerts)
    .where(and(eq(abuseAlerts.subjectKind, "user"), eq(abuseAlerts.subjectId, customerId), eq(abuseAlerts.kind, "spam_marks"), eq(abuseAlerts.status, "open")))
    .limit(1)
  if (!row) return null
  const brands = ((row.evidence as { brands?: string[] } | null)?.brands ?? []).filter((b) => typeof b === "string")
  return { id: row.id, brands }
}

/** A shopper's message (§5.2, shopper table). */
export async function scoreShopperMessage(input: { userId: string; accountCreatedAt: Date; conversationId: string | null; brandId: string; body: string }): Promise<SpamScore> {
  const s: SpamScore = { score: 0, rules: {}, payment: false, urls: 0 }
  const text = input.body ?? ""
  if (Date.now() - input.accountCreatedAt.getTime() < 24 * 3600_000) add(s, null, 3)
  const links = linkPoints(text, allowlist())
  s.urls = links.urls
  add(s, "spam_links", links.points)
  if (text.trim() && hasPaymentPhrase(text)) {
    s.payment = true
    add(s, "spam_offplatform", 3)
  }
  const d = await db()
  if (text.trim()) {
    // The same normalised body to ≥ 3 different brands within 15 min (this one included).
    const since = new Date(Date.now() - 15 * 60_000)
    const recent = await d
      .select({ body: messages.body, brandId: conversations.brandId })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.senderUserId, input.userId), eq(messages.senderSide, "customer"), gte(messages.createdAt, since)))
      .limit(300)
    const h = normalisedHash(text)
    const brands = new Set([input.brandId])
    for (const r of recent) if (r.body && normalisedHash(r.body) === h) brands.add(r.brandId)
    if (brands.size >= 3) add(s, "spam_duplicate", 4)
  }
  if (input.conversationId) {
    // ≥ 5 messages in 60 s in one conversation, this one included.
    const [{ n }] = await d
      .select({ n: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.conversationId, input.conversationId), eq(messages.senderUserId, input.userId), gte(messages.createdAt, new Date(Date.now() - 60_000))))
    if (n + 1 >= 5) add(s, null, 2)
  }
  const marks = await independentSpamMarks(input.userId, 30)
  if (marks.count >= 2) add(s, "spam_marked_by_brand", 5)
  return s
}

/** A brand member's message (§5.2, brand table). Quick-reply inserts skip the duplicate rule. */
export async function scoreBrandMessage(input: { brandId: string; userId: string; conversationId: string; body: string; fromQuickReply: boolean }): Promise<SpamScore> {
  const s: SpamScore = { score: 0, rules: {}, payment: false, urls: 0 }
  const text = input.body ?? ""
  const links = linkPoints(text, allowlist(input.brandId))
  s.urls = links.urls
  add(s, "spam_links", links.points)
  if (text.trim() && hasPaymentPhrase(text)) {
    s.payment = true
    add(s, "spam_brand_offplatform", 3)
  }
  if (text.trim() && !input.fromQuickReply) {
    const d = await db()
    const since = new Date(Date.now() - 15 * 60_000)
    const recent = await d
      .select({ body: messages.body, conversationId: messages.conversationId })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(conversations.brandId, input.brandId), eq(messages.senderSide, "brand"), gte(messages.createdAt, since), ne(messages.conversationId, input.conversationId), sql`${messages.quickReplyId} is null`))
      .limit(500)
    const h = normalisedHash(text)
    const convs = new Set([input.conversationId])
    for (const r of recent) if (r.body && normalisedHash(r.body) === h) convs.add(r.conversationId)
    if (convs.size >= 3) add(s, "spam_duplicate", 2)
  }
  return s
}

/** The rule that contributed most, for held_reason and abuse rows. */
export function topRule(s: SpamScore, fallback: SpamRule): SpamRule {
  let best: SpamRule | null = null
  for (const [rule, pts] of Object.entries(s.rules) as [SpamRule, number][]) if (!best || pts > (s.rules[best] ?? 0)) best = rule
  return best ?? fallback
}

/**
 * The outcome (§5.2). Shopper: ≥ 6 held; 3–5 delivered with a safety notice. Brand: ≥ 6 held,
 * or any payment phrase from a brand that isn't verified; 3–5 delivered with the notice.
 */
export function outcome(side: "customer" | "brand", s: SpamScore, opts: { brandVerified?: boolean; shadowHold?: boolean } = {}): { status: "sent" | "held"; heldReason: string | null; notice: boolean } {
  if (side === "customer") {
    if (s.score >= 6) return { status: "held", heldReason: topRule(s, "spam_links"), notice: false }
    if (opts.shadowHold) return { status: "held", heldReason: "spam_marked_by_brand", notice: false }
    return { status: "sent", heldReason: null, notice: s.score >= 3 }
  }
  if (s.payment && !opts.brandVerified) return { status: "held", heldReason: "spam_brand_offplatform", notice: false }
  if (s.score >= 6) return { status: "held", heldReason: s.payment ? "spam_brand_offplatform" : topRule(s, "spam_links"), notice: false }
  return { status: "sent", heldReason: null, notice: s.score >= 3 }
}
