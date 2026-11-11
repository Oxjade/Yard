import "server-only"
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm"
import { enqueueEmail } from "@/server/email"
import { initiatePayout } from "@/server/payments"
import { paymentsConfig } from "@/server/payments/config"
import { writeAudit } from "../audit"
import { catalogChanged } from "../catalog/hooks"
import type { AdminActor, BrandActor } from "../auth/dal"
import { afterCommit, withTx, type Tx } from "../db"
import { brandMembers, brands, users } from "../db/schema"
import { brandPayoutAccounts, ledgerBrandSettings, payoutApprovals, payoutBatches, payouts } from "../db/schema/ledger"
import { conflict, notFound, rule } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { assertAdminFinance, assertBankAccountEditor, assertBrandPayoutRequest, assertRecentReauth } from "./access"
import { ledgerConfig, minPayoutFor } from "./config"
import { brandAccount, lockAccount, move, platformAccount, post } from "./core"
import { getPayout, toAccountDto, toPayoutDto, type PayoutDto } from "./read"
import { recipientProvider } from "./recipients"
import { payoutAad, sealPayout } from "./vault"

/**
 * Payouts: request (funds move available → payout_hold at once, so they can't be spent twice),
 * two-admin approval (different admins, both re-authenticated, neither a member of the brand),
 * batches sent through PAYMENTS initiatePayout outside any transaction, and the transfer outcome
 * (webhook or synchronous) posting paid / failed / reversed.
 */

type PayoutRow = typeof payouts.$inferSelect
const OPEN_FOR_REJECT = ["requested", "awaiting_second_approval", "approved"]

async function loadPayoutForUpdate(tx: Tx, id: string, brandId?: string): Promise<PayoutRow> {
  const [p] = await tx
    .select()
    .from(payouts)
    .where(brandId ? and(eq(payouts.id, id), eq(payouts.brandId, brandId)) : eq(payouts.id, id))
    .for("update")
  if (!p) throw notFound("We couldn't find that payout.")
  return p
}

function emitPayout(brandId: string, payoutId: string, status: string) {
  afterCommit(async () => {
    await publish(channels.brand(brandId), "payout.updated", { payoutId, status })
    await publish(channels.admin, "finance.payout_updated", { payoutId, brandId, status })
  })
}

/** Emails the brand's owners and finance members about a payout outcome (ENGAGEMENT template "payout"). */
async function emailPayout(tx: Tx, p: PayoutRow, outcome: "paid" | "failed" | "rejected" | "reversed") {
  const rows = await tx
    .select({ email: users.email, brandName: brands.name })
    .from(brandMembers)
    .innerJoin(users, eq(users.id, brandMembers.userId))
    .innerJoin(brands, eq(brands.id, brandMembers.brandId))
    .where(and(eq(brandMembers.brandId, p.brandId), eq(brandMembers.status, "active"), inArray(brandMembers.role, ["owner", "finance"])))
  for (const r of rows) {
    await enqueueEmail(tx, {
      template: "payout",
      to: r.email,
      vars: { brandName: r.brandName, payoutId: p.id, amountMinor: p.amountMinor, currency: p.currency, outcome },
      dedupeKey: `payout:${p.id}:${outcome}:${p.attempts}:${r.email.toLowerCase()}`,
    })
  }
}

/* ---------- Bank account ---------- */

export type SavePayoutAccountInput = { country: string; currency: string; bankCode: string; bankName: string; accountName: string; accountNumber: string }

