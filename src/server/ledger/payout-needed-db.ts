import { and, asc, eq, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { formatOwed, owedList, PAYOUT_NEEDED_COOLDOWN_MS, PAYOUT_NEEDED_TEMPLATE, PAYOUT_REMINDER_AFTER_MS, payoutNeededDedupeKey, type Owed } from "../../lib/payout-needed"
import { brandMembers, brands } from "../db/schema/brands"
import { brandPayoutAccounts, ledgerAccounts, ledgerOrderMoney } from "../db/schema/ledger"
import { users } from "../db/schema/people"

/**
 * "Add your payout account" emails (docs/BRAND-EMAILS.md › Payout account needed). A brand sells
 * without a payout account; Yard holds its earnings in the ledger and tells it to add one:
 *
 *  - On a paid order (payments/events.ts applyCharge, after the ledger posting, in the same
 *    transaction): when the brand has no payout account, one email to its owners and finance
 *    members, at most one per brand in any 24 hours (brands.payout_needed_emailed_at, claimed with a
 *    conditional update so concurrent payments queue one; the outbox key
 *    payout_needed:{brandId}:{yyyy-mm-dd} backs it up). The first such sale starts the reminder clock
 *    (brands.payout_needed_since).
 *  - One reminder (ledger jobs.payoutReminders, hourly): 3 days after that first sale, still no
 *    account, never reminded, outside the 24-hour window. One indexed query a run
 *    (brands_payout_needed_ix), more only when a reminder is due.
 *
 * Nothing is sent once an account is saved. No "server-only", so `tsx --test` runs these on a real
 * in-memory database (payout-needed.test.ts); ledger/payout-needed.ts wires them into the app.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
export type Db = PgDatabase<PgQueryResultHKT, any>
/** Queues one outbox row in `ex` (the app's enqueueEmail; idempotent by dedupeKey). */
export type Enqueue = (ex: Db, input: { template: string; to: string; vars: Record<string, string | number>; dedupeKey: string }) => Promise<void>

/** Who hears about payouts: the brand's active owners and finance members (never Yard setup). */
export const PAYOUT_NEEDED_ROLES = ["owner", "finance"] as const

export type PayoutNeededOutcome =
  | { brandId: string; queued: number; owed: Owed[]; sales: number; variant: "sale" | "reminder" }
  | { brandId: string; skipped: "has_account" | "cooldown" | "nothing_owed" | "excluded" | "already_reminded" }

// Qualified by hand: a lone column can print unqualified and bind to the subquery's own table.
const hasAccountSql = sql`exists (select 1 from brand_payout_accounts bpa where bpa.brand_id = "brands"."id")`

async function hasAccount(d: Db, brandId: string) {
  const [a] = await d.select({ id: brandPayoutAccounts.brandId }).from(brandPayoutAccounts).where(eq(brandPayoutAccounts.brandId, brandId)).limit(1)
  return !!a
}

/** What Yard holds for the brand (per currency, its own first) and how many paid sales are waiting (captured, not fully refunded). */
export async function payoutNeededFacts(d: Db, brandId: string, brandCurrency?: string): Promise<{ owed: Owed[]; sales: number }> {
  const rows = await d
    .select({ kind: ledgerAccounts.kind, currency: ledgerAccounts.currency, b: ledgerAccounts.balanceMinor })
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.ownerKind, "brand"), eq(ledgerAccounts.ownerId, brandId), inArray(ledgerAccounts.kind, ["brand_pending", "brand_available", "brand_reserve", "brand_payout_hold"])))
  const by = new Map<string, { currency: string; pendingMinor: number; availableMinor: number; reserveMinor: number; inPayoutMinor: number }>()
  for (const r of rows) {
    const cur = by.get(r.currency) ?? { currency: r.currency, pendingMinor: 0, availableMinor: 0, reserveMinor: 0, inPayoutMinor: 0 }
    const n = Number(r.b)
    if (r.kind === "brand_pending") cur.pendingMinor = n
    else if (r.kind === "brand_available") cur.availableMinor = n
    else if (r.kind === "brand_reserve") cur.reserveMinor = n
    else cur.inPayoutMinor = n
    by.set(r.currency, cur)
  }
  const [{ n }] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(ledgerOrderMoney)
    .where(and(eq(ledgerOrderMoney.brandId, brandId), ne(ledgerOrderMoney.status, "refunded")))
  return { owed: owedList([...by.values()], brandCurrency), sales: Number(n) || 0 }
}

/** The addresses that get it: active owners and finance members, one per address. */
export async function payoutNeededRecipients(d: Db, brandId: string): Promise<string[]> {
  const rows = await d
    .select({ email: users.email })
    .from(brandMembers)
    .innerJoin(users, eq(users.id, brandMembers.userId))
    .where(and(eq(brandMembers.brandId, brandId), eq(brandMembers.status, "active"), inArray(brandMembers.role, [...PAYOUT_NEEDED_ROLES])))
    .orderBy(asc(brandMembers.createdAt))
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of rows) {
    const e = r.email?.trim()
    if (!e || seen.has(e.toLowerCase())) continue
    seen.add(e.toLowerCase())
    out.push(e)
  }
  return out
}

