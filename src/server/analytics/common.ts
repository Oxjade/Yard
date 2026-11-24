/**
 * Shared pieces for the analytics reads (Studio › Analytics and Customers, the Control Center's
 * marketplace performance, Finance › Commission). No server-only and no getEnv: the tests run the
 * same queries on an in-memory PGlite with the migrations applied; the server wrappers
 * (./index.ts) add the demo guards, the memo and the route.
 */
import { sql, type SQL } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
export type Db = PgDatabase<PgQueryResultHKT, any>

/**
 * What production leaves out (the demo switch off). Empty in demo and development, so the
 * sample screens there are unchanged.
 * - `sampleBrandIds`: the bundled sample brands (src/lib/data/sample-ids.ts), by identity.
 * - `realUsersOnly`: demo accounts' orders, signals and sign-ups never count.
 */
export type Guards = { sampleBrandIds?: Iterable<string>; realUsersOnly?: boolean }

export const DAY_MS = 86_400_000

export const rowsOf = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]

/** "YYYY-MM-DD" (UTC). */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (day: string, n: number) => utcDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS)
export const dayStart = (day: string) => new Date(`${day}T00:00:00Z`)

/** Every day from `from` to `to` inclusive, oldest first. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** SQL: `column` is not one of the sample brands (always true without the guard). */
export function notSampleBrand(column: SQL, g: Guards): SQL {
  const ids = g.sampleBrandIds ? [...g.sampleBrandIds] : []
  if (!ids.length) return sql`true`
  return sql`${column} not in (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`
}

/** SQL: the user behind `column` is a real account (always true without the guard). Null passes (no user to check). */
export function realUser(column: SQL, g: Guards): SQL {
  if (!g.realUsersOnly) return sql`true`
  return sql`(${column} is null or not exists (select 1 from users du where du.id = ${column} and du.demo = true))`
}

export const isSampleBrandId = (id: string, g: Guards) => !!g.sampleBrandIds && new Set(g.sampleBrandIds).has(id)

/**
 * Payment captured on an order (`r` order_refs, `s` order_states, left-joined): the rule the
 * Studio Overview and Orders page use (src/server/orders/overview.ts), so every page counts the
 * same orders. A v3 state row decides when there is one; else the order_ref's own paid flag.
 * Fully refunded orders don't count; partly refunded ones do.
 */
export const capturedSql = (r = "r", s = "s") =>
  sql.raw(`coalesce(${s}.payment_status, case when ${r}.status = 'refunded' then 'refunded' when ${r}.paid then 'paid' else 'pending' end) in ('paid', 'partially_refunded')`)

/** An image row's src, the way the media DTO builds it (`/api/media/<id>`, else the stored /media path). */
export function imageSrc(mediaId: string | null | undefined, path: string | null | undefined): string | null {
  if (mediaId) return `/api/media/${encodeURIComponent(mediaId)}`
  return path || null
}

export const num = (v: unknown) => Number(v ?? 0)