/** Owner only, re-authenticated. Creates the provider recipient first (outside a transaction), then seals and saves. */
export async function savePayoutAccount(actor: BrandActor, input: SavePayoutAccountInput, ipHash: string | null) {
  assertBankAccountEditor(actor)
  await assertRecentReauth(actor)
  const created = await recipientProvider().create({ brandId: actor.brandId, country: input.country, currency: input.currency, bankCode: input.bankCode, accountNumber: input.accountNumber, accountName: input.accountName })
  if (!created.ok) throw rule(created.message)
  return withTx(async (tx) => {
    const now = new Date()
    const [prior] = await tx.select({ brandId: brandPayoutAccounts.brandId }).from(brandPayoutAccounts).where(eq(brandPayoutAccounts.brandId, actor.brandId)).limit(1)
    const firstAccount = !prior
    const row = {
      brandId: actor.brandId,
      country: input.country,
      currency: input.currency,
      bankCode: input.bankCode,
      bankName: input.bankName,
      accountName: created.resolvedName ?? input.accountName,
      accountNumberEnc: sealPayout(input.accountNumber, payoutAad(actor.brandId)),
      accountLast4: input.accountNumber.slice(-4),
      recipientCode: created.recipientCode,
      recipientProvider: created.provider,
      updatedBy: actor.userId,
      changedAt: now,
    }
    const [saved] = await tx
      .insert(brandPayoutAccounts)
      .values(row)
      .onConflictDoUpdate({ target: brandPayoutAccounts.brandId, set: (({ brandId: _b, ...rest }) => rest)(row) })
      .returning()
    await writeAudit({
      actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role },
      action: "payout_account.changed",
      target: `${input.bankName} ••${row.accountLast4}`,
      subjectType: "payout_account",
      subjectId: actor.brandId,
      brandId: actor.brandId,
      ipHash,
      meta: { currency: input.currency, provider: created.provider, cooldownHours: ledgerConfig.bankChangeCooldownHours },
    })
    afterCommit(async () => {
      await publish(channels.admin, "finance.payout_account_changed", { brandId: actor.brandId })
    })
    // A claimed founding brand starts selling once it has a payout account: drop the public memo.
    // Search stores availability and sizes as zero while a brand isn't selling, so re-index its
    // catalogue on the first account (a later bank change doesn't change what is for sale).
    catalogChanged(firstAccount ? { reindexBrands: [actor.brandId] } : { brands: [actor.brandId] })
    return toAccountDto(saved)
  })
}

/* ---------- Brand: request / cancel ---------- */

/** Founding brands that no owner has claimed yet never take payouts (Yard staff set them up). */
async function unclaimedBrands(tx: Tx, brandIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(brandIds)]
  if (!ids.length) return new Set()
  const rows = await tx.select({ id: brands.id }).from(brands).where(and(inArray(brands.id, ids), eq(brands.claimStatus, "unclaimed")))
  return new Set(rows.map((r) => r.id))
}

export async function requestPayout(actor: BrandActor, input: { amountMinor: number; currency?: string; idempotencyKey: string }, ipHash: string | null): Promise<{ payout: PayoutDto; created: boolean }> {
  assertBrandPayoutRequest(actor)
  const result = await withTx(async (tx) => {
    if ((await unclaimedBrands(tx, [actor.brandId])).size) throw rule("This brand hasn't been claimed by its owner yet, so it can't take payouts.")
    const [existing] = await tx
      .select()
      .from(payouts)
      .where(and(eq(payouts.brandId, actor.brandId), eq(payouts.idempotencyKey, input.idempotencyKey)))
    if (existing) {
      if (existing.amountMinor !== input.amountMinor) throw conflict("This request key was already used for a different amount.")
      return { id: existing.id, created: false }
    }
    const [settings] = await tx.select().from(ledgerBrandSettings).where(eq(ledgerBrandSettings.brandId, actor.brandId))
    if (settings?.payoutsOnHold) throw rule("Payouts are on hold for this brand. Contact Yard support.")
    const [account] = await tx.select().from(brandPayoutAccounts).where(eq(brandPayoutAccounts.brandId, actor.brandId))
    if (!account?.recipientCode) throw rule("Add a payout account before requesting a payout.")
    const currency = input.currency ?? account.currency
    if (currency !== account.currency) throw rule(`Your payout account receives ${account.currency}.`)
    const cooldownUntil = account.changedAt.getTime() + ledgerConfig.bankChangeCooldownHours * 3600_000
    if (Date.now() < cooldownUntil) throw rule(`Your payout account changed recently. You can request a payout after ${new Date(cooldownUntil).toUTCString()}.`)
    const min = minPayoutFor(currency)
    if (input.amountMinor < min) throw rule("This is below the minimum payout.")
    const available = await lockAccount(tx, brandAccount(actor.brandId, "brand_available", currency))
    if (input.amountMinor > available.balanceMinor) throw rule("This is more than your available balance.")

    const id = newId("po")
    await tx.insert(payouts).values({
      id,
      brandId: actor.brandId,
      currency,
      amountMinor: input.amountMinor,
      status: "requested",
      requestedBy: actor.userId,
      idempotencyKey: input.idempotencyKey,
      recipientCode: account.recipientCode,
      recipientProvider: account.recipientProvider,
    })
    await post(tx, {
      kind: "payout_requested",
      idempotencyKey: `payout-req:${id}`,
      currency,
      brandId: actor.brandId,
      payoutId: id,
      memo: "Payout requested",
      actor: { kind: "brand", id: actor.userId },
      legs: move(brandAccount(actor.brandId, "brand_available", currency), brandAccount(actor.brandId, "brand_payout_hold", currency), input.amountMinor),
    })
    await writeAudit({
      actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role },
      action: "payout.requested",
      subjectType: "payout",
      subjectId: id,
      brandId: actor.brandId,
      ipHash,
      meta: { amountMinor: input.amountMinor, currency },
    })
    emitPayout(actor.brandId, id, "requested")
    return { id, created: true }
  })
  const payout = await getPayout(result.id, actor.brandId)
  if (!payout) throw notFound()
  return { payout, created: result.created }
}

