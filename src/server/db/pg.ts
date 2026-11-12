import "server-only"
import pg from "pg"
import { getEnv } from "../env"
import { log } from "../log"
import { yard } from "../state"
import { setPgliteCompatibleParsers } from "./pg-types"

/**
 * node-postgres for a real deployment (DATABASE_URL). Everything here exists so Postgres answers
 * the way the embedded PGlite does (hosting plan A.3), because the code was written against PGlite:
 *
 * - int8 (count(*), sum(), bigint columns read through execute()): PGlite returns a JS number (a
 *   BigInt only past 2^53); node-postgres returns a string. The parsers below return what PGlite
 *   returns, so `count + 1` and the refund totals in payments/money.ts stay arithmetic.
 * - Timestamp text follows the session TimeZone: every connection runs in UTC, like PGlite.
 * - Collation: the databases are created with LC_COLLATE 'C' (deploy/setup.sh), PGlite's own.
 * - Concurrency is real here (PGlite runs one transaction at a time): tx.ts retries the outermost
 *   transaction once on a deadlock or serialization failure.
 */

/** Per-connection settings: UTC like PGlite, and bounded waits so a stuck query can't hold a pooled connection forever. */
export const CONNECTION_OPTIONS = "-c timezone=UTC -c statement_timeout=15000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=30000"

type PoolState = { pgPool?: pg.Pool; pgPoolClosing?: Promise<void> }

/** The process's pool (created on first use). */
export function getPool(): pg.Pool {
  const s = yard as PoolState
  if (s.pgPool) return s.pgPool
  const env = getEnv()
  if (!env.databaseUrl) throw new Error("getPool() without DATABASE_URL")
  setPgliteCompatibleParsers()
  const pool = new pg.Pool({
    connectionString: env.databaseUrl,
    max: env.pgPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: `yard-${env.envName}`,
    options: CONNECTION_OPTIONS,
  })
  // An idle connection the server dropped (restart, idle timeout): logged through the redacting
  // logger; the pool replaces it on the next checkout.
  pool.on("error", (e) => log.error("[yard] Postgres pool connection error", e))
  s.pgPool = pool
  return pool
}

/** Ends the pool (scripts, the migrator). Safe to call twice. The server never ends it while running. */
export function closePool(): Promise<void> {
  const s = yard as PoolState
  const pool = s.pgPool
  if (!pool) return Promise.resolve()
  return (s.pgPoolClosing ??= pool.end().catch(() => {}))
}

/** A dedicated connection outside the pool (locks held for the life of the process, the migrator). */
export function newClient(extra?: { statementTimeoutMs?: number; applicationName?: string }) {
  const env = getEnv()
  setPgliteCompatibleParsers()
  const options = extra?.statementTimeoutMs === undefined ? CONNECTION_OPTIONS : `-c timezone=UTC -c statement_timeout=${extra.statementTimeoutMs} -c lock_timeout=60000`
  return new pg.Client({ connectionString: env.databaseUrl!, application_name: extra?.applicationName ?? `yard-${env.envName}`, options, connectionTimeoutMillis: 10_000 })
}
