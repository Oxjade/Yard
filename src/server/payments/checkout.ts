import "server-only"
import { and, desc, eq, inArray, lt, ne } from "drizzle-orm"
import { z } from "zod"
import { safeId, safeLine } from "@/lib/api/contracts/common"
import { SHIPPING_SERVICES } from "@/lib/api/contracts/enums"
import type { ShopperActor } from "../auth/dal"
import { checkDropLimit, releaseDropClaims } from "../drops"
import { cartLinesOf, SAMPLE_LINES_REMOVED } from "../cart"
import { asCountry, asCurrency, groupByBrand, priceLines, quoteGroup } from "../cart/pricing"
import { holdStock, releaseHold } from "../catalog"
import { notForSaleMessage } from "../catalog/sellable"
import { db, withTx, type Executor, type Tx } from "../db"
import { checkouts, payments } from "../db/schema/payments"
import { HttpError, badRequest, busy, conflict, notConfigured, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { createOrdersFromCheckout, markCheckoutPaymentFailed } from "../orders"
import { sha256hex } from "../security/crypto"
import { chargeCurrencies, PAYMENTS_OFF_MESSAGE, paymentsConfig } from "./config"
import { recordProviderEvent, processEvent } from "./events"
import { bachsCorridorsFor } from "./bachs-core"
import { getProvider, ProviderError } from "./providers"
import { randomBytes } from "node:crypto"

/* ---------- Request contracts ---------- */

export const PAYMENT_METHODS = ["card", "bank_transfer", "ussd", "mobile_money"] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * Paystack channels for the method the shopper chose, sent only when Paystack takes that channel
 * in the charge currency for that country: bank transfer and USSD in NGN (Nigeria), mobile money in
 * GHS (Ghana) and KES (Kenya). Card works in every charge currency. Anything else — South Africa's
 * Instant EFT, whose channel name isn't confirmed here, or a method that doesn't fit the currency —
 * leaves Paystack's page unrestricted rather than risk a rejected initialise. Mirrors the
 * checkout's paymentMethodsFor (src/components/market/checkout/rules.ts).
 */
export function channelsFor(method: PaymentMethod | undefined, country: string, currency: string): string[] | undefined {
  if (!method) return undefined
  if (method === "card") return ["card"]
  const fits =
    method === "bank_transfer" || method === "ussd"
      ? country === "NG" && currency === "NGN"
      : method === "mobile_money"
        ? (country === "GH" && currency === "GHS") || (country === "KE" && currency === "KES")
        : false
  return fits ? [method] : undefined
}

/**
 * What limits the provider's hosted page to the method the shopper chose: Paystack channels
 * (channelsFor), or Bachs `payment_method_types` corridors (card: NGN_CARD / USD_CARD; bank
 * transfer: NGN_BANK_TRANSFER; mobile money: MOMO_GHS / MOMO_KES). A method that doesn't fit the
 * charge currency leaves the page unrestricted.
 */
function providerChannelsFor(body: Pick<StartCheckoutBody, "paymentMethod" | "shipTo" | "currency">): string[] | undefined {
  if (paymentsConfig().provider === "bachs") return bachsCorridorsFor(body.paymentMethod, body.currency)
  return channelsFor(body.paymentMethod, body.shipTo.country, body.currency)
}

/** A payment a provider has opened a hosted page for (so it can be asked about), on the provider this deployment uses. */
function isLivePayment(p: PaymentRow | null): p is PaymentRow {
  return !!p && (p.provider === "paystack" || p.provider === "bachs") && p.status === "initialized" && !!p.accessCode
}

/** "Paystack" / "Bachs", for logs. */
const providerLabel = (kind: string) => (kind === "bachs" ? "Bachs" : kind === "paystack" ? "Paystack" : kind)

const country = z.string().regex(/^[A-Z]{2}$/, { error: "Use a two-letter country code." })

export const startCheckoutBody = z
  .object({
    /** The checkout draft's key: a retry with the same key returns the same checkout. */
    idempotencyKey: z
      .string()
      .min(8)
      .max(80)
      .regex(/^[\w-]+$/, { error: "That key isn't valid." }),
    currency: z.string().regex(/^[A-Z]{3}$/, { error: "Use a three-letter currency code." }),
    shipTo: z
      .object({
        name: safeLine().trim().min(1).max(80),
        line1: safeLine().trim().min(1).max(120),
        line2: safeLine().trim().max(120).optional(),
        city: safeLine().trim().min(1).max(60),
        region: safeLine().trim().max(60).optional(),
        postalCode: safeLine().trim().max(20).optional(),
        country,
        phone: z
          .string()
          .trim()
          .regex(/^\+?[0-9 ()-]{6,24}$/, { error: "Enter a phone number." })
          .optional(),
      })
      .strict(),
    /** One delivery choice per brand in the cart. */
    shipping: z
      .array(z.object({ brandId: safeId(), service: z.enum(SHIPPING_SERVICES) }).strict())
      .min(1)
      .max(20),
    /** The total the shopper was shown. When sent and different, the checkout is refused with 409 and the new totals. */
    expectedTotalMinor: z.number().int().nonnegative().optional(),
    /**
     * How the shopper chose to pay. Paystack's page offers only that channel; the card number,
     * expiry and code are typed there, never sent to Yard. Not part of the request hash: a retry
     * after choosing another method picks up the same checkout.
     */
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  })
  .strict()
export type StartCheckoutBody = z.infer<typeof startCheckoutBody>

export const stubPayBody = z.object({ outcome: z.enum(["success", "failed"]) }).strict()

/* ---------- Views ---------- */

type CheckoutRow = typeof checkouts.$inferSelect
type PaymentRow = typeof payments.$inferSelect

export type CheckoutView = {
  id: string
  status: CheckoutRow["status"]
  reference: string | null
  currency: string
  subtotalMinor: number
  shippingMinor: number
  totalMinor: number
  orderIds: string[]
  groups: unknown
  createdAt: string
  expiresAt: string
  paidAt: string | null
  failureReason: string | null
  payment: {
    id: string
    provider: "paystack" | "bachs" | "stub"
    status: PaymentRow["status"]
    reference: string
    authorizationUrl: string | null
    accessCode: string | null
    publicKey: string | null
    /** True for the stub: nothing is charged and the page must say so. */
    stub: boolean
    message: string | null
    /** How the payment was made, as the provider reported it once paid ("card", "bank_transfer", "ussd"…). */
    channel: string | null
    /**
     * Only on a verify answer: what Paystack itself said while the payment is still pending.
     * "abandoned" = the shopper left Paystack's page (or cancelled) without paying; nothing was charged.
     */
    providerStatus?: string | null
  } | null
}

function toView(c: CheckoutRow, p: PaymentRow | null): CheckoutView {
  const cfg = paymentsConfig()
  const stub = p?.provider === "stub"
  return {
    id: c.id,
    status: c.status,
    reference: c.reference,
    currency: c.currency,
    subtotalMinor: c.subtotalMinor,
    shippingMinor: c.shippingMinor,
    totalMinor: c.totalMinor,
    orderIds: c.orderIds,
    groups: c.groups,
    createdAt: c.createdAt.toISOString(),
    expiresAt: c.expiresAt.toISOString(),
    paidAt: c.paidAt?.toISOString() ?? null,
    failureReason: c.failureReason,
    payment: p
      ? {
          id: p.id,
          provider: p.provider as "paystack" | "bachs" | "stub",
          status: p.status,
          reference: p.reference,
          authorizationUrl: p.status === "initialized" ? p.authorizationUrl : null,
          accessCode: p.status === "initialized" ? p.accessCode : null,
          publicKey: p.provider === "paystack" ? cfg.publicKey : null,
          stub,
          message: stub
            ? "Payments aren't connected in this environment. Nothing will be charged, and this order won't be paid."
            : p.initError && p.status === "initialized" && !p.authorizationUrl
              ? "We couldn't reach the payment provider. Nothing was charged. Try again."
              : null,
          channel: p.channel ?? null,
        }
      : null,
  }
}

async function latestPayment(d: Executor, checkoutId: string) {
  const [p] = await d.select().from(payments).where(eq(payments.checkoutId, checkoutId)).orderBy(desc(payments.createdAt)).limit(1)
  return p ?? null
}

/** A shopper's own checkout (404 for anyone else's). */
export async function getCheckout(actor: ShopperActor, checkoutId: string): Promise<CheckoutView> {
  const d = await db()
  const [c] = await d
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.id, checkoutId), eq(checkouts.customerId, actor.userId)))
    .limit(1)
  if (!c) throw notFound()
  return toView(c, await latestPayment(d, c.id))
}

