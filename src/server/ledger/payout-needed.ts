import "server-only"
import { and, inArray, ne } from "drizzle-orm"
import { PAYOUT_NEEDED_TEMPLATE } from "@/lib/payout-needed"
import { writeAudit } from "../audit"
import { notSampleBrandSql, refusedSampleBrand } from "../catalog/sample-guard"
import { db, withTx, type Tx } from "../db"
import { brands, orderRefs } from "../db/schema"
import { enqueueEmail } from "../email"
import { renderEmail } from "../email/templates"
import { log } from "../log"
import { notePaidSales, sendPayoutReminders, type Db, type Enqueue, type PayoutNeededOutcome } from "./payout-needed-db"

/** "Add your payout account" emails, wired into the app (the rules and queries: payout-needed-db.ts). */

const enqueue: Enqueue = (ex, input) => enqueueEmail(ex as unknown as Tx, input)

async function audit(o: Extract<PayoutNeededOutcome, { queued: number }>, reference?: string) {
  await writeAudit({
    actor: { kind: "system", name: "Yard" },
    action: o.variant === "reminder" ? "brand_email.payout_reminder" : "brand_email.payout_needed",
    subjectType: "brand",
    subjectId: o.brandId,
    brandId: o.brandId,
    meta: { template: PAYOUT_NEEDED_TEMPLATE, emailed: o.queued, sales: o.sales, ...(reference ? { reference } : {}) },
  })
}

/**
 * PAYMENTS calls this in the payment's transaction, after the ledger posting, with the orders just
 * paid (one per brand). Never throws: an email problem must not undo a captured payment.
 */
export async function notifyPayoutNeeded(tx: Tx, orderIds: string[]): Promise<void> {
  if (!orderIds.length) return
  try {
    // In a savepoint: a failure here rolls back only this step, never the payment around it.
    const { sales, outcomes } = await tx.transaction(async (sp) => {
      const sales = await sp.select({ brandId: orderRefs.brandId, reference: orderRefs.reference }).from(orderRefs).where(and(inArray(orderRefs.id, orderIds), ne(orderRefs.status, "cancelled")))
      return { sales, outcomes: await notePaidSales(sp as unknown as Db, sales, enqueue, { exclude: refusedSampleBrand }) }
    })
    for (const o of outcomes) if ("queued" in o) await audit(o, sales.find((s) => s.brandId === o.brandId)?.reference)
  } catch (e) {
    log.error("[yard] payout-needed email after a paid order failed (the payment stands)", e)
  }
}

/** Ledger job (hourly): the one reminder per brand, 3 days after its first sale without a payout account. */
export async function payoutReminders(now = new Date()) {
  const d = (await db()) as unknown as Db
  const out = await sendPayoutReminders(d, (fn) => withTx((tx) => fn(tx as unknown as Db)), enqueue, { now, guard: notSampleBrandSql(brands.id), onQueued: (_tx, o) => audit(o) })
  const sent = out.filter((o) => "queued" in o)
  if (sent.length) log.info(`[yard] payout reminders: ${sent.length} brands, ${sent.reduce((n, o) => n + ("queued" in o ? o.queued : 0), 0)} emails queued`)
  return { reminded: sent.length }
}

/** Admin preview (Admin › Newsletter): the real email with sample figures. Sends nothing. */
export function previewPayoutNeeded(opts: { variant: "sale" | "reminder"; brand?: string; owed?: string; sales?: number; reference?: string }) {
  const r = renderEmail(PAYOUT_NEEDED_TEMPLATE, { brand: opts.brand ?? "Lagos Static", owed: opts.owed ?? "₦84,550", sales: opts.sales ?? 3, variant: opts.variant, ...(opts.variant === "sale" ? { reference: opts.reference ?? "YRD-48213-1" } : {}) }, { unsubscribeUrl: null })
  return { subject: r.subject, html: r.html, text: r.text }
}
