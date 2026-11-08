import "server-only"
import { and, eq, sql } from "drizzle-orm"
import type { Tx } from "../db"
import { ledgerAccounts, ledgerEntries, ledgerTransactions, type LEDGER_ACCOUNT_KINDS, type LEDGER_TX_KINDS } from "../db/schema/ledger"
import { newId } from "../ids"

/**
 * The double-entry engine. Every money movement is one ledger_transactions row with two or more
 * entries whose debits equal their credits, posted once per idempotency key. Account balances are
 * cached on ledger_accounts in the account's normal direction and updated in the same transaction.
 */
export type AccountKind = (typeof LEDGER_ACCOUNT_KINDS)[number]
export type TxKind = (typeof LEDGER_TX_KINDS)[number]
export type AccountRef = { ownerKind: "brand" | "platform"; ownerId: string; kind: AccountKind; currency: string }
export type Leg = { account: AccountRef; direction: "debit" | "credit"; amount: number }
export type AccountRow = typeof ledgerAccounts.$inferSelect

export class LedgerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LedgerError"
  }
}

export const PLATFORM = "platform"
export const brandAccount = (brandId: string, kind: "brand_pending" | "brand_available" | "brand_reserve" | "brand_payout_hold", currency: string): AccountRef => ({ ownerKind: "brand", ownerId: brandId, kind, currency })
export const platformAccount = (kind: "platform_commission" | "platform_adjustments" | "provider_clearing", currency: string): AccountRef => ({ ownerKind: "platform", ownerId: PLATFORM, kind, currency })

const normalOf = (kind: AccountKind) => (kind === "provider_clearing" ? "debit" : "credit")

export const isMinor = (n: number) => Number.isSafeInteger(n)
export const assertCurrency = (c: string) => {
  if (!/^[A-Z]{3}$/.test(c)) throw new LedgerError(`invalid currency ${JSON.stringify(c)}`)
}

/** The account row, created on first use, locked FOR UPDATE for the rest of the transaction. */
export async function lockAccount(tx: Tx, ref: AccountRef): Promise<AccountRow> {
  assertCurrency(ref.currency)
  await tx
    .insert(ledgerAccounts)
    .values({ id: newId("lac"), ownerKind: ref.ownerKind, ownerId: ref.ownerId, kind: ref.kind, currency: ref.currency, normal: normalOf(ref.kind) })
    .onConflictDoNothing()
  const [row] = await tx
    .select()
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerKind, ref.ownerKind), eq(ledgerAccounts.ownerId, ref.ownerId), eq(ledgerAccounts.kind, ref.kind), eq(ledgerAccounts.currency, ref.currency)))
    .for("update")
  if (!row) throw new LedgerError("ledger account could not be created")
  return row
}

/** Balance of one account (0 when it doesn't exist yet). */
export async function balanceOf(tx: Tx, ref: AccountRef): Promise<number> {
  const [row] = await tx
    .select({ b: ledgerAccounts.balanceMinor })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerKind, ref.ownerKind), eq(ledgerAccounts.ownerId, ref.ownerId), eq(ledgerAccounts.kind, ref.kind), eq(ledgerAccounts.currency, ref.currency)))
  return row?.b ?? 0
}

export type PostInput = {
  kind: TxKind
  idempotencyKey: string
  currency: string
  brandId?: string | null
  orderId?: string | null
  paymentId?: string | null
  refundId?: string | null
  payoutId?: string | null
  memo?: string | null
  actor?: { kind: "system" | "admin" | "brand"; id?: string | null }
  legs: Leg[]
}

/**
 * Posts one balanced transaction. Returns `{ duplicate: true }` without touching anything when the
 * idempotency key was already posted. Zero legs are dropped; a transaction with no legs left is
 * still recorded (so the key is consumed) only when `legs` was non-empty to begin with.
 */
export async function post(tx: Tx, input: PostInput): Promise<{ id: string; duplicate: boolean }> {
  assertCurrency(input.currency)
  const [existing] = await tx.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, input.idempotencyKey))
  if (existing) return { id: existing.id, duplicate: true }

  const legs = input.legs.filter((l) => l.amount !== 0)
  let debit = 0
  let credit = 0
  for (const l of legs) {
    if (!isMinor(l.amount) || l.amount < 0) throw new LedgerError(`leg amount must be a positive integer (got ${l.amount})`)
    if (l.account.currency !== input.currency) throw new LedgerError("all legs must share the transaction currency")
    if (l.direction === "debit") debit += l.amount
    else credit += l.amount
  }
  if (debit !== credit) throw new LedgerError(`unbalanced transaction ${input.kind}: debits ${debit} ≠ credits ${credit}`)

  const id = newId("ltx")
  const inserted = await tx
    .insert(ledgerTransactions)
    .values({
      id,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      currency: input.currency,
      brandId: input.brandId ?? null,
      orderId: input.orderId ?? null,
      paymentId: input.paymentId ?? null,
      refundId: input.refundId ?? null,
      payoutId: input.payoutId ?? null,
      memo: input.memo ?? null,
      actorKind: input.actor?.kind ?? "system",
      actorId: input.actor?.id ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: ledgerTransactions.id })
  if (!inserted.length) {
    const [again] = await tx.select({ id: ledgerTransactions.id }).from(ledgerTransactions).where(eq(ledgerTransactions.idempotencyKey, input.idempotencyKey))
    return { id: again?.id ?? id, duplicate: true }
  }

  for (const l of legs) {
    const acct = await lockAccount(tx, l.account)
    await tx.insert(ledgerEntries).values({ id: newId("len"), transactionId: id, accountId: acct.id, direction: l.direction, amountMinor: l.amount })
    const delta = l.direction === acct.normal ? l.amount : -l.amount
    await tx
      .update(ledgerAccounts)
      .set({ balanceMinor: sql`${ledgerAccounts.balanceMinor} + ${delta}` })
      .where(eq(ledgerAccounts.id, acct.id))
  }
  return { id, duplicate: false }
}

/** Debit `from`, credit `to` (a two-leg move). */
export const move = (from: AccountRef, to: AccountRef, amount: number): Leg[] => [
  { account: from, direction: "debit", amount },
  { account: to, direction: "credit", amount },
]

/** basis points of an amount, rounded half up, never negative. */
export const bpsOf = (amount: number, bps: number) => Math.max(0, Math.round((amount * bps) / 10_000))