/** Returns held funds to available (cancel / reject / failed). */
async function releaseHold(tx: Tx, p: PayoutRow, kind: "payout_cancelled" | "payout_rejected" | "payout_failed", actor: { kind: "system" | "admin" | "brand"; id?: string | null }) {
  await post(tx, {
    kind,
    idempotencyKey: `${kind}:${p.id}:${p.attempts}`,
    currency: p.currency,
    brandId: p.brandId,
    payoutId: p.id,
    memo: kind === "payout_cancelled" ? "Payout cancelled" : kind === "payout_rejected" ? "Payout rejected" : "Payout failed",
    actor,
    legs: move(brandAccount(p.brandId, "brand_payout_hold", p.currency), brandAccount(p.brandId, "brand_available", p.currency), p.amountMinor),
  })
}

export async function cancelPayout(actor: BrandActor, id: string, ipHash: string | null) {
  assertBrandPayoutRequest(actor)
  await withTx(async (tx) => {
    const p = await loadPayoutForUpdate(tx, id, actor.brandId)
    if (p.status !== "requested" && p.status !== "awaiting_second_approval") throw conflict("This payout can no longer be cancelled.")
    await releaseHold(tx, p, "payout_cancelled", { kind: "brand", id: actor.userId })
    const now = new Date()
    await tx.update(payouts).set({ status: "cancelled", closedAt: now, updatedAt: now }).where(eq(payouts.id, p.id))
    await writeAudit({ actor: { kind: "brand", id: actor.userId, name: actor.name, role: actor.role }, action: "payout.cancelled", subjectType: "payout", subjectId: p.id, brandId: p.brandId, ipHash, meta: { amountMinor: p.amountMinor, currency: p.currency } })
    emitPayout(p.brandId, p.id, "cancelled")
  })
  return getPayout(id, actor.brandId)
}

/* ---------- Admin: approve / reject ---------- */

const adminAudit = (a: AdminActor) => ({ kind: "admin" as const, id: a.userId, name: a.name, role: a.role })

/** Separation of duties: an admin who belongs to a brand can't act on that brand's money or finance settings. */
async function assertNotBrandMember(tx: Tx, brandId: string, actor: AdminActor, message: string) {
  const [member] = await tx
    .select({ id: brandMembers.id })
    .from(brandMembers)
    .where(and(eq(brandMembers.brandId, brandId), eq(brandMembers.userId, actor.userId)))
  if (member) throw rule(message)
}

/** Brand ids among `brandIds` whose payouts are on hold. Locks their settings rows (FOR SHARE) so a hold placed concurrently waits for, or is seen by, the caller. */
async function heldBrands(tx: Tx, brandIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(brandIds)]
  if (!ids.length) return new Set()
  const rows = await tx
    .select({ brandId: ledgerBrandSettings.brandId, payoutsOnHold: ledgerBrandSettings.payoutsOnHold })
    .from(ledgerBrandSettings)
    .where(inArray(ledgerBrandSettings.brandId, ids))
    .for("share")
  return new Set(rows.filter((r) => r.payoutsOnHold).map((r) => r.brandId))
}

