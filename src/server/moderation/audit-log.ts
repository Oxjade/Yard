import "server-only"
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { toAuditDto } from "../audit"
import { db } from "../db"
import { auditLog } from "../db/schema"
import { badRequest } from "../http/errors"
import type { AuditListResult } from "@/lib/api/contracts/admin"
import { audit, type DecisionCtx } from "./shared"

/**
 * GET /api/admin/audit (§8.3). Brand-side writes (actor_kind brand) are left out of the main feed
 * unless asked for, or unless the query names a subject (a record's history shows everything).
 * The cursor is "<iso time>|<id>", newest first.
 */
export async function listAudit(q: { subjectType?: string; subjectId?: string; actorKind?: "admin" | "brand" | "shopper" | "system" | "all"; cursor?: string; limit?: number }): Promise<AuditListResult> {
  const d = await db()
  const limit = q.limit ?? 100
  const subjects = q.subjectId ? q.subjectId.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8) : []
  let cursor: { at: Date; id: string } | null = null
  if (q.cursor) {
    const [at, id] = q.cursor.split("|")
    const t = new Date(at)
    if (!id || Number.isNaN(t.getTime())) throw badRequest({ cursor: "This cursor isn't valid." })
    cursor = { at: t, id }
  }
  const kinds = q.actorKind && q.actorKind !== "all" ? [q.actorKind] : subjects.length || q.actorKind === "all" ? null : ["admin", "system"]
  const rows = await d
    .select()
    .from(auditLog)
    .where(
      and(
        q.subjectType ? eq(auditLog.subjectType, q.subjectType) : undefined,
        subjects.length ? inArray(auditLog.subjectId, subjects) : undefined,
        kinds ? inArray(auditLog.actorKind, kinds) : undefined,
        cursor ? or(lt(auditLog.at, cursor.at), and(eq(auditLog.at, cursor.at), lt(auditLog.id, cursor.id))) : undefined,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map(toAuditDto), nextCursor: rows.length > limit && last ? `${last.at.toISOString()}|${last.id}` : null }
}

export async function auditCount() {
  const d = await db()
  return Number((await d.select({ n: sql<number>`count(*)::int` }).from(auditLog))[0]?.n ?? 0)
}

/** export-audit: the CSV is built in the browser from what the admin can already read; the export itself is logged. */
export async function exportAudit(ctx: DecisionCtx, body: { id: string; scope: string; count: number; reason?: string }) {
  const entry = await audit(ctx, {
    action: "audit.exported",
    target: `${body.count} ${body.count === 1 ? "entry" : "entries"}, ${body.scope}`,
    subjectType: "audit_log",
    subjectId: "audit_log",
    reason: body.reason ?? null,
    meta: { count: body.count, scope: body.scope },
  })
  return { item: { count: body.count, scope: body.scope }, audit: entry }
}
