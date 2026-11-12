/**
 * Warms the embedded server before the first request (§1.3): env, the production demo-auth
 * warning, then the database (boot, migrations, seeds, schedulers). Installs the SIGTERM/SIGINT
 * drain first (src/server/shutdown.ts). Next skips register() during
 * `next build`, and the Edge runtime never loads the database.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Graceful shutdown first, so the database boot below knows the server closes it (shutdown.ts).
    const { installShutdown } = await import("@/server/shutdown")
    installShutdown()
    const { warmUp } = await import("@/server/db")
    try {
      await warmUp()
    } catch (e) {
      // Logged loudly; the first request retries the boot (getDb() drops a failed promise).
      if (e instanceof Error && /Another Yard server/.test(e.message)) {
        // Two processes on one PGlite directory would corrupt it: refuse to start.
        console.error(`[yard] ${e.message}`)
        process.exit(1)
      }
      console.error("[yard] warm-up failed", e)
    }
  }
}
