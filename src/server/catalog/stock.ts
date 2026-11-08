import "server-only"
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm"
import { writeAudit } from "../audit"
import type { BrandActor } from "../auth/dal"
import { db, withTx, type Executor, type Tx } from "../db"
import { catalogVariants, stockHolds, stockMovements } from "../db/schema/catalog"
import { notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { catalogChanged } from "./hooks"
import { isSellable } from "./sellable"

/**
 * Stock (CATALOG contract). `on_hand` changes only together with an append-only
 * catalog_stock_movements row; `held` is the sum of active holds. available = on_hand - held.
 * Every function here takes the caller's transaction and locks the variant rows it touches
 * (FOR UPDATE, in id order) so two checkouts can't both take the last piece.
 */

type Line = { variantId: string; qty: number }
type MoveReason = "seed" | "adjustment" | "set" | "sale" | "restock" | "return" | "correction"

const DEFAULT_TTL_MIN = 15
const MAX_TTL_MIN = 120

function aggregate(lines: Line[]) {
  const m = new Map<string, number>()
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw rule("Each line needs a whole quantity above zero.")
    m.set(l.variantId, (m.get(l.variantId) ?? 0) + l.qty)
  }
  return m
}

async function lockVariants(tx: Executor, ids: string[]) {
  if (!ids.length) return []
  return tx
    .select({ id: catalogVariants.id, brandId: catalogVariants.brandId, onHand: catalogVariants.onHand, held: catalogVariants.held, productId: catalogVariants.productId, status: catalogVariants.status })
    .from(catalogVariants)
    .where(inArray(catalogVariants.id, [...ids].sort()))
    .orderBy(asc(catalogVariants.id))
    .for("update")
}

/** Inserts one movement row and moves on_hand by `delta` (never below zero: the CHECK refuses it). */
export async function moveStock(
  tx: Executor,
  input: { variantId: string; brandId: string; delta: number; reason: MoveReason; note?: string | null; refType?: string | null; refId?: string | null; actor?: { kind: string; id?: string | null } },
) {
  const [row] = await tx
    .update(catalogVariants)
    .set({ onHand: sql`${catalogVariants.onHand} + ${input.delta}`, updatedAt: new Date() })
    .where(eq(catalogVariants.id, input.variantId))
    .returning({ onHand: catalogVariants.onHand })
  if (!row) throw notFound("That variant doesn't exist.")
  await tx.insert(stockMovements).values({
    id: newId("sm"),
    variantId: input.variantId,
    brandId: input.brandId,
    delta: input.delta,
    onHandAfter: row.onHand,
    reason: input.reason,
    note: input.note?.slice(0, 200) ?? null,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    actorKind: input.actor?.kind ?? "system",
    actorId: input.actor?.id ?? null,
  })
  return row.onHand
}

/**
 * Holds stock for a checkout. Idempotent per holdKey: the same key with the same lines refreshes
 * the expiry and returns ok; with different lines the old active holds are released first. A
 * committed key returns ok without holding again. Variants that aren't sellable (unpublished,
 * hidden, archived, brand unlisted) count as available 0.
 */