/* ---------- Start ---------- */

/** 503 not_configured "Payments open soon…" while YARD_PAYMENTS=off. */
export function assertPaymentsOpen() {
  if (paymentsConfig().provider === "off") throw notConfigured(PAYMENTS_OFF_MESSAGE)
}

/** Paystack reference: letters, digits, '-', '.', '=' only. */
const paymentReference = () => `yp-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`

function requestHash(body: StartCheckoutBody) {
  const norm = { ...body, expectedTotalMinor: undefined, paymentMethod: undefined, shipping: [...body.shipping].sort((a, b) => a.brandId.localeCompare(b.brandId)) }
  return sha256hex(JSON.stringify(norm))
}

/**
 * Starts (or resumes) a checkout for the shopper's server cart. Idempotent per
 * (shopper, idempotencyKey): a retry returns the same checkout, and re-tries the provider
 * initialise when the first one didn't reach Paystack. Steps: re-price from CATALOG → quote
 * shipping per brand → [tx: checkout row, drop limits, stock hold, ORDERS.createOrdersFromCheckout,
 * payment row] → provider initialise outside the transaction.
 */
export async function startCheckout(actor: ShopperActor, body: StartCheckoutBody): Promise<{ status: 200 | 201; view: CheckoutView }> {
  // Payments off (no provider connected): refuse before anything is read or written, so no order,
  // stock hold or payment row exists that nobody can pay for.
  assertPaymentsOpen()
  const hash = requestHash(body)
  const existing = await findByKey(actor.userId, body.idempotencyKey)
  if (existing) {
    if (existing.requestHash !== hash) throw conflict("This checkout was already started with different details. Reload and try again.")
    return { status: 200, view: await ensureInitialized(actor, existing, providerChannelsFor(body)) }
  }

  const currency = asCurrency(body.currency)
  // Only what this Paystack account takes: any other currency would create orders and hold stock
  // for a payment Paystack then refuses on every retry.
  const allowed = chargeCurrencies()
  if (!(allowed as string[]).includes(currency)) {
    throw new HttpError(422, "rule", `Checkout can only charge in ${allowed.join(", ")} right now. Reload the checkout to pay in ${allowed[0]}.`, { currency: `Choose ${allowed.join(" or ")}.` })
  }
  const to = asCountry(body.shipTo.country)

  // 1. Re-price from CATALOG.
  const { cartId, lines: raw, removedSample } = await cartLinesOf({ kind: "customer", customerId: actor.userId })
  // Production: sample pieces were just taken out of the cart (cartLinesOf); never charge for what's left unseen.
  if (removedSample) throw new HttpError(409, "conflict", `${SAMPLE_LINES_REMOVED} Check your cart and try again.`, { lines: SAMPLE_LINES_REMOVED })
  if (!raw.length) throw rule("Your cart is empty.")
  const lines = await priceLines(raw, currency)
  const problems: Record<string, string> = {}
  for (const l of lines) {
    if (l.unavailableReason === "not_for_sale") problems[`lines.${l.variantId}`] = `${notForSaleMessage(l.brandName)} Remove it to continue.`
    else if (l.status === "unavailable") problems[`lines.${l.variantId}`] = `${l.title ?? "This piece"} isn't available any more. Remove it to continue.`
    else if (l.status === "short") problems[`lines.${l.variantId}`] = `Only ${l.available} left.`
  }
  if (Object.keys(problems).length) throw new HttpError(409, "conflict", "Some pieces in your cart changed. Check your cart and try again.", problems)

  // 2. Shipping per brand, through the shipping engine.
  const groups = groupByBrand(lines)
  const choice = new Map(body.shipping.map((s) => [s.brandId, s.service]))
  const fields: Record<string, string> = {}
  for (const g of groups) if (!choice.has(g.brandId)) fields[`shipping.${g.brandId}`] = "Choose a delivery option for this brand."
  for (const s of body.shipping) if (!groups.some((g) => g.brandId === s.brandId)) fields[`shipping.${s.brandId}`] = "This brand isn't in your cart."
  if (Object.keys(fields).length) throw badRequest(fields)

  const now = Date.now()
  const priced = await Promise.all(
    groups.map(async (g) => {
      const q = await quoteGroup(g, to, body.shipTo.city, currency, now)
      const service = choice.get(g.brandId)!
      const option = q.options.find((o) => o.service === service && o.available)
      if (!option) throw new HttpError(409, "conflict", "A delivery option changed. Choose again.", { [`shipping.${g.brandId}`]: q.reason ?? "This delivery option isn't available to your address." })
      const subtotalMinor = g.subtotalMinor
      return {
        brandId: g.brandId,
        brandName: q.brandName,
        lines: g.lines.map((l) => ({ variantId: l.variantId, productId: l.productId!, title: l.variantLabel ? `${l.title ?? ""} — ${l.variantLabel}` : (l.title ?? ""), qty: l.qty, unitMinor: l.unitMinor })),
        shippingMinor: option.priceMinor,
        shippingService: service,
        subtotalMinor,
        totalMinor: subtotalMinor + option.priceMinor,
      }
    }),
  )
  const subtotalMinor = priced.reduce((s, g) => s + g.subtotalMinor, 0)
  const shippingMinor = priced.reduce((s, g) => s + g.shippingMinor, 0)
  const totalMinor = subtotalMinor + shippingMinor
  if (totalMinor <= 0) throw rule("There's nothing to pay for in this cart.")
  if (body.expectedTotalMinor !== undefined && body.expectedTotalMinor !== totalMinor) {
    throw new HttpError(409, "conflict", "Prices or delivery changed since you last looked. Check the new total and try again.", { expectedTotalMinor: String(totalMinor) })
  }

  // One live checkout per shopper: earlier unpaid checkouts are replaced (below), so one account
  // can't stack stock holds across many idempotency keys. A live payment page is asked first, so a
  // checkout the shopper just paid is never replaced.
  await settleLivePendingCheckouts(actor.userId)

  // 3. The money records, in one transaction.
  const cfg = paymentsConfig()
  const provider = getProvider()
  const checkoutId = newId("co")
  const created = await withTx(async (tx) => {
    const [row] = await tx
      .insert(checkouts)
      .values({
        id: checkoutId,
        customerId: actor.userId,
        idempotencyKey: body.idempotencyKey,
        requestHash: hash,
        currency,
        subtotalMinor,
        shippingMinor,
        totalMinor,
        holdKey: checkoutId,
        groups: priced,
        shipTo: body.shipTo,
        cartId,
        expiresAt: new Date(now + cfg.holdMinutes * 60_000),
      })
      .onConflictDoNothing()
      .returning()
    if (!row) return null // a concurrent request with the same key won

    // Replace the shopper's other unpaid checkouts before holding stock: their holds and drop claims
    // are released, so the shopper's holds never add up across checkouts.
    await replacePendingCheckouts(tx, actor.userId, checkoutId)

    // Drop rules (ENGAGEMENT): checks access and per-customer limits, and claims the units for this checkout.
    const drop = await checkDropLimit(tx, { customerId: actor.userId, variantIds: lines.map((l) => l.variantId), lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })), checkoutId })
    if (!drop.ok) {
      const f: Record<string, string> = {}
      for (const v of drop.violations) if (v.variantId) f[`lines.${v.variantId}`] = v.message
      throw new HttpError(422, "rule", drop.message, Object.keys(f).length ? f : undefined)
    }

    const hold = await holdStock(tx, { holdKey: checkoutId, lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })), ttlMinutes: cfg.holdMinutes + 5 })
    if (!hold.ok) {
      const f: Record<string, string> = {}
      for (const s of hold.shortages) f[`lines.${s.variantId}`] = s.available > 0 ? `Only ${s.available} left.` : "Sold out."
      throw new HttpError(409, "conflict", "Some pieces sold out while you were checking out.", f)
    }

    const orders = await createOrdersFromCheckout(tx, {
      checkoutId,
      customerId: actor.userId,
      currency,
      groups: priced.map(({ brandName: _n, ...g }) => g),
      shipTo: body.shipTo,
    })
    const [c] = await tx.update(checkouts).set({ orderIds: orders.orderIds, reference: orders.reference, updatedAt: new Date() }).where(eq(checkouts.id, checkoutId)).returning()
    await tx.insert(payments).values({
      id: newId("pay"),
      checkoutId,
      customerId: actor.userId,
      provider: provider.kind,
      reference: paymentReference(),
      amountMinor: totalMinor,
      currency,
      splitCode: splitCodeFor(priced.map((g) => g.brandId)),
    })
    return c
  })
  if (!created) {
    const again = await findByKey(actor.userId, body.idempotencyKey)
    if (!again) throw busy()
    if (again.requestHash !== hash) throw conflict("This checkout was already started with different details. Reload and try again.")
    return { status: 200, view: await ensureInitialized(actor, again, providerChannelsFor(body)) }
  }
  return { status: 201, view: await ensureInitialized(actor, created, providerChannelsFor(body)) }
}