export async function approvePayout(actor: AdminActor, id: string, note: string | null, ipHash: string | null) {
  assertAdminFinance(actor)
  await assertRecentReauth(actor)
  await withTx(async (tx) => {
    const p = await loadPayoutForUpdate(tx, id)
    if (p.requestedBy === actor.userId) throw rule("You can't approve a payout for a brand you belong to.")
    await assertNotBrandMember(tx, p.brandId, actor, "You can't approve a payout for a brand you belong to.")
    const prior = await tx.select().from(payoutApprovals).where(eq(payoutApprovals.payoutId, p.id))
    if (prior.some((a) => a.adminId === actor.userId)) throw rule("A different admin must give the second approval.")
    let step: 1 | 2
    if (p.status === "requested") step = 1
    else if (p.status === "awaiting_second_approval") step = 2
    else throw conflict("This payout isn't waiting for approval.")
    const [s] = await tx.select().from(ledgerBrandSettings).where(eq(ledgerBrandSettings.brandId, p.brandId))
    if (s?.payoutsOnHold) throw rule("Payouts are on hold for this brand. Lift the hold first.")

    await tx.insert(payoutApprovals).values({ id: newId("pap"), payoutId: p.id, adminId: actor.userId, adminName: actor.name, step, note })
    const now = new Date()
    const status = step === 1 ? "awaiting_second_approval" : "approved"
    await tx
      .update(payouts)
      .set({ status, approvedAt: step === 2 ? now : null, updatedAt: now })
      .where(eq(payouts.id, p.id))
    await writeAudit({
      actor: adminAudit(actor),
      action: step === 1 ? "payout.approved_first" : "payout.approved",
      subjectType: "payout",
      subjectId: p.id,
      brandId: p.brandId,
      approvedBy: step === 2 ? prior.find((a) => a.step === 1)?.adminId ?? null : null,
      reason: note,
      ipHash,
      meta: { amountMinor: p.amountMinor, currency: p.currency, step },
    })
    emitPayout(p.brandId, p.id, status)
  })
  return getPayout(id)
}

export async function rejectPayout(actor: AdminActor, id: string, reason: string, ipHash: string | null) {
  assertAdminFinance(actor)
  await assertRecentReauth(actor)
  await withTx(async (tx) => {
    const p = await loadPayoutForUpdate(tx, id)
    // A batched payout that hasn't been claimed for sending (still 'approved') can be rejected: the
    // batch run only sends 'approved' rows, and the payout row lock serialises this with the claim.
    if (!OPEN_FOR_REJECT.includes(p.status)) throw conflict("This payout can no longer be rejected.")
    await releaseHold(tx, p, "payout_rejected", { kind: "admin", id: actor.userId })
    const now = new Date()
    await tx.update(payouts).set({ status: "rejected", rejectedBy: actor.userId, rejectReason: reason, closedAt: now, updatedAt: now }).where(eq(payouts.id, p.id))
    await writeAudit({ actor: adminAudit(actor), action: "payout.rejected", subjectType: "payout", subjectId: p.id, brandId: p.brandId, reason, ipHash, meta: { amountMinor: p.amountMinor, currency: p.currency } })
    await emailPayout(tx, p, "rejected")
    emitPayout(p.brandId, p.id, "rejected")
  })
  return getPayout(id)
}

/* ---------- Batches ---------- */

export async function listBatches(limit = 50) {
  return withTx(async (tx) => {
    return tx.select().from(payoutBatches).orderBy(desc(payoutBatches.createdAt)).limit(Math.min(limit, 200))
  })
}

