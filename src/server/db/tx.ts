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

/** withTx on an explicit root: the seed runner uses it while the boot promise is still pending. */
export async function runTx<T>(root: Root, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const after: Scope["after"] = []
  const out = await root.transaction((tx) => als.run({ tx, after }, () => fn(tx)))
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
