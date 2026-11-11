import "server-only"
import { getEnv, demoAuthWarning } from "../env"
import { log } from "../log"
import { getDb } from "./client"

/**
 * The database API for everything outside src/server/db (§1.3). `getDb` is deliberately not
 * exported: every query goes through db() or withTx().
 */
export { db, withTx, afterCommit, inTransaction, withBeforeCommit, type BeforeCommit, type Executor, type Tx } from "./tx"
export * as t from "./schema"

/**
 * Warms the server before the first request (instrumentation.ts): env, the demo warning, the
 * database, then ends every session of an actor kind whose demo sign-in is off (§2.3), so a
 * restart without YARD_DEMO_AUTH / YARD_DEMO_ADMIN signs those sessions out at once.
 */
export async function warmUp() {
  const env = getEnv()
  const warning = demoAuthWarning(env)
  if (warning) log.once("demo-auth-warning", "warn", warning)
  // Which payments this process takes, once at startup (YARD_PAYMENTS).
  const { paymentsStartupLine } = await import("../payments/config")
  log.once("payments-mode", "info", paymentsStartupLine())
  await getDb()
  const { purgeDisabledSessions } = await import("../auth/session")
  const ended = await purgeDisabledSessions()
  if (ended) log.warn(`[yard] Ended ${ended} demo ${ended === 1 ? "session" : "sessions"}: demo sign-in is off for that account kind.`)
}

/**
 * For /api/health: whether the database answers (`select 1`, bounded by `timeoutMs`) and whether
 * its schema matches this build. On Postgres a database behind this build's migrations is
 * "pending" (the server refuses to open it; run npm run db:migrate). Never throws.
 */
type DbHealth = { kind: "postgres" | "pglite"; db: "ok" | "down" | "pending"; migrations: { applied: number; expected: number } | null }
let lastHealth: { at: number; value: Promise<DbHealth> } | undefined

/** dbHealth shared for a second, so a burst of health requests costs the database two queries, not two per request. */
export function dbHealthCached(): Promise<DbHealth> {
  if (lastHealth && Date.now() - lastHealth.at < 1000) return lastHealth.value
  const value = dbHealth()
  lastHealth = { at: Date.now(), value }
  return value
}

export async function dbHealth(timeoutMs = 2000): Promise<DbHealth> {
  const { dbKind, MigrationsPendingError, migrationState } = await import("./client")
  const { sql } = await import("drizzle-orm")
  const kind = dbKind()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs)
  })
  try {
    return await Promise.race([
      (async () => {
        const root = await getDb()
        await root.execute(sql`select 1`)
        const m = await migrationState()
        return { kind, db: m.pending ? ("pending" as const) : ("ok" as const), migrations: { applied: m.applied, expected: m.expected } }
      })(),
      timeout,
    ])
  } catch (e) {
    if (e instanceof MigrationsPendingError) return { kind, db: "pending", migrations: { applied: e.state.applied, expected: e.state.expected } }
    log.once("health-db-down", "warn", "[yard] health: the database didn't answer", e)
    return { kind, db: "down", migrations: null }
  } finally {
    clearTimeout(timer)
  }
}