const REPLACED = "Replaced by a newer checkout before payment"

/** Verifies the shopper's pending checkouts that have a live payment page (outside a transaction). */
async function settleLivePendingCheckouts(customerId: string) {
  const d = await db()
  const pending = await d.select({ id: checkouts.id }).from(checkouts).where(and(eq(checkouts.customerId, customerId), eq(checkouts.status, "pending_payment")))
  for (const c of pending) {
    const p = await latestPayment(d, c.id)
    if (isLivePayment(p)) await verifyPaymentReference(p.reference) // busy (503) when Paystack can't answer
  }
}

/** In the new checkout's transaction: expires the shopper's other pending checkouts and frees their holds. */
async function replacePendingCheckouts(tx: Tx, customerId: string, keepId: string) {
  const others = await tx
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.customerId, customerId), eq(checkouts.status, "pending_payment"), ne(checkouts.id, keepId)))
  for (const cur of others) {
    await tx
      .update(payments)
      .set({ status: "abandoned", failureReason: REPLACED, updatedAt: new Date() })
      .where(and(eq(payments.checkoutId, cur.id), inArray(payments.status, ["initialized"])))
    await tx.update(checkouts).set({ status: "expired", failureReason: REPLACED, updatedAt: new Date() }).where(eq(checkouts.id, cur.id))
    await releaseHold(tx, cur.holdKey)
    await releaseDropClaims(tx, cur.id)
    await markCheckoutPaymentFailed(tx, { checkoutId: cur.id, reason: "replaced by a newer checkout" })
  }
}

