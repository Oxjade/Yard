import "server-only"
import { and, asc, eq, inArray, isNotNull, lt } from "drizzle-orm"
import type { CountryCode } from "@/config/markets"
import { getShopper } from "../auth/dal"
import { db, withTx, type Executor } from "../db"
import { cartLines, carts } from "../db/schema/payments"
import { catalogProducts, catalogVariants } from "../db/schema/catalog"
import { notForSaleMessage } from "../catalog/sellable"
import { refuseSampleVariant, refusedSampleVariant } from "../catalog/sample-guard"
import { conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { clearAnonCartCookie, issueAnonCartCookie, readAnonCartKey } from "./cookie"
import { asCountry, asCurrency, groupByBrand, priceLines, quoteGroup, type GroupQuote, type PricedCartLine } from "./pricing"

/**
 * Server carts (v3). A signed-in shopper has one cart by customer id; an anonymous browser has one
 * by the yard_cart cookie. On sign-in the anonymous cart merges into the shopper's
 * (`mergeAnonCart`, which every cart route also runs lazily, so a merge never depends on the
 * sign-in path calling it). Carts hold variant ids and quantities only; prices are re-read from
 * CATALOG every time.
 */

export const MAX_LINES = 50
export const MAX_QTY = 20

export type CartOwner = { kind: "customer"; customerId: string } | { kind: "anon"; anonKey: string }

type CartRow = typeof carts.$inferSelect

async function findCart(d: Executor, owner: CartOwner): Promise<CartRow | null> {
  const [row] = await d
    .select()
    .from(carts)
    .where(owner.kind === "customer" ? eq(carts.customerId, owner.customerId) : eq(carts.anonKey, owner.anonKey))
    .limit(1)
  return row ?? null
}

async function createCart(d: Executor, owner: CartOwner): Promise<CartRow> {
  const [row] = await d
    .insert(carts)
    .values({ id: newId("cart"), customerId: owner.kind === "customer" ? owner.customerId : null, anonKey: owner.kind === "anon" ? owner.anonKey : null })
    .onConflictDoNothing()
    .returning()
  return row ?? (await findCart(d, owner))!
}

/**
 * The cart owner for this request. Signed in: the shopper (after merging any anonymous cart).
 * Anonymous: the cookie's cart, or, with `create`, a new cookie.
 */
export async function resolveOwner(opts: { create: boolean }): Promise<CartOwner | null> {
  const shopper = await getShopper()
  if (shopper) {
    await mergeAnonCart(shopper.userId)
    return { kind: "customer", customerId: shopper.userId }
  }
  const anonKey = await readAnonCartKey()
  if (anonKey) return { kind: "anon", anonKey }
  if (!opts.create) return null
  return { kind: "anon", anonKey: await issueAnonCartCookie() }
}

/**
 * Merges this browser's anonymous cart into the shopper's cart, then forgets the cookie.
 * Quantities add up (capped at MAX_QTY per line, MAX_LINES lines). Safe to call on every
 * request: without a valid cookie it does nothing. Exported for AUTH to call right after sign-in.
 */
export async function mergeAnonCart(customerId: string): Promise<{ merged: number }> {
  const anonKey = await readAnonCartKey()
  if (!anonKey) return { merged: 0 }
  const merged = await withTx(async (tx) => {
    const anon = await findCart(tx, { kind: "anon", anonKey })
    if (!anon) return 0
    const anonLines = await tx.select().from(cartLines).where(eq(cartLines.cartId, anon.id)).orderBy(asc(cartLines.addedAt))
    const mine = await createCart(tx, { kind: "customer", customerId })
    const existing = await tx.select().from(cartLines).where(eq(cartLines.cartId, mine.id))
    const byVariant = new Map(existing.map((l) => [l.variantId, l]))
    let count = existing.length
    let n = 0
    for (const l of anonLines) {
      // Production never carries a sample piece into the shopper's cart.
      if (refusedSampleVariant(l.variantId)) continue
      const cur = byVariant.get(l.variantId)
      if (cur) {
        await tx
          .update(cartLines)
          .set({ qty: Math.min(MAX_QTY, cur.qty + l.qty), updatedAt: new Date() })
          .where(eq(cartLines.id, cur.id))
        n++
      } else if (count < MAX_LINES) {
        await tx.insert(cartLines).values({ id: newId("cl"), cartId: mine.id, variantId: l.variantId, qty: Math.min(MAX_QTY, l.qty) })
        count++
        n++
      }
    }
    await tx.delete(carts).where(eq(carts.id, anon.id))
    await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, mine.id))
    return n
  })
  await clearAnonCartCookie()
  return { merged }
}

export const SAMPLE_LINES_REMOVED = "Pieces from our preview catalogue were removed from your cart."

