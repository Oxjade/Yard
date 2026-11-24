import "server-only"
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm"
import { users } from "../db/schema"
import { auditLog } from "../db/schema/platform"
import type { Executor } from "../db"

import { riskFrom, SAME_IP_WINDOW_MS, type ApplicationRisk } from "./application-risk-core"

export { riskFrom, type ApplicationRisk } from "./application-risk-core"

/** Risk for each application (by id), in three queries whatever the number of rows. */
export async function applicationRisks(d: Executor, rows: { id: string; userId: string; submittedAt: Date | null }[]): Promise<Map<string, ApplicationRisk>> {
  const out = new Map<string, ApplicationRisk>()
  if (!rows.length) return out
  const userRows = await d.select({ id: users.id, email: users.email, createdAt: users.createdAt }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.userId))]))
  const byUser = new Map(userRows.map((u) => [u.id, u]))
  const since = new Date(Date.now() - SAME_IP_WINDOW_MS)
  const submissions = await d
    .select({ subjectId: auditLog.subjectId, ipHash: auditLog.ipHash, at: auditLog.at })
    .from(auditLog)
    .where(and(eq(auditLog.action, "onboarding.submitted"), isNotNull(auditLog.ipHash), gte(auditLog.at, since)))
  const perIp = new Map<string, number>()
  const ipOf = new Map<string, string>()
  for (const s of submissions) {
    perIp.set(s.ipHash!, (perIp.get(s.ipHash!) ?? 0) + 1)
    if (s.subjectId) ipOf.set(s.subjectId, s.ipHash!)
  }
  for (const r of rows) {
    const u = byUser.get(r.userId)
    const ip = ipOf.get(r.id)
    out.set(r.id, riskFrom({ email: u?.email ?? null, accountCreatedAt: u?.createdAt ?? null, submittedAt: r.submittedAt, sameIpAttempts: ip ? (perIp.get(ip) ?? 0) : 0 }))
  }
  return out
}
