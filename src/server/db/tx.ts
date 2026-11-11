import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { log } from "../log"
import { getDb, type Root } from "./client"

/**
 * PGlite has ONE connection and drizzle's transaction holds it exclusively (§1.3). A query sent
 * on the root handle from inside a transaction callback waits forever and wedges the process (on
 * Postgres it takes a second pooled connection that can't see the transaction's rows), so
 * every query goes through db(), which joins the ambient transaction, and side effects wait for
 * commit through afterCommit(). No network, file or fetch I/O inside a transaction.
 */
export type Tx = Parameters<Parameters<Root["transaction"]>[0]>[0]
export type Executor = Root | Tx

type Scope = { tx: Tx; after: (() => void | Promise<void>)[] }
const als = new AsyncLocalStorage<Scope>()

/** The ambient transaction when there is one, otherwise the root handle. */
export async function db(): Promise<Executor> {
  return als.getStore()?.tx ?? (await getDb())
}

/** True inside withTx. */
export function inTransaction() {
  return !!als.getStore()
}

/** Runs `fn` in a transaction. A nested call joins the ambient one. */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const cur = als.getStore()
  if (cur) return fn(cur.tx)
  return runTx(await getDb(), fn)
}

/**
 * A request-scoped step that runs as the last statement of the first outermost transaction the
 * request opens, inside it (so it commits or rolls back with the write). route() uses it to write
 * the Yard setup audit row atomically with the staff write. `ran` is 1 once it has run.
 */
export type BeforeCommit = { run: (tx: Tx) => Promise<void>; ran: number }
const beforeCommitAls = new AsyncLocalStorage<BeforeCommit>()

/** Runs `fn` with `hook` attached to every transaction it opens (see BeforeCommit). */
export function withBeforeCommit<T>(hook: BeforeCommit, fn: () => Promise<T>): Promise<T> {
  return beforeCommitAls.run(hook, fn)
}

/**
 * Postgres runs transactions concurrently (PGlite runs one at a time), so two requests can
 * deadlock (40P01) or, under a stricter isolation, fail to serialize (40001). Postgres has already
 * rolled the loser back; it is retried once, from the start, as the outermost transaction. That is
 * safe because nothing inside a transaction does I/O (side effects wait in afterCommit, and the
 * queue of a rolled-back attempt is dropped).
 */
const RETRYABLE = new Set(["40P01", "40001"])
function retryable(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    const code = (cur as { code?: unknown }).code
    if (typeof code === "string" && RETRYABLE.has(code)) return true
  }
  return false
}

/** withTx on an explicit root: the seed runner uses it while the boot promise is still pending. */
export async function runTx<T>(root: Root, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const hook = beforeCommitAls.getStore()
  for (let attempt = 0; ; attempt++) {
    const ranBefore = hook?.ran ?? 0
    try {
      return await attemptTx(root, fn, hook)
    } catch (e) {
      if (attempt >= 1 || !retryable(e)) throw e
      if (hook) hook.ran = ranBefore // the step rolled back with the attempt: run it again
      log.warn(`[yard] transaction ${(e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? ""} (deadlock or serialization failure); retrying once`)
    }
  }
}

async function attemptTx<T>(root: Root, fn: (tx: Tx) => Promise<T>, hook: BeforeCommit | undefined): Promise<T> {
  const after: Scope["after"] = []
  const out = await root.transaction((tx) =>
    als.run({ tx, after }, async () => {
      const r = await fn(tx)
      // A failure here throws, so the transaction (and the write it belongs to) rolls back.
      // Once per request: the first transaction it opens carries the step (later ones, and
      // after-commit work, are covered by it).
      if (hook && !hook.ran) {
        await hook.run(tx)
        hook.ran++
      }
      return r
    }),
  )
  // Committed. A rollback throws before this point, so its queue is dropped.
  for (const f of after) await Promise.resolve().then(f).catch((e) => log.error("[yard] after-commit", e))
  return out
}

/** Runs `f` after the ambient transaction commits (at once, asynchronously, outside one). */
export function afterCommit(f: () => void | Promise<void>) {
  const s = als.getStore()
  if (s) s.after.push(f)
  else
    void Promise.resolve()
      .then(f)
      .catch((e) => log.error("[yard] after-commit", e))
}
