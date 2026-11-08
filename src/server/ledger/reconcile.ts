import "server-only"
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import * as payments from "@/server/payments"
import { writeAudit } from "../audit"
import type { AdminActor } from "../auth/dal"
import { afterCommit, withTx } from "../db"
import { ledgerAccounts, ledgerEntries, ledgerTransactions, payouts, reconciliationItems, reconciliationRuns, type RECON_ITEM_KINDS } from "../db/schema/ledger"
import { conflict, notFound } from "../http/errors"
import { newId } from "../ids"
import { log } from "../log"
import { publish } from "../realtime/bus"
import { channels } from "../realtime/channels"
import { assertAdminFinance } from "./access"
import { ledgerConfig } from "./config"

/**
 * Daily reconciliation. Internal checks always run: every transaction balances, every cached
 * balance equals the sum of its entries, no payout is stuck in flight. The provider comparison
 * runs when PAYMENTS exports `listProviderEventsForReconciliation` (see ProviderEvent): charges by
 * payment id, refunds by refund id and transfers by payout id are compared with what the ledger
 * posted, in both directions. Without it the run says provider_compared = false.
 */
export type ProviderEvent = { kind: "charge" | "refund" | "transfer"; ref: string; amountMinor: number; currency: string; status: "succeeded" | "failed" | "pending" | "reversed"; at: Date }
type ListProviderEvents = (input: { from: Date; to: Date }) => Promise<ProviderEvent[]>

type ItemKind = (typeof RECON_ITEM_KINDS)[number]
type Item = { kind: ItemKind; ref: string; currency?: string | null; ledgerMinor?: number | null; providerMinor?: number | null; facts?: Record<string, string | number | boolean | null> }

const HOUR = 3600_000

function providerLister(): ListProviderEvents | null {
  const fn = (payments as unknown as Record<string, unknown>).listProviderEventsForReconciliation
  return typeof fn === "function" ? (fn as ListProviderEvents) : null
}

