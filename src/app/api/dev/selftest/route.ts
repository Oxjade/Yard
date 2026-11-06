import { statSync } from "node:fs"
import path from "node:path"
import { desc, like, sql } from "drizzle-orm"
import { connection, type NextRequest } from "next/server"
import { db } from "@/server/db"
import { auditLog } from "@/server/db/schema"
import { seedStatus } from "@/server/dev/reseed"
import { getEnv } from "@/server/env"
import { route } from "@/server/http/route"
import { yard } from "@/server/state"
import { readFileSync } from "node:fs"

const mode = (p: string) => {
  try {
    return (statSync(p).mode & 0o777).toString(8)
  } catch {
    return null
  }
}

/**
 * GET /api/dev/selftest (dev only, admin audit.view): what db-check prints. The data directory
 * and secrets modes, the lock's pid, migrations and every seed module's version in run order;
 * plus the last admin sign-in and sign-out audit rows (the curl kit checks switches against them).
 */
const handler = route({ auth: "admin", permission: "audit.view" }, async () => {
  const env = getEnv()
  const lockFile = path.join(env.dataDir, `${env.nodeEnv}.lock`)
  let lockPid: number | null = null
  try {
    lockPid = Number(readFileSync(lockFile, "utf8").trim()) || null
  } catch {
    /* no lock */
  }
  const d = await db()
  const applied = await d.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`)
  const journal = (JSON.parse(readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: unknown[] }).entries.length
  return {
    pid: process.pid,
    nodeEnv: env.nodeEnv,
    dataDir: env.dataDir,
    dataDirMode: mode(env.dataDir),
    secretsMode: mode(path.join(env.envDir, "secrets.json")),
    lockFile,
    lockPid,
    trustedProxyHops: env.trustedProxyHops,
    migrations: { journal, applied: (applied.rows[0] as { n: number }).n },
    seeds: await seedStatus(),
    schedulers: !!yard.schedulers,
    jobImpl: yard.jobImpl ?? {},
    adminSessionAudit: (
      await d
        .select({ action: auditLog.action, actorId: auditLog.actorId, reason: auditLog.reason, subjectId: auditLog.subjectId, at: auditLog.at })
        .from(auditLog)
        .where(like(auditLog.action, "admin.signed_%"))
        .orderBy(desc(auditLog.at))
        .limit(6)
    ).map((r) => ({ ...r, at: r.at.toISOString() })),
  }
})

export async function GET(req: NextRequest, ctx: { params: Promise<Record<string, string | string[]>> }) {
  await connection()
  if (!getEnv().dev) return Response.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 })
  return handler(req, ctx)
}