async function queue(d: Db, enqueue: Enqueue, brandId: string, name: string, facts: { owed: Owed[]; sales: number }, variant: "sale" | "reminder", now: Date, reference?: string) {
  const to = await payoutNeededRecipients(d, brandId)
  const vars: Record<string, string | number> = { brand: name, owed: formatOwed(facts.owed), sales: Math.max(1, facts.sales), variant }
  if (reference) vars.reference = reference
  const key = payoutNeededDedupeKey(brandId, now, variant)
  for (const email of to) await enqueue(d, { template: PAYOUT_NEEDED_TEMPLATE, to: email, vars, dedupeKey: `${key}:${email.toLowerCase()}`.slice(0, 200) })
  return to.length
}

/**
 * Paid orders (one per brand per checkout): for each brand without a payout account, starts its
 * reminder clock and queues the email unless one went out in the last 24 hours. Call inside the
 * transaction that marked the orders paid, after the ledger posting (the amount includes this sale).
 * `exclude`: brands never emailed (sample brands in production).
 */
export async function notePaidSales(d: Db, sales: { brandId: string; reference: string }[], enqueue: Enqueue, opts: { now?: Date; exclude?: (brandId: string) => boolean } = {}): Promise<PayoutNeededOutcome[]> {
  const now = opts.now ?? new Date()
  const byBrand = new Map<string, string>()
  for (const s of sales) byBrand.set(s.brandId, s.reference)
  const out: PayoutNeededOutcome[] = []
  for (const [brandId, reference] of byBrand) {
    if (opts.exclude?.(brandId)) {
      out.push({ brandId, skipped: "excluded" })
      continue
    }
    if (await hasAccount(d, brandId)) {
      out.push({ brandId, skipped: "has_account" })
      continue
    }
    const [b] = await d.select({ currency: brands.currency }).from(brands).where(eq(brands.id, brandId)).limit(1)
    const facts = await payoutNeededFacts(d, brandId, b?.currency)
    if (!facts.owed.length) {
      out.push({ brandId, skipped: "nothing_owed" })
      continue
    }
    await d
      .update(brands)
      .set({ payoutNeededSince: sql`coalesce(${brands.payoutNeededSince}, ${now.toISOString()}::timestamptz)` })
      .where(eq(brands.id, brandId))
    // The 24-hour window is claimed on the brand row (row lock): a concurrent payment for the same brand finds it taken.
    const [claimed] = await d
      .update(brands)
      .set({ payoutNeededEmailedAt: now })
      .where(and(eq(brands.id, brandId), or(isNull(brands.payoutNeededEmailedAt), lte(brands.payoutNeededEmailedAt, new Date(now.getTime() - PAYOUT_NEEDED_COOLDOWN_MS)))))
      .returning({ name: brands.name })
    if (!claimed) {
      out.push({ brandId, skipped: "cooldown" })
      continue
    }
    const queued = await queue(d, enqueue, brandId, claimed.name, facts, "sale", now, reference)
    out.push({ brandId, queued, owed: facts.owed, sales: facts.sales, variant: "sale" })
  }
  return out
}

/** Brands due their one reminder (one query on brands_payout_needed_ix), oldest first. */
export async function payoutReminderCandidates(d: Db, now: Date, guard?: SQL, limit = 200) {
  return d
    .select({ id: brands.id, since: brands.payoutNeededSince })
    .from(brands)
    .where(
      and(
        sql`${brands.payoutNeededSince} is not null`,
        isNull(brands.payoutNeededRemindedAt),
        lte(brands.payoutNeededSince, new Date(now.getTime() - PAYOUT_REMINDER_AFTER_MS)),
        or(isNull(brands.payoutNeededEmailedAt), lte(brands.payoutNeededEmailedAt, new Date(now.getTime() - PAYOUT_NEEDED_COOLDOWN_MS))),
        sql`not ${hasAccountSql}`,
        sql`${brands.closedAt} is null`,
        ...(guard ? [guard] : []),
      ),
    )
    .orderBy(asc(brands.payoutNeededSince), asc(brands.id))
    .limit(limit)
}

/**
 * The one reminder per brand. Each brand is its own transaction (`inTx`): the reminder mark, the
 * 24-hour window and the outbox rows commit together; `onQueued` runs in it (the app's audit row).
 * A brand whose sales were all refunded is marked and not emailed.
 */
export async function sendPayoutReminders(
  d: Db,
  inTx: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>,
  enqueue: Enqueue,
  opts: { now?: Date; guard?: SQL; onQueued?: (tx: Db, outcome: Extract<PayoutNeededOutcome, { queued: number }>) => Promise<void> } = {},
): Promise<PayoutNeededOutcome[]> {
  const now = opts.now ?? new Date()
  const out: PayoutNeededOutcome[] = []
  for (const c of await payoutReminderCandidates(d, now, opts.guard)) {
    out.push(
      await inTx(async (tx) => {
        const [b] = await tx
          .update(brands)
          .set({ payoutNeededRemindedAt: now, payoutNeededEmailedAt: now })
          .where(and(eq(brands.id, c.id), isNull(brands.payoutNeededRemindedAt), sql`not ${hasAccountSql}`))
          .returning({ name: brands.name, currency: brands.currency })
        if (!b) return { brandId: c.id, skipped: "already_reminded" as const }
        const facts = await payoutNeededFacts(tx, c.id, b.currency)
        if (!facts.owed.length) return { brandId: c.id, skipped: "nothing_owed" as const }
        const queued = await queue(tx, enqueue, c.id, b.name, facts, "reminder", now)
        const done = { brandId: c.id, queued, owed: facts.owed, sales: facts.sales, variant: "reminder" as const }
        await opts.onQueued?.(tx, done)
        return done
      }),
    )
  }
  return out
}