/** Groups approved, unbatched payouts of one currency (all of them, or the ids given) into a batch. */
export async function createBatch(actor: AdminActor, input: { currency: string; payoutIds?: string[] }, ipHash: string | null) {
  assertAdminFinance(actor)
  return withTx(async (tx) => {
    const where = [eq(payouts.status, "approved"), eq(payouts.currency, input.currency), isNull(payouts.batchId)]
    if (input.payoutIds?.length) where.push(inArray(payouts.id, input.payoutIds))
    let rows = await tx
      .select()
      .from(payouts)
      .where(and(...where))
      .for("update")
    if (!rows.length) throw rule("There are no approved payouts to batch.")
    if (input.payoutIds?.length && rows.length !== new Set(input.payoutIds).size) throw rule("Some payouts aren't approved, are in another currency, or are already in a batch.")
    const unclaimed = await unclaimedBrands(tx, rows.map((r) => r.brandId))
    if (unclaimed.size) throw rule("Some payouts belong to a founding brand that hasn't been claimed yet.")
    const held = await heldBrands(tx, rows.map((r) => r.brandId))
    if (input.payoutIds?.length && rows.some((r) => held.has(r.brandId))) throw rule("Some payouts belong to a brand whose payouts are on hold.")
    rows = rows.filter((r) => !held.has(r.brandId))
    if (!rows.length) throw rule("There are no approved payouts to batch.")
    const id = newId("pob")
    const total = rows.reduce((s, r) => s + r.amountMinor, 0)
    await tx.insert(payoutBatches).values({ id, currency: input.currency, status: "open", payoutCount: rows.length, totalMinor: total, createdBy: actor.userId })
    await tx
      .update(payouts)
      .set({ batchId: id, updatedAt: new Date() })
      .where(inArray(payouts.id, rows.map((r) => r.id)))
    await writeAudit({ actor: adminAudit(actor), action: "payout_batch.created", subjectType: "payout_batch", subjectId: id, ipHash, meta: { currency: input.currency, count: rows.length, totalMinor: total } })
    const [batch] = await tx.select().from(payoutBatches).where(eq(payoutBatches.id, id))
    return batch
  })
}

export async function getBatch(id: string) {
  return withTx(async (tx) => {
    const [batch] = await tx.select().from(payoutBatches).where(eq(payoutBatches.id, id))
    if (!batch) throw notFound("We couldn't find that batch.")
    const rows = await tx.select().from(payouts).where(eq(payouts.batchId, id))
    const approvals = rows.length ? await tx.select().from(payoutApprovals).where(inArray(payoutApprovals.payoutId, rows.map((r) => r.id))) : []
    return { batch, payouts: rows.map((r) => toPayoutDto(r, approvals)) }
  })
}

/**
 * Sends a batch: each approved payout is claimed ('sending') in its own transaction, sent through
 * PAYMENTS initiatePayout with the payout id as the provider reference (so a retry can't pay twice),
 * then settled from the answer. A thrown provider error puts the payout back to 'approved' with
 * last_error, so running the batch again retries it.
 */
export async function runBatch(actor: AdminActor, batchId: string, ipHash: string | null) {
  assertAdminFinance(actor)
  await assertRecentReauth(actor)
  const claimed = await withTx(async (tx) => {
    const [batch] = await tx.select().from(payoutBatches).where(eq(payoutBatches.id, batchId)).for("update")
    if (!batch) throw notFound("We couldn't find that batch.")
    if (batch.status === "done") throw conflict("This batch has already been sent.")
    const approved = await tx
      .select()
      .from(payouts)
      .where(and(eq(payouts.batchId, batchId), eq(payouts.status, "approved")))
      .for("update")
    // A brand put on hold after approval or batching must not be paid: leave its payouts 'approved'
    // (rejectable, or sent by a later run once the hold is lifted).
    const held = await heldBrands(tx, approved.map((r) => r.brandId))
    const rows = approved.filter((r) => !held.has(r.brandId))
    const skipped = approved.filter((r) => held.has(r.brandId))
    const now = new Date()
    for (const r of rows) await tx.update(payouts).set({ status: "sending", attempts: r.attempts + 1, updatedAt: now }).where(eq(payouts.id, r.id))
    for (const r of skipped) await tx.update(payouts).set({ lastError: "payouts_on_hold", updatedAt: now }).where(eq(payouts.id, r.id))
    await tx.update(payoutBatches).set({ status: "running", ranBy: actor.userId, ranAt: now }).where(eq(payoutBatches.id, batchId))
    await writeAudit({ actor: adminAudit(actor), action: "payout_batch.run", subjectType: "payout_batch", subjectId: batchId, ipHash, meta: { count: rows.length, heldCount: skipped.length, currency: batch.currency } })
    return { rows: rows.map((r) => ({ ...r, attempts: r.attempts + 1 })), skipped: skipped.map((r) => r.id) }
  })

  const results: { payoutId: string; status: string }[] = claimed.skipped.map((payoutId) => ({ payoutId, status: "on_hold" }))
  for (const p of claimed.rows) {
    if (p.recipientProvider === "stub" && paymentsConfig().provider === "paystack") {
      // A stub recipient can never be paid by the live provider: send it back for a real account.
      await withTx(async (tx) => {
        await tx.update(payouts).set({ status: "approved", lastError: "stub_recipient", updatedAt: new Date() }).where(eq(payouts.id, p.id))
      })
      results.push({ payoutId: p.id, status: "approved" })
      continue
    }
    let outcome: { providerRef: string; status: "pending" | "succeeded" | "failed" } | null = null
    try {
      outcome = await initiatePayout({ payoutId: p.id, brandId: p.brandId, amountMinor: p.amountMinor, currency: p.currency, recipientCode: p.recipientCode ?? "" })
    } catch (e) {
      log.warn(`[yard] payout ${p.id} send failed: ${e instanceof Error ? e.name : "error"}`)
    }
    const status = await withTx(async (tx) => {
      const row = await loadPayoutForUpdate(tx, p.id)
      if (row.status !== "sending") return row.status // a webhook got there first
      const now = new Date()
      if (!outcome) {
        await tx.update(payouts).set({ status: "approved", lastError: "provider_error", updatedAt: now }).where(eq(payouts.id, row.id))
        return "approved"
      }
      await tx.update(payouts).set({ providerRef: outcome.providerRef, sentAt: now, lastError: null, updatedAt: now }).where(eq(payouts.id, row.id))
      const fresh = { ...row, providerRef: outcome.providerRef }
      if (outcome.status === "succeeded") return settlePaid(tx, fresh)
      if (outcome.status === "failed") return settleFailed(tx, fresh, "provider_failed")
      await tx.update(payouts).set({ status: "processing" }).where(eq(payouts.id, row.id))
      emitPayout(row.brandId, row.id, "processing")
      return "processing"
    })
    results.push({ payoutId: p.id, status })
  }

  await withTx(async (tx) => {
    const rows = await tx.select({ status: payouts.status }).from(payouts).where(eq(payouts.batchId, batchId))
    const settled = rows.every((r) => ["paid", "processing", "failed", "rejected", "cancelled"].includes(r.status))
    await tx
      .update(payoutBatches)
      .set({ status: settled ? "done" : "partial", finishedAt: new Date() })
      .where(eq(payoutBatches.id, batchId))
  })
  return { batchId, results }
}