async function findByKey(customerId: string, key: string) {
  const d = await db()
  const [c] = await d
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.customerId, customerId), eq(checkouts.idempotencyKey, key)))
    .limit(1)
  return c ?? null
}

/**
 * SPLIT / SUBACCOUNT — STUBBED. With PAYSTACK_SPLIT=subaccount Yard would pass each brand's
 * Paystack subaccount (or a multi-split code) at initialise. Brands have no subaccounts yet, so
 * this returns null and every charge settles to the platform balance; LEDGER pays brands out.
 */
function splitCodeFor(brandIds: string[]): string | null {
  if (paymentsConfig().split === "subaccount") log.once("payments-split-stub", "warn", `[yard] PAYSTACK_SPLIT=subaccount is set but split payments are stubbed; ${brandIds.length} brand(s) settle to the platform balance.`)
  return null
}

/**
 * Makes sure the live payment has a provider page (initialise outside any transaction). `channels`
 * limits Paystack's page to the method the shopper chose; it only matters on the first initialise.
 */
async function ensureInitialized(actor: ShopperActor, c: CheckoutRow, channels?: string[]): Promise<CheckoutView> {
  assertPaymentsOpen()
  const d = await db()
  const p = await latestPayment(d, c.id)
  if (!p || c.status !== "pending_payment" || p.status !== "initialized" || p.provider === "stub" || p.accessCode) return toView(c, p)
  const provider = getProvider()
  // A payment opened under another provider (the deployment switched) is never sent to this one.
  if (provider.kind !== p.provider) return toView(c, p)
  try {
    const r = await provider.initialize({
      reference: p.reference,
      email: actor.email,
      amountMinor: p.amountMinor,
      currency: p.currency,
      callbackUrl: paymentsConfig().callbackUrl(c.id),
      metadata: { checkoutId: c.id, paymentId: p.id, reference: c.reference ?? "" },
      splitCode: p.splitCode,
      channels,
      // Bachs: a retried create returns the same session; the hosted page lasts as long as the stock hold.
      idempotencyKey: `yard-checkout-${p.id}`,
      expiresInMinutes: Math.max(1, Math.ceil((c.expiresAt.getTime() - Date.now()) / 60_000)),
    })
    const [u] = await d.update(payments).set({ accessCode: r.accessCode, authorizationUrl: r.authorizationUrl, initError: null, updatedAt: new Date() }).where(eq(payments.id, p.id)).returning()
    return toView(c, u)
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "initialise failed"
    log.warn(`[yard] ${providerLabel(provider.kind)} initialise failed for checkout ${c.id}: ${message}`)
    await d.update(payments).set({ initError: message, updatedAt: new Date() }).where(eq(payments.id, p.id))
    throw busy(10, "We couldn't reach the payment provider. Nothing was charged. Try again in a moment.")
  }
}

