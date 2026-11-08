import "server-only"
import { and, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm"
import { db, type Executor } from "../db"
import { brands } from "../db/schema"
import { brandPayoutAccounts, ledgerAccounts, ledgerBrandSettings, ledgerEntries, ledgerTransactions, payoutApprovals, payouts } from "../db/schema/ledger"
import { ledgerConfig, minPayoutFor } from "./config"
import { PLATFORM } from "./core"
import { brandTier } from "./postings"

/** Read models and DTOs for Studio › Payouts and Admin › Finance. All amounts are minor units. */

export type BrandBalanceDto = {
  currency: string
  /** Captured sales still in the order lifecycle / return window. */
  pendingMinor: number
  /** Withdrawable now (may be negative after a refund on an already-paid-out order). */
  availableMinor: number
  /** Rolling reserve held by tier. */
  reserveMinor: number
  /** Requested payouts under review or in flight. */
  inPayoutMinor: number
}

export type PayoutDto = {
  id: string
  brandId: string
  brandName?: string
  currency: string
  amountMinor: number
  status: string
  requestedAt: string
  approvedAt: string | null
  sentAt: string | null
  paidAt: string | null
  failedAt: string | null
  closedAt: string | null
  batchId: string | null
  providerRef: string | null
  /** True when the recipient is the stub provider (test account: no money moves). */
  stubRecipient: boolean
  lastError: string | null
  rejectReason: string | null
  approvals: { adminId: string; adminName: string; step: number; at: string; note: string | null }[]
}

export type PayoutAccountDto = {
  country: string
  currency: string
  bankCode: string
  bankName: string
  accountName: string
  accountLast4: string
  recipientProvider: "stub" | "paystack"
  verified: boolean
  changedAt: string
  /** Payout requests are refused until this time after a change. */
  cooldownUntil: string | null
}

export type StatementEntryDto = { id: string; at: string; kind: string; memo: string | null; account: string; direction: "debit" | "credit"; amountMinor: number; signedMinor: number; currency: string; orderId: string | null; payoutId: string | null; refundId: string | null }

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export async function brandBalances(brandId: string, ex?: Executor): Promise<BrandBalanceDto[]> {
  const d = ex ?? (await db())
  const rows = await d
    .select({ kind: ledgerAccounts.kind, currency: ledgerAccounts.currency, b: ledgerAccounts.balanceMinor })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerKind, "brand"), eq(ledgerAccounts.ownerId, brandId)))
  const by = new Map<string, BrandBalanceDto>()
  for (const r of rows) {
    const cur = by.get(r.currency) ?? { currency: r.currency, pendingMinor: 0, availableMinor: 0, reserveMinor: 0, inPayoutMinor: 0 }
    if (r.kind === "brand_pending") cur.pendingMinor = r.b
    else if (r.kind === "brand_available") cur.availableMinor = r.b
    else if (r.kind === "brand_reserve") cur.reserveMinor = r.b
    else if (r.kind === "brand_payout_hold") cur.inPayoutMinor = r.b
    by.set(r.currency, cur)
  }
  return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency))
}

export function toPayoutDto(p: typeof payouts.$inferSelect, approvals: (typeof payoutApprovals.$inferSelect)[] = [], brandName?: string): PayoutDto {
  return {
    id: p.id,
    brandId: p.brandId,
    ...(brandName ? { brandName } : {}),
    currency: p.currency,
    amountMinor: p.amountMinor,
    status: p.status,
    requestedAt: p.requestedAt.toISOString(),
    approvedAt: iso(p.approvedAt),
    sentAt: iso(p.sentAt),
    paidAt: iso(p.paidAt),
    failedAt: iso(p.failedAt),
    closedAt: iso(p.closedAt),
    batchId: p.batchId,
    providerRef: p.providerRef,
    stubRecipient: p.recipientProvider === "stub",
    lastError: p.lastError,
    rejectReason: p.rejectReason,
    approvals: approvals
      .filter((a) => a.payoutId === p.id)
      .sort((a, b) => a.step - b.step)
      .map((a) => ({ adminId: a.adminId, adminName: a.adminName, step: a.step, at: a.at.toISOString(), note: a.note })),
  }
}

