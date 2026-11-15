import { sql } from "drizzle-orm"
import type { Exec } from "./audience"

/**
 * One batch of a sending campaign, plain Node so `tsx --test` proves it against PGlite
 * (batch.test.ts). Inside ONE transaction: claim up to `limit` pending recipients (FOR UPDATE SKIP
 * LOCKED, so two runs never take the same rows), hand each to the email outbox with its dedupe key,
 * and mark them queued. Either all of that commits or none of it does; and if a run dies after the
 * outbox insert but before its own commit, the outbox insert rolls back with it. A retried hand-off
 * of the same recipient is a no-op in the outbox (unique dedupe key), so nobody gets a campaign twice.
 */
export type EnqueueFn = (tx: Exec, input: { template: string; to: string; vars: Record<string, string | number>; dedupeKey: string }) => Promise<void>
export type TxFn = <T>(fn: (tx: Exec) => Promise<T>) => Promise<T>

const rows = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]

export async function feedCampaign(deps: { withTx: TxFn; enqueue: EnqueueFn }, campaign: { id: string; template: string }, limit: number): Promise<{ queued: number; remaining: number }> {
  if (limit <= 0) return { queued: 0, remaining: await pendingCount(deps, campaign.id) }
  const queued = await deps.withTx(async (tx) => {
    const batch = rows<{ user_id: string; email: string; name: string; dedupe_key: string }>(
      await tx.execute(sql`select user_id, email, name, dedupe_key from newsletter_recipients
        where campaign_id = ${campaign.id} and status = 'pending'
        order by user_id limit ${limit} for update skip locked`),
    )
    for (const r of batch) await deps.enqueue(tx, { template: campaign.template, to: r.email, vars: { campaignId: campaign.id, name: r.name }, dedupeKey: r.dedupe_key })
    if (batch.length)
      await tx.execute(sql`update newsletter_recipients set status = 'queued', queued_at = now()
        where campaign_id = ${campaign.id} and status = 'pending' and user_id in (${sql.join(
          batch.map((r) => sql`${r.user_id}`),
          sql`, `,
        )})`)
    return batch.length
  })
  return { queued, remaining: await pendingCount(deps, campaign.id) }
}

async function pendingCount(deps: { withTx: TxFn }, campaignId: string) {
  return deps.withTx(async (tx) => Number(rows<{ n: number }>(await tx.execute(sql`select count(*)::int as n from newsletter_recipients where campaign_id = ${campaignId} and status = 'pending'`))[0]?.n ?? 0))
}

/**
 * Copies what the outbox did with each queued recipient (sent, failed, suppressed, stub) onto the
 * recipient row, so the campaign keeps its stats after the outbox purges old rows (90 days).
 * Returns how many rows changed.
 */
export async function reconcileCampaign(ex: Exec, campaignId: string): Promise<number> {
  const r = rows<{ user_id: string }>(
    await ex.execute(sql`update newsletter_recipients r set status = o.status, sent_at = o.sent_at, last_error = left(o.last_error, 300)
      from email_outbox o
      where r.campaign_id = ${campaignId} and r.status = 'queued' and o.dedupe_key = r.dedupe_key
        and o.status in ('sent', 'failed', 'suppressed', 'stub')
      returning r.user_id`),
  )
  return r.length
}

/** The campaign's counts by recipient status, plus unsubscribes from its link. */
export async function campaignCounts(ex: Exec, campaignId: string): Promise<Record<string, number>> {
  const r = rows<{ status: string; n: number }>(await ex.execute(sql`select status, count(*)::int as n from newsletter_recipients where campaign_id = ${campaignId} group by status`))
  const u = rows<{ n: number }>(await ex.execute(sql`select count(*)::int as n from newsletter_recipients where campaign_id = ${campaignId} and unsubscribed_at is not null`))
  const out: Record<string, number> = { pending: 0, queued: 0, sent: 0, failed: 0, suppressed: 0, stub: 0, cancelled: 0, unsubscribed: Number(u[0]?.n ?? 0) }
  for (const x of r) out[x.status] = Number(x.n)
  return out
}
