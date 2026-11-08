import "server-only"
import { and, eq, gt, inArray, ne, notInArray, or, sql } from "drizzle-orm"
import { db, type Executor, type Tx } from "../db"
import { shopperFollows } from "../db/schema"
import { dropClaims, dropEntries, dropItems, drops } from "../db/schema/engagement"
import { newId } from "../ids"

/**
 * Server-side drop rules for checkout (contract: checkDropLimit). A variant that belongs to a
 * scheduled or live drop can only be bought:
 *  - from starts_at (early_access: from early_access_at by shoppers who followed the brand before
 *    early_access_at), and before ends_at;
 *  - in a draw drop, only by a winner inside their purchase window;
 *  - up to limit_per_customer units per drop, counting units already claimed in other open
 *    checkouts (pending, not expired) and paid ones (confirmed).
 * Pending claims are written when CHECKOUT passes `checkoutId` and `lines`; CHECKOUT confirms them
 * on payment (confirmDropClaims) or releases them on failure (releaseDropClaims); unconfirmed
 * claims expire after CLAIM_TTL_MIN.
 */
export const CLAIM_TTL_MIN = 30

export type DropLimitInput = {
  customerId: string
  variantIds: string[]
  /** Quantities per variant (default 1 each). */
  lines?: { variantId: string; qty: number }[]
  /** When given with `lines`, the units are claimed for this checkout (replacing its earlier claims). */
  checkoutId?: string
}

export type DropViolation = { dropId: string; dropName: string; variantId: string | null; code: "not_started" | "ended" | "not_winner" | "window_closed" | "limit" | "cancelled"; message: string }

export type DropLimitResult = { ok: true; dropIds: string[] } | { ok: false; dropIds: string[]; violations: DropViolation[]; message: string }

type DropRow = typeof drops.$inferSelect

const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z")

/** Whether the customer may buy from this drop right now (ignoring quantities). */
export async function accessFor(ex: Executor, drop: DropRow, customerId: string, now = new Date()): Promise<{ ok: true } | { ok: false; code: DropViolation["code"]; message: string }> {
  if (drop.status === "cancelled") return { ok: false, code: "cancelled", message: `${drop.name} was cancelled.` }
  if (now >= drop.endsAt || drop.status === "ended") return { ok: false, code: "ended", message: `${drop.name} has ended.` }
  if (drop.access === "draw") {
    const [entry] = await ex.select().from(dropEntries).where(and(eq(dropEntries.dropId, drop.id), eq(dropEntries.userId, customerId))).limit(1)
    if (!entry || (entry.status !== "won" && entry.status !== "purchased")) return { ok: false, code: "not_winner", message: `Only drawn winners can buy ${drop.name}.` }
    if (entry.status === "won" && (!entry.windowOpensAt || !entry.windowEndsAt || now < entry.windowOpensAt || now >= entry.windowEndsAt))
      return { ok: false, code: "window_closed", message: entry.windowOpensAt && now < entry.windowOpensAt ? `Your purchase window for ${drop.name} opens at ${fmt(entry.windowOpensAt)}.` : `Your purchase window for ${drop.name} has closed.` }
    return { ok: true }
  }
  if (now >= drop.startsAt && drop.status !== "draft") return { ok: true }
  if (drop.access === "early_access" && drop.earlyAccessAt && now >= drop.earlyAccessAt && drop.status !== "draft") {
    const [f] = await ex
      .select({ at: shopperFollows.createdAt })
      .from(shopperFollows)
      .where(and(eq(shopperFollows.userId, customerId), eq(shopperFollows.brandId, drop.brandId)))
      .limit(1)
    if (f && f.at < drop.earlyAccessAt) return { ok: true }
    return { ok: false, code: "not_started", message: `${drop.name} is in early access for followers until ${fmt(drop.startsAt)}.` }
  }
  return { ok: false, code: "not_started", message: `${drop.name} releases at ${fmt(drop.startsAt)}.` }
}

/** Units of a drop the customer holds: confirmed + unexpired pending, excluding one checkout. */
export async function claimedUnits(ex: Executor, dropId: string, customerId: string, excludeCheckoutId?: string, now = new Date()) {
  const [row] = await ex
    .select({ n: sql<number>`coalesce(sum(${dropClaims.qty}), 0)::int` })
    .from(dropClaims)
    .where(
      and(
        eq(dropClaims.dropId, dropId),
        eq(dropClaims.userId, customerId),
        or(eq(dropClaims.status, "confirmed"), and(eq(dropClaims.status, "pending"), gt(dropClaims.expiresAt, now))),
        excludeCheckoutId ? ne(dropClaims.checkoutId, excludeCheckoutId) : undefined,
      ),
    )
  return Number(row?.n ?? 0)
}

