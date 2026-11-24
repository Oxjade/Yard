import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { sellState, storefrontLive } from "../../lib/admin-storefront"
import { owedList } from "../../lib/payout-needed"
import type { AdminPayoutAccountRowDto, AdminPayoutAccountsDto, AdminPayoutAccountsQuery, PayoutAccountFilter } from "../../lib/api/contracts/admin-payout-accounts"
import { brands } from "../db/schema/brands"
import { brandOnboardings, storefrontVersions } from "../db/schema/catalog"
import { brandPayoutAccounts, ledgerAccounts } from "../db/schema/ledger"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
export type Db = PgDatabase<PgQueryResultHKT, any>

const verifiedSql = sql`(${brandPayoutAccounts.recipientCode} is not null and ${brandPayoutAccounts.recipientProvider} <> 'stub')`
const OWED_KINDS = ["brand_pending", "brand_available", "brand_reserve", "brand_payout_hold"]
/** Yard owes the brand something in some currency (ledger_accounts_owner_kind_ccy_ux). */
const owesSql = sql`exists (select 1 from ${ledgerAccounts} la where la.owner_kind = 'brand' and la.owner_id = "brands"."id" and la.kind in (${sql.join(OWED_KINDS.map((k) => sql`${k}`), sql`, `)}) group by la.currency having sum(la.balance_minor) > 0)`
const owedNoAccountSql = sql`("brand_payout_accounts"."brand_id" is null and ${owesSql})`

function statusWhere(status: PayoutAccountFilter): SQL | undefined {
  if (status === "owed") return owedNoAccountSql
  if (status === "missing") return isNull(brandPayoutAccounts.brandId)
  if (status === "verified") return and(isNotNull(brandPayoutAccounts.brandId), verifiedSql)!
  if (status === "pending") return and(isNotNull(brandPayoutAccounts.brandId), sql`not ${verifiedSql}`)!
  return undefined
}

/**
 * Admin › Finance › Payout accounts: one page of every brand by name, each with its payout account
 * and whether it can sell. No server-only, so the tests run this exact query on PGlite with the
 * migrations applied; the route adds the finance-role check and the rate limit.
 *
 * Masking: only the bank name, account name, last 4 digits, currency, country, provider and change
 * time are selected. The sealed account number (account_number_enc) and the recipient code are
 * never read here, so they can't reach the response.
 */
