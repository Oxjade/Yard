import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { log } from "../log"
import { getDb, type Root } from "./client"

/**
 * PGlite has ONE connection and drizzle's transaction holds it exclusively (§1.3). A query sent
 * on the root handle from inside a transaction callback waits forever and wedges the process, so
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

/** withTx on an explicit root: the seed runner uses it while the boot promise is still pending. */
export async function runTx<T>(root: Root, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const after: Scope["after"] = []
  const hook = beforeCommitAls.getStore()
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
