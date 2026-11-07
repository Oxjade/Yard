import "server-only"
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { toAuditDto } from "../audit"
import { db } from "../db"
import { auditLog } from "../db/schema"
import { badRequest } from "../http/errors"
import type { AuditListResult } from "@/lib/api/contracts/admin"
import { adminRoleLabels, type AdminRole } from "@/lib/permissions"
import { AUDIT_CSV_HEADER, actionLabel, auditCsvLine, csvCell } from "@/components/admin/platform/security/audit-words"
import { audit, type DecisionCtx } from "./shared"

/**
 * GET /api/admin/audit (§8.3). Brand-side writes (actor_kind brand) are left out of the main feed
 * unless asked for, or unless the query names a subject (a record's history shows everything).
 * The cursor is "<iso time>|<id>", newest first.
 */
export async function listAudit(q: { subjectType?: string; subjectId?: string; actorKind?: "admin" | "brand" | "shopper" | "system" | "all"; cursor?: string; limit?: number }): Promise<AuditListResult> {
  const d = await db()
  const limit = q.limit ?? 100
  const subjects = q.subjectId ? q.subjectId.split(",").map((s) => s.trim()).filter((s) => s && s.length <= 80).slice(0, 24) : []
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

const EXPORT_MAX = 10_000

function roleNameOf(role: string | null, kind: string) {
  const name = role ? (adminRoleLabels[role as AdminRole] ?? role.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())) : kind === "system" ? "Yard" : ""
  return kind === "brand" ? `${name || "Member"}, brand team` : kind === "shopper" ? "Shopper" : name
}

/**
 * export-audit: the server builds the CSV from its own rows, counts them itself and logs the export
 * (audit.exported) in the same transaction, so the log records exactly what left. Filters: exact
 * ids (the rows an admin selected), or who (admins and Yard, or everyone), an actor name and an
 * action key. This browser's legacy rows aren't the server's, so the client appends them itself.
 */
export async function exportAudit(ctx: DecisionCtx, body: { id: string; ids?: string[]; actorKind?: "admins" | "all"; actor?: string; action?: string; reason?: string }) {
  const d = await db()
  const ids = body.ids ? [...new Set(body.ids)] : null
  const kinds = ids ? null : body.actorKind === "all" ? null : ["admin", "system"]
  const rows = ids && !ids.length
    ? []
    : await d
        .select()
        .from(auditLog)
        .where(
          and(
            ids ? inArray(auditLog.id, ids) : undefined,
            kinds ? inArray(auditLog.actorKind, kinds) : undefined,
            body.actor ? eq(auditLog.actorName, body.actor) : undefined,
            body.action ? eq(auditLog.action, body.action) : undefined,
          ),
        )
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(EXPORT_MAX + 1)
  const page = rows.slice(0, EXPORT_MAX)
  const capped = rows.length > EXPORT_MAX
  const csv = [
    AUDIT_CSV_HEADER.map(csvCell).join(","),
    ...page.map((r) => {
      const e = toAuditDto(r)
      return auditCsvLine({ at: e.at, source: "server", actor: e.actor, roleName: roleNameOf(e.role, e.actorKind), action: e.action, target: e.target ?? "", reason: e.reason, approvedBy: e.approvedBy })
    }),
  ].join("\n")
  // The scope is described here from the filters, not taken from the client.
  const scope = ids
    ? `${ids.length} selected`
    : [body.actorKind === "all" ? "including brand teams" : "admins and Yard", body.actor ? body.actor : null, body.action ? actionLabel(body.action).toLowerCase() : null, capped ? `newest ${EXPORT_MAX.toLocaleString("en-GB")}` : null].filter(Boolean).join(", ")
  const count = page.length
  const entry = await audit(ctx, {
    action: "audit.exported",
    target: `${count} server ${count === 1 ? "entry" : "entries"}, ${scope}`,
    subjectType: "audit_log",
    subjectId: "audit_log",
    reason: body.reason ?? null,
    meta: { count, scope, capped },
  })
  return { item: { csv, count, scope, capped }, audit: entry }
}