/** Drops (scheduled, live, or draft) that currently govern these variants. */
async function governingDrops(ex: Executor, variantIds: string[], now: Date) {
  if (!variantIds.length) return []
  return ex
    .select({ drop: drops, variantId: dropItems.variantId })
    .from(dropItems)
    .innerJoin(drops, eq(drops.id, dropItems.dropId))
    .where(and(inArray(dropItems.variantId, variantIds), notInArray(drops.status, ["draft", "cancelled"]), or(gt(drops.endsAt, now), eq(drops.status, "live"))))
}

/**
 * Contract: checks (and with checkoutId + lines, claims) drop limits for a checkout. Call inside
 * CHECKOUT's transaction before holding stock. Returns violations instead of throwing; variants
 * in no drop always pass.
 */
export async function checkDropLimit(tx: Tx | Executor, input: DropLimitInput): Promise<DropLimitResult> {
  const now = new Date()
  const qtyBy = new Map<string, number>()
  if (input.lines?.length) for (const l of input.lines) qtyBy.set(l.variantId, (qtyBy.get(l.variantId) ?? 0) + Math.max(0, Math.floor(l.qty)))
  for (const v of input.variantIds) if (!qtyBy.has(v)) qtyBy.set(v, 1)
  const variantIds = [...qtyBy.keys()]
  const rows = await governingDrops(tx, variantIds, now)
  const byDrop = new Map<string, { drop: DropRow; variants: string[] }>()
  for (const r of rows) {
    const e = byDrop.get(r.drop.id) ?? { drop: r.drop, variants: [] }
    e.variants.push(r.variantId)
    byDrop.set(r.drop.id, e)
  }
  const violations: DropViolation[] = []
  for (const { drop, variants } of byDrop.values()) {
    const access = await accessFor(tx, drop, input.customerId, now)
    if (!access.ok) {
      violations.push({ dropId: drop.id, dropName: drop.name, variantId: null, code: access.code, message: access.message })
      continue
    }
    const wanted = variants.reduce((n, v) => n + (qtyBy.get(v) ?? 0), 0)
    const held = await claimedUnits(tx, drop.id, input.customerId, input.checkoutId, now)
    if (held + wanted > drop.limitPerCustomer) {
      const left = Math.max(0, drop.limitPerCustomer - held)
      violations.push({
        dropId: drop.id,
        dropName: drop.name,
        variantId: variants[0] ?? null,
        code: "limit",
        message: left ? `${drop.name} is limited to ${drop.limitPerCustomer} per customer: you can add ${left} more.` : `${drop.name} is limited to ${drop.limitPerCustomer} per customer and you've reached it.`,
      })
    }
  }
  const dropIds = [...byDrop.keys()]
  if (violations.length) return { ok: false, dropIds, violations, message: violations[0].message }
  if (input.checkoutId && input.lines?.length && byDrop.size) {
    await tx.delete(dropClaims).where(and(eq(dropClaims.checkoutId, input.checkoutId), eq(dropClaims.status, "pending")))
    const expiresAt = new Date(now.getTime() + CLAIM_TTL_MIN * 60_000)
    const values = [...byDrop.values()].flatMap(({ drop, variants }) =>
      variants.filter((v) => (qtyBy.get(v) ?? 0) > 0).map((v) => ({ id: newId("dcl"), dropId: drop.id, userId: input.customerId, variantId: v, qty: qtyBy.get(v)!, checkoutId: input.checkoutId!, status: "pending" as const, expiresAt })),
    )
    if (values.length) await tx.insert(dropClaims).values(values).onConflictDoNothing()
  }
  return { ok: true, dropIds }
}

/** CHECKOUT calls this when the checkout is paid: its claims count for good, and a draw winner's entry becomes 'purchased'. */
export async function confirmDropClaims(tx: Tx | Executor, checkoutId: string): Promise<void> {
  const rows = await tx.update(dropClaims).set({ status: "confirmed" }).where(and(eq(dropClaims.checkoutId, checkoutId), inArray(dropClaims.status, ["pending", "released"]))).returning({ dropId: dropClaims.dropId, userId: dropClaims.userId })
  for (const r of new Map(rows.map((x) => [`${x.dropId}:${x.userId}`, x])).values()) {
    await tx
      .update(dropEntries)
      .set({ status: "purchased", decidedAt: new Date() })
      .where(and(eq(dropEntries.dropId, r.dropId), eq(dropEntries.userId, r.userId), eq(dropEntries.status, "won")))
  }
}

/** CHECKOUT calls this when the checkout fails or is abandoned: its pending claims stop counting. */
export async function releaseDropClaims(tx: Tx | Executor, checkoutId: string): Promise<void> {
  await tx.update(dropClaims).set({ status: "released" }).where(and(eq(dropClaims.checkoutId, checkoutId), eq(dropClaims.status, "pending")))
}

/** Marks expired pending claims released (job). */
export async function sweepExpiredClaims(): Promise<number> {
  const d = await db()
  const rows = await d
    .update(dropClaims)
    .set({ status: "released" })
    .where(and(eq(dropClaims.status, "pending"), sql`${dropClaims.expiresAt} <= now()`))
    .returning({ id: dropClaims.id })
  return rows.length
}
