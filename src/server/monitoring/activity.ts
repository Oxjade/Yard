/**
 * The Health page's database reads (no server-only, no getEnv: the tests run them on an in-memory
 * PGlite with the migrations; service.ts memoises them and passes the demo guards). Every count
 * comes from tables Yard already keeps: no new counters.
 */
import { sql, type SQL } from "drizzle-orm"
import type { BusinessCount } from "./series"
import type { Db } from "./store"

export type Guards = {
  /** Leaves sample brands out (production): a SQL predicate over a brand id column. */
  notSampleBrand?: (column: SQL) => SQL
  /** Leaves demo accounts out (production). */
  realUsersOnly?: boolean
}

const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]

/**
 * Business activity since `since`, bucketed every `stepMs` (aligned to the Unix epoch, so day
 * buckets are UTC days whatever the database session's time zone): one query, a UNION of one
 * grouped count per table. k: orders (placed), paid (orders paid), revenue (per currency, minor
 * units in v), signups (new shopper accounts), applications (brand applications submitted),
 * brands (storefronts launched), products (published), messages (sent).
 */
export async function businessCounts(d: Db, since: Date, stepMs: number, g: Guards = {}): Promise<BusinessCount[]> {
  const step = Math.round(stepMs / 1000)
  const b = (col: SQL) => sql`(floor(extract(epoch from ${col}) / ${step}) * ${step} * 1000)::bigint`
  const nb = g.notSampleBrand ?? (() => sql`true`)
  const real = g.realUsersOnly ? sql`u.demo = false` : sql`true`
  // Demo accounts' rows (seeded conversations, applications) never count in production.
  const realUser = (col: SQL) => (g.realUsersOnly ? sql`(${col} is null or exists (select 1 from users ru where ru.id = ${col} and ru.demo = false))` : sql`true`)
  const r = await d.execute(sql`
    select 'orders' as k, null::text as cur, ${b(sql`o.created_at`)} as b, count(*)::int as n, 0::bigint as v
      from order_states o where o.created_at >= ${since} and ${nb(sql`o.brand_id`)} group by 3
    union all
    select 'paid', null, ${b(sql`o.paid_at`)}, count(*)::int, 0::bigint
      from order_states o where o.paid_at >= ${since} and o.payment_status in ('paid', 'partially_refunded', 'refunded') and ${nb(sql`o.brand_id`)} group by 3
    union all
    select 'revenue', o.currency, ${b(sql`o.paid_at`)}, count(*)::int, coalesce(sum(o.total_minor), 0)::bigint
      from order_states o where o.paid_at >= ${since} and o.payment_status in ('paid', 'partially_refunded', 'refunded') and ${nb(sql`o.brand_id`)} group by 2, 3
    union all
    select 'signups', null, ${b(sql`u.created_at`)}, count(*)::int, 0::bigint
      from users u where u.created_at >= ${since} and u.kind = 'shopper' and ${real} group by 3
    union all
    select 'applications', null, ${b(sql`a.submitted_at`)}, count(*)::int, 0::bigint
      from catalog_brand_onboardings a where a.submitted_at >= ${since} and ${realUser(sql`a.user_id`)} group by 3
    union all
    select 'brands', null, ${b(sql`br.launched_at`)}, count(*)::int, 0::bigint
      from brands br where br.launched_at >= ${since} and ${nb(sql`br.id`)} group by 3
    union all
    select 'products', null, ${b(sql`p.published_at`)}, count(*)::int, 0::bigint
      from catalog_products p where p.published_at >= ${since} and ${nb(sql`p.brand_id`)} group by 3
    union all
    select 'messages', null, ${b(sql`m.created_at`)}, count(*)::int, 0::bigint
      from messages m join conversations c on c.id = m.conversation_id
      where m.created_at >= ${since} and (c.brand_id is null or ${nb(sql`c.brand_id`)}) and ${realUser(sql`m.sender_user_id`)} group by 3
  `)
  return rowsOf<{ k: string; cur: string | null; b: number | string | bigint; n: number; v: number | string | bigint }>(r).map((x) => ({ k: x.k, cur: x.cur, b: Number(x.b), n: Number(x.n), v: Number(x.v) }))
}

/* ── Queue depth ──────────────────────────────────────────────────────── */

export type QueueRow = { key: string; name: string; hint: string; depth: number; oldestAt: string | null; failed: number; alertAt: number }