/* ---------- Outcomes ---------- */

async function settlePaid(tx: Tx, p: PayoutRow): Promise<string> {
  if (p.status === "paid") return "paid"
  await post(tx, {
    kind: "payout_paid",
    idempotencyKey: `payout_paid:${p.id}`,
    currency: p.currency,
    brandId: p.brandId,
    payoutId: p.id,
    memo: "Payout paid",
    legs: move(brandAccount(p.brandId, "brand_payout_hold", p.currency), platformAccount("provider_clearing", p.currency), p.amountMinor),
  })
  const now = new Date()
  await tx.update(payouts).set({ status: "paid", paidAt: now, closedAt: now, updatedAt: now }).where(eq(payouts.id, p.id))
  await emailPayout(tx, p, "paid")
  emitPayout(p.brandId, p.id, "paid")
  return "paid"
}

async function settleFailed(tx: Tx, p: PayoutRow, reason: string): Promise<string> {
  if (p.status === "failed") return "failed"
  await releaseHold(tx, p, "payout_failed", { kind: "system" })
  const now = new Date()
  await tx.update(payouts).set({ status: "failed", failedAt: now, closedAt: now, lastError: reason.slice(0, 120), updatedAt: now }).where(eq(payouts.id, p.id))
  await emailPayout(tx, p, "failed")
  emitPayout(p.brandId, p.id, "failed")
  return "failed"
}

/**
 * A transfer outcome. Accepts CHECKOUT's normalised shape (payments/events.ts: `{ payoutId,
 * status: "succeeded" | "failed", providerRef, reference, amountMinor, currency, reason }`, where
 * a `failed` on an already-paid payout is a reversal), a typed `{ type: "transfer.*" }` shape, or
 * Paystack's raw `{ event, data }` body. `reference` / `transferCode` / `payoutId` locate the payout.
 */
export type TransferEvent =
  | { payoutId: string; status: "succeeded" | "failed"; providerRef: string | null; reference: string; amountMinor: number; currency: string; reason: string | null }
  | { type: "transfer.success" | "transfer.failed" | "transfer.reversed"; reference?: string | null; transferCode?: string | null; amountMinor?: number | null; currency?: string | null; reason?: string | null }
  | { event: string; data?: { reference?: string | null; transfer_code?: string | null; amount?: number | null; currency?: string | null; reason?: string | null } }