export async function runReconciliation(opts: { triggeredBy?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date()
  const from = new Date(now.getTime() - ledgerConfig.reconWindowHours * HOUR)
  // Ledger rows from the last hour are left for the next run: their provider events may not be in yet.
  const settledTo = new Date(now.getTime() - HOUR)
  const runId = newId("rec")
  await withTx(async (tx) => {
    await tx.insert(reconciliationRuns).values({ id: runId, windowFrom: from, windowTo: now, status: "running", triggeredBy: opts.triggeredBy ?? "system" })
  })

  try {
    const items: Item[] = []
    let checked = 0

    // Read-only phase. Provider I/O happens outside any transaction.
    const lister = providerLister()
    let providerEvents: ProviderEvent[] | null = null
    if (lister) {
      try {
        providerEvents = await lister({ from: new Date(from.getTime() - 24 * HOUR), to: now })
      } catch (e) {
        log.warn(`[yard] reconciliation: provider events unavailable (${e instanceof Error ? e.name : "error"})`)
      }
    }

    await withTx(async (tx) => {
      // 1. Unbalanced transactions in the window.
      const unbalanced = await tx
        .select({ id: ledgerEntries.transactionId, currency: ledgerTransactions.currency, diff: sql<number>`sum(case when ${ledgerEntries.direction} = 'debit' then ${ledgerEntries.amountMinor} else -${ledgerEntries.amountMinor} end)::bigint`.mapWith(Number) })
        .from(ledgerEntries)
        .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
        .where(gte(ledgerTransactions.createdAt, from))
        .groupBy(ledgerEntries.transactionId, ledgerTransactions.currency)
      checked += unbalanced.length
      for (const u of unbalanced) if (u.diff !== 0) items.push({ kind: "unbalanced_transaction", ref: u.id, currency: u.currency, ledgerMinor: u.diff })

      // 2. Cached balances against their entries (every account).
      const drift = await tx
        .select({
          id: ledgerAccounts.id,
          currency: ledgerAccounts.currency,
          cached: ledgerAccounts.balanceMinor,
          computed: sql<number>`coalesce(sum(case when ${ledgerEntries.direction} = ${ledgerAccounts.normal} then ${ledgerEntries.amountMinor} else -${ledgerEntries.amountMinor} end), 0)::bigint`.mapWith(Number),
        })
        .from(ledgerAccounts)
        .leftJoin(ledgerEntries, eq(ledgerEntries.accountId, ledgerAccounts.id))
        .groupBy(ledgerAccounts.id, ledgerAccounts.currency, ledgerAccounts.balanceMinor)
      checked += drift.length
      for (const a of drift) if (a.cached !== a.computed) items.push({ kind: "balance_drift", ref: a.id, currency: a.currency, ledgerMinor: a.cached, facts: { computedMinor: a.computed } })

      // 3. Payouts stuck in flight.
      const stuck = await tx
        .select({ id: payouts.id, currency: payouts.currency, amount: payouts.amountMinor, status: payouts.status })
        .from(payouts)
        .where(and(inArray(payouts.status, ["sending", "processing"]), lt(payouts.updatedAt, new Date(now.getTime() - ledgerConfig.stuckPayoutHours * HOUR))))
      for (const s of stuck) items.push({ kind: "stuck_payout", ref: s.id, currency: s.currency, ledgerMinor: s.amount, facts: { status: s.status } })

      // 4. Provider comparison.
      if (providerEvents) {
        const ok = providerEvents.filter((e) => e.status === "succeeded")
        const sumBy = (kind: ProviderEvent["kind"]) => {
          const m = new Map<string, { amount: number; currency: string; at: Date }>()
          for (const e of ok.filter((x) => x.kind === kind)) {
            const cur = m.get(e.ref)
            m.set(e.ref, { amount: (cur?.amount ?? 0) + e.amountMinor, currency: e.currency, at: cur && cur.at > e.at ? cur.at : e.at })
          }
          return m
        }
        // Transfers the provider reports failed / reversed after a success (CHECKOUT marks a reversed transfer 'failed').
        const providerUnpaidTransfers = new Set(providerEvents.filter((e) => e.kind === "transfer" && (e.status === "failed" || e.status === "reversed")).map((e) => e.ref))
        const providerCharges = sumBy("charge")
        const providerRefunds = sumBy("refund")
        const providerTransfers = sumBy("transfer")

        // What the ledger moved through provider_clearing, by business id.
        const clearing = async (kind: "payment_captured" | "refund" | "payout_paid" | "payout_reversed", col: AnyPgColumn, ids?: string[], window?: { from: Date; to: Date }) => {
          const conds = [eq(ledgerTransactions.kind, kind), eq(ledgerAccounts.kind, "provider_clearing")]
          if (ids) conds.push(inArray(col, ids.length ? ids : ["__none__"]))
          if (window) conds.push(gte(ledgerTransactions.createdAt, window.from), lt(ledgerTransactions.createdAt, window.to))
          const rows = await tx
            .select({ ref: col, currency: ledgerTransactions.currency, total: sql<number>`sum(${ledgerEntries.amountMinor})::bigint`.mapWith(Number) })
            .from(ledgerEntries)
            .innerJoin(ledgerTransactions, eq(ledgerTransactions.id, ledgerEntries.transactionId))
            .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.accountId))
            .where(and(...conds))
            .groupBy(col, ledgerTransactions.currency)
          return new Map(rows.filter((r) => r.ref).map((r) => [r.ref as string, { amount: r.total, currency: r.currency }]))
        }

        const compare = async (label: "charge" | "refund" | "transfer", provider: Map<string, { amount: number; currency: string; at: Date }>, kind: "payment_captured" | "refund" | "payout_paid", col: AnyPgColumn) => {
          // Provider → ledger: every settled provider event in the window has a matching posting.
          const inWindow = [...provider.entries()].filter(([, v]) => v.at >= from && v.at < settledTo)
          const ledger = await clearing(kind, col, inWindow.map(([k]) => k))
          for (const [ref, v] of inWindow) {
            checked++
            const l = ledger.get(ref)
            if (!l) items.push({ kind: "missing_in_ledger", ref, currency: v.currency, providerMinor: v.amount, facts: { event: label } })
            else if (l.amount !== v.amount || l.currency !== v.currency) items.push({ kind: "amount_mismatch", ref, currency: v.currency, ledgerMinor: l.amount, providerMinor: v.amount, facts: { event: label, ledgerCurrency: l.currency } })
          }
          // Ledger → provider: every posting in the window has a provider event (any time in the fetched range).
          const posted = await clearing(kind, col, undefined, { from, to: settledTo })
          // A paid payout the bank later returned: the ledger reversed it (payout_reversed), the provider says failed. Settled both sides.
          const reversed = label === "transfer" && posted.size ? await clearing("payout_reversed", ledgerTransactions.payoutId, [...posted.keys()]) : new Map<string, { amount: number; currency: string }>()
          for (const [ref, l] of posted) {
            checked++
            if (provider.has(ref)) continue
            const rev = reversed.get(ref)
            if (rev && rev.amount === l.amount && providerUnpaidTransfers.has(ref)) continue
            items.push({ kind: "missing_at_provider", ref, currency: l.currency, ledgerMinor: l.amount, facts: { event: label } })
          }
        }
        await compare("charge", providerCharges, "payment_captured", ledgerTransactions.paymentId)
        await compare("refund", providerRefunds, "refund", ledgerTransactions.refundId)
        await compare("transfer", providerTransfers, "payout_paid", ledgerTransactions.payoutId)
      }
    })

    await withTx(async (tx) => {
      if (items.length) {
        await tx.insert(reconciliationItems).values(
          items.map((i) => ({ id: newId("rci"), runId, kind: i.kind, ref: i.ref, currency: i.currency ?? null, ledgerMinor: i.ledgerMinor ?? null, providerMinor: i.providerMinor ?? null, facts: i.facts ?? {} })),
        )
      }
      const summary: Record<string, number> = {}
      for (const i of items) summary[i.kind] = (summary[i.kind] ?? 0) + 1
      await tx
        .update(reconciliationRuns)
        .set({ status: items.length ? "mismatches" : "ok", providerCompared: !!providerEvents, checked, mismatches: items.length, summary, finishedAt: new Date() })
        .where(eq(reconciliationRuns.id, runId))
      if (items.length) {
        afterCommit(async () => {
          await publish(channels.admin, "finance.reconciliation", { runId, mismatches: items.length })
        })
      }
    })
    if (items.length) log.warn(`[yard] reconciliation ${runId}: ${items.length} mismatches`)
    return { runId, mismatches: items.length, providerCompared: !!providerEvents, checked }
  } catch (e) {
    await withTx(async (tx) => {
      await tx.update(reconciliationRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(reconciliationRuns.id, runId))
    }).catch(() => {})
    throw e
  }
}