/* ---------- Verify ---------- */

/**
 * Asks Paystack for the payment's state (outside a transaction), stores the answer as a provider
 * event (source 'verify') and applies it exactly as the webhook would. Pending answers change
 * nothing.
 */
export async function verifyCheckout(actor: ShopperActor, checkoutId: string): Promise<CheckoutView> {
  assertPaymentsOpen()
  const view = await getCheckout(actor, checkoutId)
  if (view.status !== "pending_payment" || !view.payment || view.payment.provider === "stub" || view.payment.status !== "initialized") return view
  // Paystack never opened a page for this payment (its initialise failed): there is nothing to
  // verify, so this is the confirmation's Retry. Initialise again (Paystack's page unrestricted: the
  // method chosen at checkout isn't stored); a failure answers 503 with the reason, nothing charged.
  // (Only after a recorded failure: one still in flight from the checkout's own request is left alone.)
  if (!view.payment.accessCode && view.payment.message) {
    const d = await db()
    const [c] = await d.select().from(checkouts).where(and(eq(checkouts.id, checkoutId), eq(checkouts.customerId, actor.userId))).limit(1)
    if (!c) throw notFound()
    return ensureInitialized(actor, c)
  }
  const answer = await verifyPayment(view.payment.reference)
  const after = await getCheckout(actor, checkoutId)
  // Still pending: pass on Paystack's own word, so the page can tell "left without paying" from "being confirmed".
  if (answer.status === "pending" && after.status === "pending_payment" && after.payment?.reference === view.payment.reference) {
    return { ...after, payment: { ...after.payment, providerStatus: answer.providerStatus } }
  }
  return after
}

