import "server-only"
import { log } from "./log"
import { yard } from "./state"

/**
 * Graceful shutdown (SIGTERM from `systemctl restart`/stop or a deploy; SIGINT from Ctrl-C).
 *
 * Next's server already does the first half when it gets the signal: it stops accepting
 * connections, waits for the open ones to finish, then calls process.exit(). What it can't do is
 * close our database, and ending the pool as soon as the signal arrives (what PGlite used to do)
 * fails every request still running — an order half-way through its transaction among them. So:
 *
 *  1. On the signal the process is "draining": /api/health answers 503 draining, API responses
 *     carry `Connection: close` so kept-alive sockets let go, schedulers start no new job, live
 *     streams are ended (realtime/streams.ts).
 *  2. Next's process.exit() is held until every API request and scheduled job this process is
 *     running has finished, then the database is closed (pool.end() / PGlite close()), then the
 *     process exits with Next's code.
 *  3. If Next hasn't exited after YARD_SHUTDOWN_GRACE_MS (default 25 s; keep systemd's
 *     TimeoutStopSec above it), the same close-and-exit runs anyway, so a stuck socket can never
 *     keep the old process alive past the stop timeout and get it SIGKILLed mid-write.
 *
 * Installed once per server process from instrumentation.ts; scripts never install it.
 */
type Shutdown = { installed: boolean; draining: boolean; inFlight: number; jobs: number; idle: Set<() => void> }

function state(): Shutdown {
  const slots = (yard.slots ??= {})
  return (slots.shutdown ??= { installed: false, draining: false, inFlight: 0, jobs: 0, idle: new Set() }) as Shutdown
}

export const isDraining = () => state().draining
export const shutdownInstalled = () => state().installed

function settle(s: Shutdown) {
  if (s.inFlight + s.jobs > 0) return
  for (const fn of s.idle) fn()
  s.idle.clear()
}

/** Counts one API request until the returned function is called. */
export function trackRequest(): () => void {
  const s = state()
  s.inFlight++
  let done = false
  return () => {
    if (done) return
    done = true
    s.inFlight--
    settle(s)
  }
}

/** Runs a scheduled job unless the process is draining; shutdown waits for a running one. */
export async function runJob(run: () => Promise<unknown>): Promise<boolean> {
  const s = state()
  if (s.draining) return false
  s.jobs++
  try {
    await run()
  } finally {
    s.jobs--
    settle(s)
  }
  return true
}

function waitIdle(s: Shutdown, ms: number): Promise<boolean> {
  if (s.inFlight + s.jobs === 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.idle.delete(onIdle)
      resolve(false)
    }, Math.max(0, ms))
    const onIdle = () => {
      clearTimeout(timer)
      resolve(true)
    }
    s.idle.add(onIdle)
  })
}

function graceMs() {
  const n = Number(process.env.YARD_SHUTDOWN_GRACE_MS?.trim() || "25000")
  return Number.isInteger(n) && n >= 1000 && n <= 600_000 ? n : 25_000
}

export function installShutdown() {
  const s = state()
  if (s.installed) return
  s.installed = true
  const realExit = process.exit.bind(process) as (code?: number) => never
  let finishing: Promise<void> | null = null

  const finish = (code: number, deadline: number) =>
    (finishing ??= (async () => {
      const idle = await waitIdle(s, deadline - Date.now())
      if (!idle) log.warn(`[yard] shutdown: grace period over with ${s.inFlight} API ${s.inFlight === 1 ? "request" : "requests"} and ${s.jobs} ${s.jobs === 1 ? "job" : "jobs"} still running`)
      const close = (yard as { closeDb?: () => Promise<void> }).closeDb
      if (close) {
        await Promise.race([close().catch((e: unknown) => log.error("[yard] shutdown: closing the database", e)), new Promise((r) => setTimeout(r, 5000))])
      }
      log.info(`[yard] shutdown complete (exit ${code})`)
      realExit(code)
    })())

  const onSignal = (sig: NodeJS.Signals) => {
    if (s.draining) return
    s.draining = true
    const grace = graceMs()
    const deadline = Date.now() + grace
    log.info(`[yard] ${sig}: draining (${s.inFlight} API ${s.inFlight === 1 ? "request" : "requests"} in flight, ${s.jobs} ${s.jobs === 1 ? "job" : "jobs"}; up to ${Math.round(grace / 1000)} s)`)
    // Next calls process.exit() once its connections have drained: hold it until ours have too.
    process.exit = ((code?: number | string | null) => {
      void finish(typeof code === "number" ? code : Number(code ?? process.exitCode ?? 0) || 0, deadline)
      return undefined as never
    }) as typeof process.exit
    const code = sig === "SIGINT" ? 130 : 143
    // Without Next's own handler (NEXT_MANUAL_SIG_HANDLE) nobody else will exit: do it when idle.
    if (process.env.NEXT_MANUAL_SIG_HANDLE) void waitIdle(s, grace).then(() => finish(code, deadline))
    setTimeout(() => void finish(code, Date.now()), grace)
  }
  process.on("SIGTERM", onSignal)
  process.on("SIGINT", onSignal)
}