export async function listRuns(limit = 30) {
  return withTx(async (tx) => tx.select().from(reconciliationRuns).orderBy(desc(reconciliationRuns.startedAt)).limit(Math.min(limit, 200)))
}

export async function getRun(id: string) {
  return withTx(async (tx) => {
    const [run] = await tx.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, id))
    if (!run) throw notFound("We couldn't find that reconciliation run.")
    const items = await tx.select().from(reconciliationItems).where(eq(reconciliationItems.runId, id))
    return { run, items }
  })
}

export async function resolveItem(actor: AdminActor, itemId: string, note: string, ipHash: string | null) {
  assertAdminFinance(actor)
  return withTx(async (tx) => {
    const [item] = await tx.select().from(reconciliationItems).where(eq(reconciliationItems.id, itemId)).for("update")
    if (!item) throw notFound("We couldn't find that item.")
    if (item.status === "resolved") throw conflict("This item is already resolved.")
    const [saved] = await tx
      .update(reconciliationItems)
      .set({ status: "resolved", resolvedBy: actor.userId, resolvedAt: new Date(), resolutionNote: note })
      .where(eq(reconciliationItems.id, itemId))
      .returning()
    await writeAudit({
      actor: { kind: "admin", id: actor.userId, name: actor.name, role: actor.role },
      action: "finance.reconciliation_resolved",
      subjectType: "reconciliation_item",
      subjectId: itemId,
      reason: note,
      ipHash,
      meta: { kind: item.kind, ref: item.ref, runId: item.runId },
    })
    return saved
  })
}