/** Verifies one payment reference with the provider and applies a final answer. Returns the provider status. */
export async function verifyPaymentReference(reference: string): Promise<"success" | "failed" | "pending" | "unknown"> {
  return (await verifyPayment(reference)).status
}

async function verifyPayment(reference: string): Promise<{ status: "success" | "failed" | "pending" | "unknown"; providerStatus: string | null }> {
  const provider = getProvider()
  if (provider.kind === "stub") return { status: "unknown", providerStatus: null }
  const d = await db()
  const [pay] = await d.select({ provider: payments.provider, accessCode: payments.accessCode }).from(payments).where(eq(payments.reference, reference)).limit(1)
  // Only the provider that opened the payment can be asked about it.
  if (!pay || pay.provider !== provider.kind) return { status: "unknown", providerStatus: null }
  // Paystack is asked by our reference; Bachs by its checkout session id (kept as the access code).
  const lookup = provider.kind === "bachs" ? pay.accessCode : reference
  if (!lookup) return { status: "unknown", providerStatus: null }
  let state
  try {
    state = await provider.verify(lookup)
  } catch (e) {
    if (e instanceof ProviderError) {
      log.warn(`[yard] ${providerLabel(provider.kind)} verify failed for ${reference}: ${e.message}`)
      throw busy(10, "We couldn't check your payment just now. If you paid, it will show here shortly.")
    }
    throw e
  }
  if (!state) return { status: "unknown", providerStatus: null }
  if (state.status === "pending") return { status: "pending", providerStatus: state.providerStatus }
  if (provider.kind === "bachs") {
    // The API's own checkout object, stored and applied as a Bachs "checkout.verified" event.
    const payload = { id: `${lookup}:${state.providerStatus ?? state.status}`, type: "checkout.verified", data: state.raw as Record<string, unknown> }
    const ev = await recordProviderEvent({ provider: "bachs", source: "verify", payload, rawBody: JSON.stringify(payload), signatureValid: true })
    await processEvent(ev.id)
    return { status: state.status, providerStatus: state.providerStatus }
  }
  const payload = { event: state.status === "success" ? "charge.success" : "charge.failed", data: state.raw as Record<string, unknown> }
  const ev = await recordProviderEvent({ provider: "paystack", source: "verify", payload, rawBody: JSON.stringify(payload), signatureValid: true })
  await processEvent(ev.id)
  return { status: state.status, providerStatus: state.providerStatus }
}