type Normalised = { type: string; payoutId?: string | null; reference?: string | null; transferCode?: string | null; amountMinor?: number | null; currency?: string | null; reason?: string | null; failedMeansReversedIfPaid?: boolean }

function normalise(evt: TransferEvent): Normalised {
  if ("payoutId" in evt) {
    return { type: evt.status === "succeeded" ? "transfer.success" : "transfer.failed", payoutId: evt.payoutId, reference: evt.reference, transferCode: evt.providerRef, amountMinor: evt.amountMinor, currency: evt.currency, reason: evt.reason, failedMeansReversedIfPaid: true }
  }
  if ("type" in evt) return evt
  const d = evt.data ?? {}
  return { type: evt.event, reference: d.reference ?? null, transferCode: d.transfer_code ?? null, amountMinor: d.amount ?? null, currency: d.currency ?? null, reason: d.reason ?? null }
}

/**
 * LEDGER export for CHECKOUT's webhook: applies a transfer outcome to its payout, idempotently.
 * Returns what happened, so the caller can mark its raw event processed. An event for an unknown
 * payout, or whose amount/currency disagrees with the payout, is not applied ('ignored' / 'mismatch').
 */
export async function handleTransferEvent(tx: Tx, evt: TransferEvent): Promise<{ result: "applied" | "duplicate" | "ignored" | "mismatch"; payoutId?: string }> {
  const e = normalise(evt)
  if (!["transfer.success", "transfer.failed", "transfer.reversed"].includes(e.type)) return { result: "ignored" }
  const keys = [e.payoutId, e.reference, e.transferCode].filter((x): x is string => !!x)
  if (!keys.length) return { result: "ignored" }
  const [p] = await tx
    .select()
    .from(payouts)
    .where(or(inArray(payouts.id, keys), inArray(payouts.providerRef, keys)))
    .for("update")
  if (!p) return { result: "ignored" }
  if ((e.amountMinor != null && e.amountMinor !== p.amountMinor) || (e.currency && e.currency !== p.currency)) {
    log.error(`[yard] ledger: transfer event for ${p.id} disagrees with the payout amount or currency; not applied`)
    return { result: "mismatch", payoutId: p.id }
  }
  const row = e.transferCode && !p.providerRef ? { ...p, providerRef: e.transferCode } : p
  if (row !== p) await tx.update(payouts).set({ providerRef: row.providerRef }).where(eq(payouts.id, p.id))

  if (e.type === "transfer.success") {
    if (p.status === "paid") return { result: "duplicate", payoutId: p.id }
    if (!["sending", "processing", "approved"].includes(p.status)) return { result: "ignored", payoutId: p.id }
    await settlePaid(tx, row)
    return { result: "applied", payoutId: p.id }
  }
  if (e.type === "transfer.failed" && e.failedMeansReversedIfPaid && p.status === "paid") e.type = "transfer.reversed"
  if (e.type === "transfer.failed") {
    if (p.status === "failed") return { result: "duplicate", payoutId: p.id }
    if (!["sending", "processing", "approved"].includes(p.status)) return { result: "ignored", payoutId: p.id }
    await settleFailed(tx, row, "provider_failed")
    return { result: "applied", payoutId: p.id }
  }
  // transfer.reversed: the money came back after we'd marked it paid.
  if (p.status !== "paid") {
    if (["sending", "processing"].includes(p.status)) {
      await settleFailed(tx, row, "provider_reversed")
      return { result: "applied", payoutId: p.id }
    }
    return { result: "ignored", payoutId: p.id }
  }
  const res = await post(tx, {
    kind: "payout_reversed",
    idempotencyKey: `payout_reversed:${p.id}`,
    currency: p.currency,
    brandId: p.brandId,
    payoutId: p.id,
    memo: "Payout reversed by the bank",
    legs: move(platformAccount("provider_clearing", p.currency), brandAccount(p.brandId, "brand_available", p.currency), p.amountMinor),
  })
  if (res.duplicate) return { result: "duplicate", payoutId: p.id }
  const now = new Date()
  await tx.update(payouts).set({ status: "failed", failedAt: now, lastError: "provider_reversed", updatedAt: now }).where(eq(payouts.id, p.id))
  await emailPayout(tx, p, "reversed")
  emitPayout(p.brandId, p.id, "failed")
  return { result: "applied", payoutId: p.id }
}