/** Alert levels: a queue at or over its level shows in acid. Tuned for one small server. */
export const QUEUES: { key: string; name: string; hint: string; alertAt: number }[] = [
  { key: "email", name: "Email outbox", hint: "Waiting to send", alertAt: 500 },
  { key: "newsletter", name: "Newsletter recipients", hint: "Not yet handed to the outbox", alertAt: 20_000 },
  { key: "imports", name: "Website imports", hint: "Scanning or importing", alertAt: 5 },
  { key: "watches", name: "Website watches due", hint: "Brand sites due a check", alertAt: 25 },
  { key: "indexnow", name: "IndexNow", hint: "Changed pages not yet sent", alertAt: 10_000 },
  { key: "webhooks", name: "Payment webhooks", hint: "Received, not processed", alertAt: 10 },
  { key: "refunds", name: "Refunds", hint: "Pending with the provider", alertAt: 20 },
  { key: "transfers", name: "Brand transfers", hint: "Pending with the provider", alertAt: 50 },
]

/** Real depths, oldest waiting item and recent failures (24 h) for every job table, in one query. */
export async function queueDepths(d: Db, now = new Date()): Promise<QueueRow[]> {
  const day = new Date(now.getTime() - 86_400_000)
  const r = await d.execute(sql`
    select 'email' as key, count(*) filter (where status in ('pending', 'sending'))::int as depth, min(created_at) filter (where status in ('pending', 'sending')) as oldest, count(*) filter (where status = 'failed' and created_at >= ${day})::int as failed from email_outbox
    union all
    select 'newsletter', count(*) filter (where status in ('pending', 'queued'))::int, min(coalesce(queued_at, created_at)) filter (where status in ('pending', 'queued')), count(*) filter (where status = 'failed' and created_at >= ${day})::int from newsletter_recipients
    union all
    select 'imports', count(*) filter (where status in ('scanning', 'importing'))::int, min(created_at) filter (where status in ('scanning', 'importing')), count(*) filter (where status = 'failed' and updated_at >= ${day})::int from catalog_imports
    union all
    select 'watches', count(*) filter (where enabled and status = 'active' and next_scan_at <= ${now})::int, min(next_scan_at) filter (where enabled and status = 'active' and next_scan_at <= ${now}), count(*) filter (where status = 'paused')::int from catalog_watches
    union all
    select 'indexnow', count(*) filter (where pending)::int, min(queued_at) filter (where pending), count(*) filter (where pending and attempts > 0)::int from indexnow_urls
    union all
    select 'webhooks', count(*) filter (where status = 'received')::int, min(received_at) filter (where status = 'received'), count(*) filter (where status = 'failed' and received_at >= ${day})::int from provider_events
    union all
    select 'refunds', count(*) filter (where status = 'pending')::int, min(created_at) filter (where status = 'pending'), count(*) filter (where status = 'failed' and created_at >= ${day})::int from refunds
    union all
    select 'transfers', count(*) filter (where status = 'pending')::int, min(created_at) filter (where status = 'pending'), count(*) filter (where status = 'failed' and created_at >= ${day})::int from transfers
  `)
  const got = new Map(rowsOf<{ key: string; depth: number; oldest: string | Date | null; failed: number }>(r).map((x) => [x.key, x]))
  return QUEUES.map((q) => {
    const x = got.get(q.key)
    return { ...q, depth: Number(x?.depth ?? 0), failed: Number(x?.failed ?? 0), oldestAt: x?.oldest ? new Date(x.oldest).toISOString() : null }
  })
}

/* ── Storage ──────────────────────────────────────────────────────────── */

export type StoragePart = { purpose: string; bytes: number; files: number }

/** Stored media bytes by purpose (the sizes media_assets records), and what the last 7 days added. */
export async function mediaStorage(d: Db, now = new Date()) {
  const week = new Date(now.getTime() - 7 * 86_400_000)
  const r = await d.execute(sql`
    select purpose, coalesce(sum(bytes), 0)::bigint as bytes, count(*)::int as files, coalesce(sum(bytes) filter (where created_at >= ${week}), 0)::bigint as week
    from media_assets group by purpose order by 2 desc
  `)
  const rows = rowsOf<{ purpose: string; bytes: string | number; files: number; week: string | number }>(r)
  return {
    parts: rows.map((x) => ({ purpose: x.purpose, bytes: Number(x.bytes), files: Number(x.files) })) as StoragePart[],
    total: rows.reduce((s, x) => s + Number(x.bytes), 0),
    added7d: rows.reduce((s, x) => s + Number(x.week), 0),
  }
}

/* ── Auth failures ────────────────────────────────────────────────────── */

/** Rate-limit blocks recorded in abuse_events since `since` (recordAbuse keeps one per caller a minute). */
export async function rateLimitBlocks(d: Db, since: Date) {
  const r = await d.execute(sql`
    select count(*) filter (where action like 'auth.%')::int as auth, count(*)::int as total
    from abuse_events where created_at >= ${since} and rule in ('rate_limit', 'daily_cap')
  `)
  const x = rowsOf<{ auth: number; total: number }>(r)[0]
  return { auth: Number(x?.auth ?? 0), total: Number(x?.total ?? 0) }
}