export async function listPayouts(filter: { brandId?: string; status?: string[]; before?: Date; limit?: number }): Promise<PayoutDto[]> {
  const d = await db()
  const where: SQL[] = []
  if (filter.brandId) where.push(eq(payouts.brandId, filter.brandId))
  if (filter.status?.length) where.push(inArray(payouts.status, filter.status))
  if (filter.before) where.push(lt(payouts.requestedAt, filter.before))
  const rows = await d
    .select({ p: payouts, brandName: brands.name })
    .from(payouts)
    .innerJoin(brands, eq(brands.id, payouts.brandId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(payouts.requestedAt))
    .limit(Math.min(filter.limit ?? 50, 200))
  const ids = rows.map((r) => r.p.id)
  const approvals = ids.length ? await d.select().from(payoutApprovals).where(inArray(payoutApprovals.payoutId, ids)) : []
  return rows.map((r) => toPayoutDto(r.p, approvals, r.brandName))
}

export async function getPayout(id: string, brandId?: string): Promise<PayoutDto | null> {
  const d = await db()
  const [row] = await d
    .select({ p: payouts, brandName: brands.name })
    .from(payouts)
    .innerJoin(brands, eq(brands.id, payouts.brandId))
    .where(brandId ? and(eq(payouts.id, id), eq(payouts.brandId, brandId)) : eq(payouts.id, id))
  if (!row) return null
  const approvals = await d.select().from(payoutApprovals).where(eq(payoutApprovals.payoutId, id))
  return toPayoutDto(row.p, approvals, row.brandName)
}

export function toAccountDto(a: typeof brandPayoutAccounts.$inferSelect): PayoutAccountDto {
  const until = new Date(a.changedAt.getTime() + ledgerConfig.bankChangeCooldownHours * 3600_000)
  return {
    country: a.country,
    currency: a.currency,
    bankCode: a.bankCode,
    bankName: a.bankName,
    accountName: a.accountName,
    accountLast4: a.accountLast4,
    recipientProvider: a.recipientProvider as "stub" | "paystack",
    verified: !!a.recipientCode && a.recipientProvider !== "stub",
    changedAt: a.changedAt.toISOString(),
    cooldownUntil: until > new Date() ? until.toISOString() : null,
  }
}

export async function getPayoutAccount(brandId: string): Promise<PayoutAccountDto | null> {
  const d = await db()
  const [a] = await d.select().from(brandPayoutAccounts).where(eq(brandPayoutAccounts.brandId, brandId))
  return a ? toAccountDto(a) : null
}

/** Studio › Payouts summary: balances, rules, account and recent payouts. */
export async function brandPayoutSummary(brandId: string, brandCurrency: string) {
  const d = await db()
  const [balances, account, recent, settingsRows, tier] = await Promise.all([
    brandBalances(brandId, d),
    getPayoutAccount(brandId),
    listPayouts({ brandId, limit: 20 }),
    d.select().from(ledgerBrandSettings).where(eq(ledgerBrandSettings.brandId, brandId)),
    brandTier(d, brandId),
  ])
  const s = settingsRows[0]
  const currency = account?.currency ?? brandCurrency
  return {
    currency,
    balances: balances.length ? balances : [{ currency, pendingMinor: 0, availableMinor: 0, reserveMinor: 0, inPayoutMinor: 0 }],
    account,
    payouts: recent,
    rules: {
      tier,
      reserveBps: ledgerConfig.reserves[tier].bps,
      reserveDays: ledgerConfig.reserves[tier].days,
      commissionBps: s?.commissionBpsOverride ?? ledgerConfig.commissionBps,
      minPayoutMinor: minPayoutFor(currency),
      onHold: !!s?.payoutsOnHold,
      holdReason: s?.payoutsOnHold ? (s.holdReason ?? null) : null,
      cooldownUntil: account?.cooldownUntil ?? null,
    },
  }
}

/** The journal lines on one owner's accounts (a brand's statement, or the platform's), newest first. */
export async function statement(filter: { ownerKind: "brand" | "platform"; ownerId: string; currency?: string; accountKind?: string; before?: Date; limit?: number }): Promise<StatementEntryDto[]> {
  const d = await db()
  const where: SQL[] = [eq(ledgerAccounts.ownerKind, filter.ownerKind), eq(ledgerAccounts.ownerId, filter.ownerId)]
  if (filter.currency) where.push(eq(ledgerAccounts.currency, filter.currency))
  if (filter.accountKind) where.push(eq(ledgerAccounts.kind, filter.accountKind))
  if (filter.before) where.push(lt(ledgerEntries.createdAt, filter.before))
  const rows = await d
    .select({ e: ledgerEntries, a: ledgerAccounts, t: ledgerTransactions })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
    .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
    .where(and(...where))
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(Math.min(filter.limit ?? 50, 200))
  return rows.map(({ e, a, t }) => ({
    id: e.id,
    at: e.createdAt.toISOString(),
    kind: t.kind,
    memo: t.memo,
    account: a.kind,
    direction: e.direction as "debit" | "credit",
    amountMinor: e.amountMinor,
    signedMinor: e.direction === a.normal ? e.amountMinor : -e.amountMinor,
    currency: a.currency,
    orderId: t.orderId,
    payoutId: t.payoutId,
    refundId: t.refundId,
  }))
}

/** Admin › Finance overview: platform account balances and brand liabilities per currency, plus payout queue counts. */
export async function financeOverview() {
  const d = await db()
  const platform = await d
    .select({ kind: ledgerAccounts.kind, currency: ledgerAccounts.currency, b: ledgerAccounts.balanceMinor })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerKind, "platform"), eq(ledgerAccounts.ownerId, PLATFORM)))
  const liabilities = await d
    .select({ kind: ledgerAccounts.kind, currency: ledgerAccounts.currency, total: sql<number>`coalesce(sum(${ledgerAccounts.balanceMinor}), 0)::bigint`.mapWith(Number) })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.ownerKind, "brand"))
    .groupBy(ledgerAccounts.kind, ledgerAccounts.currency)
  const queue = await d
    .select({ status: payouts.status, currency: payouts.currency, n: sql<number>`count(*)::int`.mapWith(Number), total: sql<number>`coalesce(sum(${payouts.amountMinor}), 0)::bigint`.mapWith(Number) })
    .from(payouts)
    .where(inArray(payouts.status, ["requested", "awaiting_second_approval", "approved", "sending", "processing", "failed"]))
    .groupBy(payouts.status, payouts.currency)
  const currencies = [...new Set([...platform.map((p) => p.currency), ...liabilities.map((l) => l.currency)])].sort()
  return {
    currencies: currencies.map((c) => {
      const p = (k: string) => platform.find((x) => x.currency === c && x.kind === k)?.b ?? 0
      const l = (k: string) => liabilities.find((x) => x.currency === c && x.kind === k)?.total ?? 0
      return {
        currency: c,
        providerClearingMinor: p("provider_clearing"),
        commissionMinor: p("platform_commission"),
        adjustmentsMinor: p("platform_adjustments"),
        brandPendingMinor: l("brand_pending"),
        brandAvailableMinor: l("brand_available"),
        brandReserveMinor: l("brand_reserve"),
        brandInPayoutMinor: l("brand_payout_hold"),
      }
    }),
    payoutQueue: queue,
  }
}