/**
 * The raw lines (variant id + qty) of an owner's cart. In production a line holding a sample
 * variant id (an old cart from before the sample catalogue was switched off, or a demo-seeded
 * database) is deleted here, so neither the cart view nor checkout ever prices it;
 * `removedSample` says how many went.
 */
export async function cartLinesOf(owner: CartOwner): Promise<{ cartId: string | null; lines: { variantId: string; qty: number }[]; removedSample: number }> {
  const d = await db()
  const cart = await findCart(d, owner)
  if (!cart) return { cartId: null, lines: [], removedSample: 0 }
  const all = await d.select({ variantId: cartLines.variantId, qty: cartLines.qty }).from(cartLines).where(eq(cartLines.cartId, cart.id)).orderBy(asc(cartLines.addedAt))
  const sample = all.filter((l) => refusedSampleVariant(l.variantId)).map((l) => l.variantId)
  if (sample.length) await d.delete(cartLines).where(and(eq(cartLines.cartId, cart.id), inArray(cartLines.variantId, sample)))
  return { cartId: cart.id, lines: sample.length ? all.filter((l) => !sample.includes(l.variantId)) : all, removedSample: sample.length }
}

export type CartView = {
  id: string | null
  currency: string
  itemCount: number
  subtotalMinor: number
  lines: PricedCartLine[]
  groups: { brandId: string; variantIds: string[]; subtotalMinor: number; shipping: GroupQuote | null }[]
  /** Plain sentences about lines that need attention (sold out, fewer left than in the cart). */
  issues: string[]
  /**
   * How many sample lines this read took out of the cart (production; see cartLinesOf). The bag
   * says so once (the same notice as lines dropped from this browser's storage).
   */
  removedSample: number
  destination: { country: string; city: string | null } | null
}

/** The cart priced from CATALOG in `currency`, with per-brand shipping options when a destination is given. */
export async function viewCart(owner: CartOwner | null, opts: { currency: string; to?: string; city?: string }): Promise<CartView> {
  const currency = asCurrency(opts.currency)
  const to: CountryCode | null = opts.to ? asCountry(opts.to) : null
  const { cartId, lines: raw, removedSample } = owner ? await cartLinesOf(owner) : { cartId: null, lines: [], removedSample: 0 }
  const lines = await priceLines(raw, currency)
  const groups = groupByBrand(lines)
  const now = Date.now()
  const quotes = to ? await Promise.all(groups.map((g) => quoteGroup(g, to, opts.city ?? null, currency, now))) : []
  const issues: string[] = removedSample ? [SAMPLE_LINES_REMOVED] : []
  for (const l of lines) {
    if (l.unavailableReason === "not_for_sale") issues.push(`${l.title ?? "A piece in your cart"}: ${notForSaleMessage(l.brandName)}`)
    else if (l.status === "unavailable") issues.push(`${l.title ?? "A piece in your cart"} isn't available any more.`)
    else if (l.status === "short") issues.push(`Only ${l.available} of ${l.title ?? "a piece"}${l.variantLabel ? ` (${l.variantLabel})` : ""} left.`)
  }
  return {
    id: cartId,
    currency,
    itemCount: lines.filter((l) => l.status !== "unavailable").reduce((s, l) => s + l.qty, 0),
    subtotalMinor: groups.reduce((s, g) => s + g.subtotalMinor, 0),
    lines,
    groups: groups.map((g, i) => ({ brandId: g.brandId, variantIds: g.lines.map((l) => l.variantId), subtotalMinor: g.subtotalMinor, shipping: quotes[i] ?? null })),
    issues,
    removedSample,
    destination: to ? { country: to, city: opts.city?.trim() || null } : null,
  }
}

async function checkSellable(variantId: string, qty: number) {
  // Production: a sample piece is refused by identity, even if a demo-seeded database holds it.
  refuseSampleVariant(variantId)
  const [line] = await priceLines([{ variantId, qty }], "USD")
  // Unknown or no longer sold (CATALOG leaves it out) → 404; sold out or short → 409.
  if (!line || !line.productId) throw notFound("That piece isn't available.")
  // Founding brands that aren't selling yet: refused here, whatever the client shows.
  if (line.unavailableReason === "not_for_sale") throw rule(notForSaleMessage(line.brandName))
  if (line.available <= 0) throw conflict("That piece is sold out.")
  if (line.available < qty) throw conflict(line.available === 1 ? "Only 1 left." : `Only ${line.available} left.`)
}

