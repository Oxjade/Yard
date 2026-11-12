import { readFileSync } from "node:fs"
import path from "node:path"
import { connection } from "next/server"
import { dbHealthCached } from "@/server/db"
import { getEnv } from "@/server/env"
import { paymentsMode } from "@/server/payments/config"
import { isDraining } from "@/server/shutdown"

/**
 * GET /api/health (public, no session, never cached): what a deploy checks before it switches
 * traffic over, and what it polls after (deploy/release.sh). 200 when the database answers and its
 * schema matches this build; 503 otherwise, with the same shape and status "degraded" (or
 * "draining" while the process shuts down). Says which
 * release is running (release.json, written by the release packager; "dev" without one), the
 * environment, the payments mode and the uptime; never a secret, a path or a count of anything.
 */
type Release = { version: string; builtAt: string | null }
let release: Release | undefined
function readRelease(): Release {
  if (release) return release
  try {
    const r = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "release.json"), "utf8")) as { sha?: unknown; version?: unknown; builtAt?: unknown }
    const v = typeof r.sha === "string" ? r.sha : typeof r.version === "string" ? r.version : "unknown"
    release = { version: v.slice(0, 64), builtAt: typeof r.builtAt === "string" ? r.builtAt.slice(0, 40) : null }
  } catch {
    release = { version: "dev", builtAt: null }
  }
  return release
}

export async function GET() {
  await connection()
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  let env: ReturnType<typeof getEnv>
  try {
    env = getEnv()
  } catch {
    // Invalid configuration: the server log lists every problem; here only that it is one.
    return Response.json({ status: "degraded", config: "invalid", ...readRelease() }, { status: 503, headers })
  }
  // Shutting down (SIGTERM): finishing in-flight requests, about to close the database. A 503 tells
  // a load balancer or monitor to stop sending work here; the replacement process answers next.
  if (isDraining()) return Response.json({ status: "draining", ...readRelease(), env: env.envName, uptimeSec: Math.round(process.uptime()) }, { status: 503, headers })
  const h = await dbHealthCached()
  const ok = h.db === "ok"
  return Response.json(
    {
      status: ok ? "ok" : "degraded",
      ...readRelease(),
      env: env.envName,
      db: h.db,
      database: h.kind,
      migrations: h.migrations,
      payments: paymentsMode(),
      uptimeSec: Math.round(process.uptime()),
    },
    { status: ok ? 200 : 503, headers },
  )
}
