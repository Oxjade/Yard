import "server-only"
import { hkdfSync } from "node:crypto"
import { and, eq, inArray, sql } from "drizzle-orm"
import { db, type Executor } from "../db"
import { users } from "../db/schema"
import { emailSuppressions, notificationPreferences } from "../db/schema/engagement"
import { getEnv } from "../env"
import { newId } from "../ids"
import { hmacB64url, safeEqual } from "../security/crypto"
import { yard } from "../state"
import { TRANSACTIONAL, type EmailCategory } from "./templates"

/**
 * Notification preferences, suppressions and unsubscribe tokens. Optional categories follow the
 * user's preferences and any suppression on the address; transactional mail (account, orders,
 * payouts) is stopped only by a bounce or complaint.
 */
export type OptionalCategory = "drops" | "price_drops" | "back_in_stock" | "brand_news"
export const OPTIONAL_CATEGORIES: readonly OptionalCategory[] = ["drops", "price_drops", "back_in_stock", "brand_news"]

export type Preferences = {
  email: Record<OptionalCategory, boolean>
  inApp: Record<OptionalCategory, boolean>
}

type PrefRow = typeof notificationPreferences.$inferSelect

const DEFAULTS: Preferences = {
  email: { drops: true, price_drops: true, back_in_stock: true, brand_news: true },
  inApp: { drops: true, price_drops: true, back_in_stock: true, brand_news: true },
}

function toPrefs(row: PrefRow | undefined): Preferences {
  if (!row) return structuredClone(DEFAULTS)
  return {
    email: { drops: row.emailDrops, price_drops: row.emailPriceDrops, back_in_stock: row.emailBackInStock, brand_news: row.emailBrandNews },
    inApp: { drops: row.inappDrops, price_drops: row.inappPriceDrops, back_in_stock: row.inappBackInStock, brand_news: row.inappBrandNews },
  }
}

export async function getPreferences(userId: string, ex?: Executor): Promise<Preferences> {
  const d = ex ?? (await db())
  const [row] = await d.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId)).limit(1)
  return toPrefs(row)
}

/** Preferences for many users at once (jobs). */
export async function getPreferencesMany(userIds: string[]): Promise<Map<string, Preferences>> {
  const out = new Map<string, Preferences>()
  if (!userIds.length) return out
  const d = await db()
  const rows = await d.select().from(notificationPreferences).where(inArray(notificationPreferences.userId, userIds))
  for (const id of userIds) out.set(id, toPrefs(undefined))
  for (const r of rows) out.set(r.userId, toPrefs(r))
  return out
}

export type PreferencesPatch = { email?: Partial<Record<OptionalCategory, boolean>>; inApp?: Partial<Record<OptionalCategory, boolean>> }

/** Merges a patch into the user's preferences (call inside withTx). Turning a category back on lifts an unsubscribe suppression for it. */
export async function updatePreferences(userId: string, patch: PreferencesPatch): Promise<Preferences> {
  const d = await db()
  const cur = await getPreferences(userId, d)
  const next: Preferences = { email: { ...cur.email, ...patch.email }, inApp: { ...cur.inApp, ...patch.inApp } }
  const values = {
    emailDrops: next.email.drops,
    emailPriceDrops: next.email.price_drops,
    emailBackInStock: next.email.back_in_stock,
    emailBrandNews: next.email.brand_news,
    inappDrops: next.inApp.drops,
    inappPriceDrops: next.inApp.price_drops,
    inappBackInStock: next.inApp.back_in_stock,
    inappBrandNews: next.inApp.brand_news,
    updatedAt: new Date(),
  }
  await d
    .insert(notificationPreferences)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: notificationPreferences.userId, set: values })
  const turnedOn = OPTIONAL_CATEGORIES.filter((c) => patch.email?.[c] === true)
  if (turnedOn.length) {
    const [u] = await d.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
    if (u) {
      const email = u.email.toLowerCase()
      await d.delete(emailSuppressions).where(and(eq(emailSuppressions.emailLower, email), eq(emailSuppressions.reason, "unsubscribe"), inArray(emailSuppressions.category, [...turnedOn, "all"])))
    }
  }
  return next
}

/** Records a suppression (unsubscribe, bounce, complaint). Idempotent. */
export async function suppress(email: string, category: OptionalCategory | "all", reason: "unsubscribe" | "bounce" | "complaint" | "manual", ex?: Executor) {
  const d = ex ?? (await db())
  await d.insert(emailSuppressions).values({ id: newId("sup"), emailLower: email.trim().toLowerCase(), category, reason }).onConflictDoNothing()
}

/**
 * Whether email of `category` may go to `to`. Checks suppressions on the address and, for optional
 * categories, the preferences of the account that owns the address (if any).
 */
export async function emailAllowed(ex: Executor, to: string, category: EmailCategory): Promise<{ ok: boolean; reason?: string }> {
  const email = to.trim().toLowerCase()
  const rows = await ex.select({ category: emailSuppressions.category, reason: emailSuppressions.reason }).from(emailSuppressions).where(eq(emailSuppressions.emailLower, email))
  if (rows.some((r) => r.reason === "bounce" || r.reason === "complaint")) return { ok: false, reason: "address bounced or complained" }
  if (TRANSACTIONAL.has(category)) return { ok: true }
  if (rows.some((r) => r.category === "all" || r.category === category)) return { ok: false, reason: "unsubscribed" }
  const [u] = await ex.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1)
  if (u) {
    const prefs = await getPreferences(u.id, ex)
    if (!prefs.email[category as OptionalCategory]) return { ok: false, reason: "turned off in preferences" }
  }
  return { ok: true }
}

/* ---------- Unsubscribe tokens ---------- */

/** HKDF subkey for unsubscribe links (its own purpose, like security/keys.ts). */
function unsubKey(): Buffer {
  const slots = (yard.slots ??= {})
  return (slots.emailUnsubKey ??= Buffer.from(hkdfSync("sha256", getEnv().sessionSecret, Buffer.alloc(0), "yard/email-unsubscribe/v1", 32))) as Buffer
}

/** A stateless, non-expiring token naming an address and a category ('all' = every optional email). */
export function unsubscribeToken(email: string, category: OptionalCategory | "all") {
  const payload = Buffer.from(JSON.stringify({ e: email.trim().toLowerCase(), c: category })).toString("base64url")
  return `${payload}.${hmacB64url(unsubKey(), payload)}`
}

export function readUnsubscribeToken(token: string): { email: string; category: OptionalCategory | "all" } | null {
  if (token.length > 600) return null
  const [payload, mac] = token.split(".")
  if (!payload || !mac || !safeEqual(mac, hmacB64url(unsubKey(), payload))) return null
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { e?: unknown; c?: unknown }
    if (typeof p.e !== "string" || typeof p.c !== "string") return null
    if (p.c !== "all" && !OPTIONAL_CATEGORIES.includes(p.c as OptionalCategory)) return null
    return { email: p.e, category: p.c as OptionalCategory | "all" }
  } catch {
    return null
  }
}

/** The page link put in optional emails (the frontend renders /unsubscribe and POSTs the token). */
export function unsubscribePageUrl(email: string, category: OptionalCategory) {
  return `${getEnv().publicOrigin}/unsubscribe?token=${encodeURIComponent(unsubscribeToken(email, category))}`
}

/** RFC 8058 one-click endpoint for the List-Unsubscribe header. */
export function unsubscribeApiUrl(email: string, category: OptionalCategory) {
  return `${getEnv().publicOrigin}/api/notifications/preferences/unsubscribe?token=${encodeURIComponent(unsubscribeToken(email, category))}`
}