export async function holdStock(tx: Tx, input: { holdKey: string; lines: Line[]; ttlMinutes?: number }): Promise<{ ok: true } | { ok: false; shortages: { variantId: string; available: number }[] }> {
  const want = aggregate(input.lines)
  const ttl = Math.min(MAX_TTL_MIN, Math.max(1, Math.floor(input.ttlMinutes ?? DEFAULT_TTL_MIN)))
  const expiresAt = new Date(Date.now() + ttl * 60_000)

  const existing = await tx.select().from(stockHolds).where(eq(stockHolds.holdKey, input.holdKey))
  if (existing.some((h) => h.status === "committed")) return { ok: true }
  const active = existing.filter((h) => h.status === "active")
  const same = active.length === want.size && active.every((h) => want.get(h.variantId) === h.qty)
  if (same && active.length) {
    await tx.update(stockHolds).set({ expiresAt }).where(and(eq(stockHolds.holdKey, input.holdKey), eq(stockHolds.status, "active")))
    return { ok: true }
  }

  const ids = [...new Set([...want.keys(), ...active.map((h) => h.variantId)])]
  const rows = await lockVariants(tx, ids)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const sellable = await isSellable(tx, [...want.keys()])
  // Stock the old holds of this key would give back.
  const giveBack = new Map(active.map((h) => [h.variantId, h.qty]))

  const shortages: { variantId: string; available: number }[] = []
  for (const [variantId, q] of want) {
    const v = byId.get(variantId)
    const available = v && sellable.has(variantId) ? v.onHand - v.held + (giveBack.get(variantId) ?? 0) : 0
    if (available < q) shortages.push({ variantId, available: Math.max(0, available) })
  }
  if (shortages.length) return { ok: false, shortages }

  // Release this key's previous holds, then hold the new lines.
  for (const h of active) {
    await tx.update(catalogVariants).set({ held: sql`${catalogVariants.held} - ${h.qty}` }).where(eq(catalogVariants.id, h.variantId))
  }
  // Rows of this key in any non-committed state are replaced (unique on hold_key, variant).
  await tx.delete(stockHolds).where(and(eq(stockHolds.holdKey, input.holdKey), inArray(stockHolds.status, ["active", "released", "expired"])))
  for (const [variantId, q] of want) {
    await tx.update(catalogVariants).set({ held: sql`${catalogVariants.held} + ${q}`, updatedAt: new Date() }).where(eq(catalogVariants.id, variantId))
    await tx.insert(stockHolds).values({ id: newId("sh"), holdKey: input.holdKey, variantId, qty: q, status: "active", expiresAt })
  }
  catalogChanged({ variants: [...want.keys()] })
  return { ok: true }
}

/**
 * Turns a key's holds into sales: on_hand and held both drop by the quantity, with a 'sale'
 * movement. Idempotent (committed rows are skipped). A hold that already expired or was released
 * (a late payment) takes stock directly; if the piece has gone meanwhile it takes what is left
 * and logs the oversell, so ORDERS can see it in the movement note.
 */
export async function commitHold(tx: Tx, holdKey: string): Promise<void> {
  const holds = await tx.select().from(stockHolds).where(eq(stockHolds.holdKey, holdKey))
  const open = holds.filter((h) => h.status !== "committed")
  if (!open.length) return
  const rows = await lockVariants(
    tx,
    open.map((h) => h.variantId),
  )
  const byId = new Map(rows.map((r) => [r.id, r]))
  const now = new Date()
  for (const h of open) {
    const v = byId.get(h.variantId)
    if (!v) continue
    let take = h.qty
    let note: string | null = null
    if (h.status === "active") {
      await tx.update(catalogVariants).set({ held: sql`${catalogVariants.held} - ${h.qty}` }).where(eq(catalogVariants.id, h.variantId))
      v.held -= h.qty
    } else {
      const available = v.onHand - v.held
      if (available < h.qty) {
        take = Math.max(0, available)
        note = `oversold by ${h.qty - take} (hold ${h.status} before payment)`
        log.warn(`[yard] catalog: hold ${holdKey} committed after it was ${h.status}; variant ${h.variantId} oversold by ${h.qty - take}`)
      }
    }
    if (take > 0) await moveStock(tx, { variantId: h.variantId, brandId: v.brandId, delta: -take, reason: "sale", note, refType: "hold", refId: holdKey })
    else await tx.insert(stockMovements).values({ id: newId("sm"), variantId: h.variantId, brandId: v.brandId, delta: 0, onHandAfter: v.onHand, reason: "sale", note, refType: "hold", refId: holdKey })
    v.onHand -= take
    await tx.update(stockHolds).set({ status: "committed", settledAt: now }).where(eq(stockHolds.id, h.id))
  }
  catalogChanged({ variants: open.map((h) => h.variantId), reindexVariants: true })
}

/** Gives a key's active holds back to available stock. Idempotent. */
export async function releaseHold(tx: Tx, holdKey: string): Promise<void> {
  const active = await tx
    .select()
    .from(stockHolds)
    .where(and(eq(stockHolds.holdKey, holdKey), eq(stockHolds.status, "active")))
  if (!active.length) return
  await lockVariants(
    tx,
    active.map((h) => h.variantId),
  )
  const now = new Date()
  for (const h of active) {
    await tx.update(catalogVariants).set({ held: sql`${catalogVariants.held} - ${h.qty}` }).where(eq(catalogVariants.id, h.variantId))
    await tx.update(stockHolds).set({ status: "released", settledAt: now }).where(eq(stockHolds.id, h.id))
  }
  catalogChanged({ variants: active.map((h) => h.variantId) })
}