export async function listPayoutAccountsDb(d: Db, query: Partial<AdminPayoutAccountsQuery> = {}): Promise<AdminPayoutAccountsDto> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200)
  const status = query.status ?? "all"

  const where: SQL[] = []
  const q = query.q?.trim()
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(or(ilike(brands.name, like), ilike(brands.handle, like))!)
  }
  const byStatus = statusWhere(status)
  if (byStatus) where.push(byStatus)
  const cond = where.length ? and(...where) : undefined

  const hasVersion = sql<boolean>`exists (select 1 from ${storefrontVersions} where ${storefrontVersions.brandId} = ${brands.id})`
  const [rows, [{ total }], countRows] = await Promise.all([
    d
      .select({
        id: brands.id,
        handle: brands.handle,
        name: brands.name,
        country: brands.country,
        reviewStatus: brands.reviewStatus,
        closedAt: brands.closedAt,
        founding: brands.founding,
        claimStatus: brands.claimStatus,
        launchedAt: brands.launchedAt,
        unpublishedAt: brands.unpublishedAt,
        hasVersion,
        acctBrand: brandPayoutAccounts.brandId,
        bankName: brandPayoutAccounts.bankName,
        accountName: brandPayoutAccounts.accountName,
        last4: brandPayoutAccounts.accountLast4,
        currency: brandPayoutAccounts.currency,
        acctCountry: brandPayoutAccounts.country,
        provider: brandPayoutAccounts.recipientProvider,
        verified: sql<boolean>`coalesce(${verifiedSql}, false)`,
        changedAt: brandPayoutAccounts.changedAt,
        brandCurrency: brands.currency,
        owedNoAccount: sql<boolean>`${owedNoAccountSql}`,
        payoutNeededSince: brands.payoutNeededSince,
      })
      .from(brands)
      .leftJoin(brandPayoutAccounts, eq(brandPayoutAccounts.brandId, brands.id))
      .where(cond)
      // Brands Yard owes with nowhere to pay them come first.
      .orderBy(desc(owedNoAccountSql), asc(sql`lower(${brands.name})`), asc(brands.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    d.select({ total: sql<number>`count(*)::int` }).from(brands).leftJoin(brandPayoutAccounts, eq(brandPayoutAccounts.brandId, brands.id)).where(cond),
    d
      .select({
        all: sql<number>`count(*)::int`,
        missing: sql<number>`count(*) filter (where ${brandPayoutAccounts.brandId} is null)::int`,
        verified: sql<number>`count(*) filter (where ${brandPayoutAccounts.brandId} is not null and ${verifiedSql})::int`,
        owed: sql<number>`count(*) filter (where ${owedNoAccountSql})::int`,
      })
      .from(brands)
      .leftJoin(brandPayoutAccounts, eq(brandPayoutAccounts.brandId, brands.id)),
  ])

  // Applications not approved yet (draft, submitted, rejected): the brand is still in review.
  const ids = rows.map((r) => r.id)
  const inReview = new Set(
    ids.length
      ? (await d.select({ brandId: brandOnboardings.brandId }).from(brandOnboardings).where(and(inArray(brandOnboardings.brandId, ids), inArray(brandOnboardings.status, ["draft", "submitted", "rejected"])))).map((r) => r.brandId)
      : [],
  )

  // What Yard owes each brand on the page, per currency (one query for the page).
  const balances = ids.length
    ? await d
        .select({ brandId: ledgerAccounts.ownerId, kind: ledgerAccounts.kind, currency: ledgerAccounts.currency, b: ledgerAccounts.balanceMinor })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.ownerKind, "brand"), inArray(ledgerAccounts.ownerId, ids), inArray(ledgerAccounts.kind, OWED_KINDS)))
    : []
  const owedOf = (id: string, currency: string) => {
    const by = new Map<string, number>()
    for (const b of balances) if (b.brandId === id) by.set(b.currency, (by.get(b.currency) ?? 0) + Number(b.b))
    return owedList([...by].map(([c, m]) => ({ currency: c, pendingMinor: m, availableMinor: 0, reserveMinor: 0, inPayoutMinor: 0 })), currency)
  }

  const items = rows.map<AdminPayoutAccountRowDto>((r) => {
    const account = r.acctBrand
      ? { bankName: r.bankName!, accountName: r.accountName!, last4: r.last4!, currency: r.currency!, country: r.acctCountry!, provider: r.provider!, changedAt: new Date(r.changedAt!).toISOString() }
      : null
    const facts = {
      founding: r.founding,
      claimStatus: r.claimStatus,
      reviewStatus: r.reviewStatus,
      closed: !!r.closedAt,
      hasVersion: !!r.hasVersion,
      launched: !!r.launchedAt,
      unpublished: !!r.unpublishedAt,
      payoutAccount: !!account,
      underReview: inReview.has(r.id),
    }
    const sell = sellState(facts)
    return {
      brandId: r.id,
      handle: r.handle,
      name: r.name,
      country: r.country,
      reviewStatus: r.reviewStatus,
      closed: facts.closed,
      founding: r.founding,
      claimStatus: r.claimStatus,
      status: !account ? "none" : r.verified ? "verified" : "pending",
      account,
      owed: owedOf(r.id, r.brandCurrency),
      owedNoAccount: !!r.owedNoAccount,
      payoutNeededSince: r.payoutNeededSince ? new Date(r.payoutNeededSince).toISOString() : null,
      storefrontLive: storefrontLive({ ...facts, name: r.name, liveProducts: 0 }),
      canSell: sell.canSell,
      reasons: sell.reasons,
      sellNote: sell.note,
    }
  })
  const c = countRows[0] ?? { all: 0, missing: 0, verified: 0, owed: 0 }
  const counts = { all: Number(c.all), owed: Number(c.owed), missing: Number(c.missing), verified: Number(c.verified), pending: Number(c.all) - Number(c.missing) - Number(c.verified) }
  return { items, total: Number(total), page, pageSize, counts }
}