/* ---------- Admin: settings and adjustments ---------- */

export async function updateBrandFinanceSettings(
  actor: AdminActor,
  brandId: string,
  input: { tierOverride?: "new" | "standard" | "trusted" | null; commissionBpsOverride?: number | null; payoutsOnHold?: boolean; holdReason?: string | null },
  ipHash: string | null,
) {
  assertAdminFinance(actor)
  if (input.commissionBpsOverride !== undefined) await assertRecentReauth(actor)
  return withTx(async (tx) => {
    const [brand] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId))
    if (!brand) throw notFound("We couldn't find that brand.")
    await assertNotBrandMember(tx, brandId, actor, "You can't change finance settings for a brand you belong to.")
    const [cur] = await tx.select().from(ledgerBrandSettings).where(eq(ledgerBrandSettings.brandId, brandId))
    const next = {
      brandId,
      tierOverride: input.tierOverride !== undefined ? input.tierOverride : (cur?.tierOverride ?? null),
      commissionBpsOverride: input.commissionBpsOverride !== undefined ? input.commissionBpsOverride : (cur?.commissionBpsOverride ?? null),
      payoutsOnHold: input.payoutsOnHold ?? cur?.payoutsOnHold ?? false,
      holdReason: input.holdReason !== undefined ? input.holdReason : (cur?.holdReason ?? null),
      updatedBy: actor.userId,
      updatedAt: new Date(),
    }
    if (next.payoutsOnHold && !next.holdReason) throw rule("Give a reason for holding payouts.")
    const [saved] = await tx
      .insert(ledgerBrandSettings)
      .values(next)
      .onConflictDoUpdate({ target: ledgerBrandSettings.brandId, set: (({ brandId: _b, ...rest }) => rest)(next) })
      .returning()
    await writeAudit({
      actor: adminAudit(actor),
      action: "finance.brand_settings",
      subjectType: "brand",
      subjectId: brandId,
      brandId,
      reason: next.holdReason,
      ipHash,
      meta: { tierOverride: next.tierOverride, commissionBpsOverride: next.commissionBpsOverride, payoutsOnHold: next.payoutsOnHold },
    })
    return saved
  })
}

/**
 * A manual correction between a brand account and platform_adjustments (e.g. a goodwill credit or
 * recovering a negative balance). Re-authenticated, audited with a reason, idempotent per key.
 */
export async function postAdjustment(
  actor: AdminActor,
  input: { brandId: string; currency: string; account: "brand_available" | "brand_reserve" | "brand_pending"; direction: "credit" | "debit"; amountMinor: number; reason: string; idempotencyKey: string },
  ipHash: string | null,
) {
  assertAdminFinance(actor)
  await assertRecentReauth(actor)
  return withTx(async (tx) => {
    const [brand] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, input.brandId))
    if (!brand) throw notFound("We couldn't find that brand.")
    await assertNotBrandMember(tx, input.brandId, actor, "You can't post an adjustment for a brand you belong to.")
    const brandAcct = brandAccount(input.brandId, input.account, input.currency)
    const platform = platformAccount("platform_adjustments", input.currency)
    const res = await post(tx, {
      kind: "adjustment",
      idempotencyKey: `adjust:${input.idempotencyKey}`,
      currency: input.currency,
      brandId: input.brandId,
      memo: input.direction === "credit" ? "Adjustment credit" : "Adjustment debit",
      actor: { kind: "admin", id: actor.userId },
      legs: input.direction === "credit" ? move(platform, brandAcct, input.amountMinor) : move(brandAcct, platform, input.amountMinor),
    })
    if (!res.duplicate) {
      await writeAudit({
        actor: adminAudit(actor),
        action: "finance.adjustment",
        subjectType: "ledger_transaction",
        subjectId: res.id,
        brandId: input.brandId,
        reason: input.reason,
        ipHash,
        meta: { account: input.account, direction: input.direction, amountMinor: input.amountMinor, currency: input.currency },
      })
    }
    return { transactionId: res.id, duplicate: res.duplicate }
  })
}
