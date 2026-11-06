import "server-only"
import { getEnv, demoAuthWarning } from "../env"
import { log } from "../log"
import { getDb } from "./client"

/**
 * The database API for everything outside src/server/db (§1.3). `getDb` is deliberately not
 * exported: every query goes through db() or withTx().
 */
export { db, withTx, afterCommit, inTransaction, type Executor, type Tx } from "./tx"
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
  await getDb()
  const { purgeDisabledSessions } = await import("../auth/session")
  const ended = await purgeDisabledSessions()
  if (ended) log.warn(`[yard] Ended ${ended} demo ${ended === 1 ? "session" : "sessions"}: demo sign-in is off for that account kind.`)
}
