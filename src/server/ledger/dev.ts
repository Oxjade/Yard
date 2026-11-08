import "server-only"
import { and, eq, ilike, inArray, sql } from "drizzle-orm"
import { db, withTx } from "../db"
import { brandMembers, users } from "../db/schema"
import { brandPayoutAccounts, ledgerOrderMoney } from "../db/schema/ledger"
import { notFound } from "../http/errors"
import { releaseDueReserves } from "./postings"
import { runReconciliation } from "./reconcile"
import { openPayout, payoutAad } from "./vault"

/**
 * Test-only helpers for the LEDGER acceptance kit (scripts/checks/v3-ledger.mjs). The route that
 * calls these answers 404 in production before anything runs. Every operation is limited to the
 * kit's brands (KIT_BRANDS: seeded brands no other kit sells from) and to rows the kit tagged
 * ("t_v3_ledger" in the payout account name, `tm_t_v3_ledger_` membership ids).
 */
export const KIT_BRANDS = ["b_kumasi_thread", "b_signal_bloom"] as const
const TAG_LIKE = "%t\\_v3\\_ledger%"
const memberId = (brandId: string, userId: string) => `tm_t_v3_ledger_${userId}_${brandId}`.slice(0, 120)

function kitBrand(brandId: string) {
  if (!(KIT_BRANDS as readonly string[]).includes(brandId)) throw notFound("Not a ledger kit brand.")
}

/** Moves a kit-tagged payout account's change time `hours` into the past (skips the bank-change cooldown). */
export async function ageAccount(brandId: string, hours: number) {
  kitBrand(brandId)
  return withTx(async (tx) => {
    const rows = await tx
      .update(brandPayoutAccounts)
      .set({ changedAt: sql`${brandPayoutAccounts.changedAt} - make_interval(secs => ${Math.round(hours * 3600)})` })
      .where(and(eq(brandPayoutAccounts.brandId, brandId), ilike(brandPayoutAccounts.accountName, TAG_LIKE)))
      .returning({ brandId: brandPayoutAccounts.brandId })
    if (!rows.length) throw notFound("No kit payout account on that brand.")
    return { aged: rows.length }
  })
}

/** Adds (on) or removes (off) a kit membership of a demo user in a kit brand. Only `tm_t_v3_ledger_` rows are ever removed. */
export async function setMember(brandId: string, userId: string, role: string, on: boolean) {
  kitBrand(brandId)
  return withTx(async (tx) => {
    const id = memberId(brandId, userId)
    if (!on) {
      const gone = await tx.delete(brandMembers).where(eq(brandMembers.id, id)).returning({ id: brandMembers.id })
      return { removed: gone.length }
    }
    const [u] = await tx.select({ id: users.id, demo: users.demo }).from(users).where(eq(users.id, userId))
    if (!u?.demo) throw notFound("No such demo user.")
    const [existing] = await tx.select({ id: brandMembers.id }).from(brandMembers).where(and(eq(brandMembers.brandId, brandId), eq(brandMembers.userId, userId)))
    if (existing && existing.id !== id) throw notFound("That user already belongs to the brand (not a kit membership).")
    await tx
      .insert(brandMembers)
      .values({ id, brandId, userId, role, status: "active" })
      .onConflictDoUpdate({ target: brandMembers.id, set: { role, status: "active" } })
    return { added: id }
  })
}

/** Runs the reserve-release job as of `at`, over the given kit-brand orders only. */
export async function releaseReservesFor(orderIds: string[], at: Date) {
  const d = await db()
  const rows = await d
    .select({ id: ledgerOrderMoney.orderId })
    .from(ledgerOrderMoney)
    .where(and(inArray(ledgerOrderMoney.orderId, orderIds), inArray(ledgerOrderMoney.brandId, [...KIT_BRANDS])))
  if (rows.length !== new Set(orderIds).size) throw notFound("No such kit order in the ledger.")
  return releaseDueReserves(at, rows.map((r) => r.id))
}

/**
 * Where a (kit) account number appears in the database: every table's rows are searched as text.
 * Also reports whether the kit brand's sealed value opens back to that number.
 */
export async function scanAccountNumber(brandId: string, accountNumber: string) {
  kitBrand(brandId)
  const d = await db()
  const tables = (await d.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)) as unknown as { rows: { table_name: string }[] }
  const hits: string[] = []
  for (const { table_name } of tables.rows) {
    if (!/^[a-z0-9_]+$/.test(table_name)) continue
    const r = (await d.execute(sql`select count(*)::int as n from ${sql.identifier(table_name)} t where t::text like ${`%${accountNumber}%`}`)) as unknown as { rows: { n: number }[] }
    if ((r.rows[0]?.n ?? 0) > 0) hits.push(table_name)
  }
  const [acct] = await d.select().from(brandPayoutAccounts).where(eq(brandPayoutAccounts.brandId, brandId))
  let opens = false
  if (acct) {
    try {
      opens = openPayout(acct.accountNumberEnc, payoutAad(brandId)) === accountNumber
    } catch {
      opens = false
    }
  }
  return { tables: tables.rows.length, hits, sealed: acct ? { format: acct.accountNumberEnc.split(".")[0], opens, last4: acct.accountLast4 } : null }
}

/** A reconciliation run as if it were `hoursAhead` from now, so the kit's fresh postings fall inside the compared window. */
export async function reconcileAhead(hoursAhead: number) {
  return runReconciliation({ triggeredBy: "ledger-kit", now: new Date(Date.now() + hoursAhead * 3600_000) })
}