/** Adds `qty` of a variant (adds to an existing line). Refuses more than CATALOG has available. */
export async function addLine(owner: CartOwner, variantId: string, qty: number) {
  const d = await db()
  const cart = await findCart(d, owner)
  const [cur] = cart ? await d.select().from(cartLines).where(and(eq(cartLines.cartId, cart.id), eq(cartLines.variantId, variantId))).limit(1) : []
  const next = (cur?.qty ?? 0) + qty
  if (next > MAX_QTY) throw rule(`You can add up to ${MAX_QTY} of one piece.`)
  await checkSellable(variantId, next)
  await withTx(async (tx) => {
    const c = cart ?? (await createCart(tx, owner))
    if (!cur) {
      const n = await tx.$count(cartLines, eq(cartLines.cartId, c.id))
      if (n >= MAX_LINES) throw rule(`Your cart holds up to ${MAX_LINES} different pieces.`)
    }
    await tx
      .insert(cartLines)
      .values({ id: newId("cl"), cartId: c.id, variantId, qty: next })
      .onConflictDoUpdate({ target: [cartLines.cartId, cartLines.variantId], set: { qty: next, updatedAt: new Date() } })
    await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, c.id))
  })
}

/** Sets a line's quantity (0 removes it). */
export async function setLine(owner: CartOwner, variantId: string, qty: number) {
  if (qty === 0) return removeLine(owner, variantId)
  refuseSampleVariant(variantId)
  const d = await db()
  const cart = await findCart(d, owner)
  if (!cart) throw notFound("That piece isn't in your cart.")
  const [cur] = await d.select().from(cartLines).where(and(eq(cartLines.cartId, cart.id), eq(cartLines.variantId, variantId))).limit(1)
  if (!cur) throw notFound("That piece isn't in your cart.")
  // Lowering a quantity is always allowed, even when stock dropped below it.
  if (qty > cur.qty) await checkSellable(variantId, qty)
  await withTx(async (tx) => {
    await tx.update(cartLines).set({ qty, updatedAt: new Date() }).where(eq(cartLines.id, cur.id))
    await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cart.id))
  })
}

export async function removeLine(owner: CartOwner, variantId: string) {
  const d = await db()
  const cart = await findCart(d, owner)
  if (!cart) return
  await d.delete(cartLines).where(and(eq(cartLines.cartId, cart.id), eq(cartLines.variantId, variantId)))
}

export async function clearCart(owner: CartOwner) {
  const d = await db()
  const cart = await findCart(d, owner)
  if (cart) await d.delete(cartLines).where(eq(cartLines.cartId, cart.id))
}

/** Removes purchased variants from a shopper's cart (inside the payment transaction). */
export async function removePurchased(tx: Executor, customerId: string, variantIds: string[]) {
  if (!variantIds.length) return
  const cart = await findCart(tx, { kind: "customer", customerId })
  if (cart) await tx.delete(cartLines).where(and(eq(cartLines.cartId, cart.id), inArray(cartLines.variantId, variantIds)))
}

/** Job: deletes anonymous carts untouched for 60 days. */
export async function purgeStaleCarts() {
  const d = await db()
  const cutoff = new Date(Date.now() - 60 * 24 * 3600_000)
  const rows = await d
    .delete(carts)
    .where(and(isNotNull(carts.anonKey), lt(carts.updatedAt, cutoff)))
    .returning({ id: carts.id })
  return { carts: rows.length }
}

/** AUTH erasure hook (src/server/auth/erasure.ts): the shopper's server cart goes (lines cascade). */
export async function eraseCustomerData(tx: Executor, userId: string): Promise<{ erased: number }> {
  const rows = await tx.delete(carts).where(eq(carts.customerId, userId)).returning({ id: carts.id })
  return { erased: rows.length }
}

/**
 * DEVELOPMENT ONLY (POST /api/cart/dev): puts a line in the cart without the sellable check, so the
 * acceptance kits can prove checkout refuses a line that slipped past the cart (a founding brand
 * that isn't selling). Kit products only (title starting t_v3_); the route 404s in production.
 */
export async function devForceLine(owner: CartOwner, variantId: string, qty: number) {
  const d = await db()
  const [v] = await d
    .select({ title: catalogProducts.title })
    .from(catalogVariants)
    .innerJoin(catalogProducts, eq(catalogProducts.id, catalogVariants.productId))
    .where(eq(catalogVariants.id, variantId))
    .limit(1)
  if (!v || !v.title.startsWith("t_v3_")) throw notFound("Only kit products (t_v3_) can be forced into a cart.")
  await withTx(async (tx) => {
    const c = (await findCart(tx, owner)) ?? (await createCart(tx, owner))
    await tx
      .insert(cartLines)
      .values({ id: newId("cl"), cartId: c.id, variantId, qty })
      .onConflictDoUpdate({ target: [cartLines.cartId, cartLines.variantId], set: { qty, updatedAt: new Date() } })
  })
}