/* ---------- Stub completion (development only) ---------- */

/**
 * DEVELOPMENT ONLY, STUB ONLY: completes a stub payment as if the provider reported `outcome`, so
 * the paid/failed paths can be exercised without Paystack keys. The event is stored with source
 * 'simulated'. Never available in production or when Paystack is configured.
 */
export async function simulateStubPayment(actor: ShopperActor, checkoutId: string, outcome: "success" | "failed"): Promise<CheckoutView> {
  const view = await getCheckout(actor, checkoutId)
  if (!view.payment || view.payment.provider !== "stub") throw rule("Only stub payments can be simulated.")
  if (view.status !== "pending_payment") return view
  const payload = {
    event: outcome === "success" ? "charge.success" : "charge.failed",
    data: { reference: view.payment.reference, status: outcome, amount: view.totalMinor, currency: view.currency, id: `stub-${view.payment.id}`, paid_at: outcome === "success" ? new Date().toISOString() : null, channel: "stub", gateway_response: "Simulated (stub provider)" },
  }
  const ev = await recordProviderEvent({ provider: "stub", source: "simulated", payload, rawBody: JSON.stringify(payload), signatureValid: false })
  await processEvent(ev.id)
  return getCheckout(actor, checkoutId)
}

/**
 * DEVELOPMENT ONLY, STUB ONLY: runs the expiry job for one of the shopper's own stub checkouts as
 * if its hold had run out, so the release path can be exercised without waiting 30 minutes.
 */
export async function simulateStubExpiry(actor: ShopperActor, checkoutId: string): Promise<CheckoutView> {
  const view = await getCheckout(actor, checkoutId)
  if (!view.payment || view.payment.provider !== "stub") throw rule("Only stub checkouts can be expired here.")
  if (view.status === "pending_payment") await expireCheckouts(new Date(Math.max(Date.now(), Date.parse(view.expiresAt)) + 1000), { checkoutId })
  return getCheckout(actor, checkoutId)
}

/* ---------- Expiry job ---------- */

/**
 * Job (every 5 minutes): pending checkouts past their hold. Live payments are verified first (a
 * shopper who paid at the last second is never expired); anything not paid is expired, its stock
 * hold released and ORDERS told the payment failed.
 */
export async function expireCheckouts(now = new Date(), opts: { checkoutId?: string } = {}) {
  const d = await db()
  const due = await d
    .select()
    .from(checkouts)
    .where(and(eq(checkouts.status, "pending_payment"), lt(checkouts.expiresAt, now), opts.checkoutId ? eq(checkouts.id, opts.checkoutId) : undefined))
    .limit(100)
  let expired = 0
  let paid = 0
  for (const c of due) {
    const p = await latestPayment(d, c.id)
    if (isLivePayment(p)) {
      try {
        const r = await verifyPaymentReference(p.reference)
        if (r === "success") {
          paid++
          continue
        }
        if (r === "failed") continue // applied as a failure already
      } catch {
        continue // provider unreachable: try again next run rather than expire a maybe-paid checkout
      }
    }
    const done = await withTx(async (tx) => {
      const [cur] = await tx.select().from(checkouts).where(eq(checkouts.id, c.id)).limit(1)
      if (!cur || cur.status !== "pending_payment") return false
      await tx
        .update(payments)
        .set({ status: "abandoned", failureReason: "Checkout expired before payment", updatedAt: new Date() })
        .where(and(eq(payments.checkoutId, c.id), inArray(payments.status, ["initialized"])))
      await tx.update(checkouts).set({ status: "expired", failureReason: "Checkout expired before payment", updatedAt: new Date() }).where(eq(checkouts.id, c.id))
      await releaseHold(tx, cur.holdKey)
      await releaseDropClaims(tx, c.id)
      await markCheckoutPaymentFailed(tx, { checkoutId: c.id, reason: "expired" })
      return true
    })
    if (done) expired++
  }
  return { expired, paid }
}