/** Puts stock back (returns received, cancellations). `reason` is a free note, e.g. "return ret_123". */
export async function restock(tx: Tx, input: { variantId: string; qty: number; reason: string }): Promise<void> {
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw rule("Restock needs a whole quantity above zero.")
  const [v] = await lockVariants(tx, [input.variantId])
  if (!v) throw notFound("That variant doesn't exist.")
  const isReturn = /return/i.test(input.reason)
  await moveStock(tx, { variantId: v.id, brandId: v.brandId, delta: input.qty, reason: isReturn ? "return" : "restock", note: input.reason })
  catalogChanged({ variants: [v.id], restocked: v.onHand - v.held <= 0 ? [v.id] : [], reindexVariants: true })
}

/** Job: expires active holds past their TTL (every minute). */
export async function sweepExpiredHolds(): Promise<{ expired: number }> {
  return withTx(async (tx) => {
    const due = await tx
      .select()
      .from(stockHolds)
      .where(and(eq(stockHolds.status, "active"), lt(stockHolds.expiresAt, new Date())))
      .limit(1000)
    if (!due.length) return { expired: 0 }
    await lockVariants(
      tx,
      due.map((h) => h.variantId),
    )
    const now = new Date()
    for (const h of due) {
      await tx.update(catalogVariants).set({ held: sql`greatest(0, ${catalogVariants.held} - ${h.qty})` }).where(eq(catalogVariants.id, h.variantId))
      await tx.update(stockHolds).set({ status: "expired", settledAt: now }).where(eq(stockHolds.id, h.id))
    }
    catalogChanged({ variants: due.map((h) => h.variantId) })
    return { expired: due.length }
  })
}

/* ---------- Studio ---------- */

async function brandVariant(brandId: string, variantId: string) {
  const d = await db()
  const [v] = await d
    .select()
    .from(catalogVariants)
    .where(and(eq(catalogVariants.id, variantId), eq(catalogVariants.brandId, brandId)))
    .limit(1)
  if (!v) throw notFound("That variant isn't in your catalogue.")
  return v
}

/** Studio stock change: adjust by a delta or set an exact count. Never below what checkouts hold. */
export async function adjustStock(actor: BrandActor, variantId: string, body: { mode: "adjust" | "set"; qty: number; reason: "adjustment" | "restock" | "return" | "correction"; note?: string }, ipHash: string | null) {
  await brandVariant(actor.brandId, variantId)
  return withTx(async (tx) => {
    const [v] = await lockVariants(tx, [variantId])
    const delta = body.mode === "set" ? body.qty - v.onHand : body.qty
    if (body.mode === "set" && body.qty < 0) throw rule("Stock can't be below zero.")
    if (v.onHand + delta < v.held) throw rule(`${v.held} of these are held in checkouts right now, so stock can't go below ${v.held}.`)
    if (delta === 0) return { variantId, onHand: v.onHand, held: v.held, available: v.onHand - v.held }
    const onHand = await moveStock(tx, { variantId, brandId: v.brandId, delta, reason: body.mode === "set" ? "set" : body.reason, note: body.note ?? null, actor: { kind: "brand", id: actor.userId } })
    await writeAudit({
      actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role },
      action: "catalog.stock_changed",
      target: variantId,
      subjectType: "catalog_variant",
      subjectId: variantId,
      brandId: actor.brandId,
      ipHash,
      meta: { mode: body.mode, delta, onHand, reason: body.reason },
    })
    catalogChanged({ products: [v.productId], variants: [variantId], restocked: v.onHand - v.held <= 0 && delta > 0 ? [variantId] : [] })
    return { variantId, onHand, held: v.held, available: onHand - v.held }
  })
}

/** The movement log of one variant, newest first. */
export async function listMovements(actor: BrandActor, variantId: string, limit = 100) {
  await brandVariant(actor.brandId, variantId)
  const d = await db()
  const rows = await d
    .select()
    .from(stockMovements)
    .where(and(eq(stockMovements.variantId, variantId), eq(stockMovements.brandId, actor.brandId)))
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
    .limit(Math.min(500, Math.max(1, limit)))
  return {
    movements: rows.map((m) => ({ id: m.id, delta: m.delta, onHandAfter: m.onHandAfter, reason: m.reason, note: m.note, refType: m.refType, refId: m.refId, actorKind: m.actorKind, at: m.createdAt.toISOString() })),
  }
}
