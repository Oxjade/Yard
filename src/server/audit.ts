import "server-only"
import { db } from "./db"
import { auditLog } from "./db/schema"
import { newId } from "./ids"
import { log } from "./log"
import type { AuditEntryDto } from "@/lib/api/contracts/common"

/**
 * The server audit writer (§8.3), through db() so it joins the caller's transaction. Rows match
 * the existing AuditEntry shape plus subjectType and brandId. `meta` never holds tokens, message
 * bodies or coordinates.
 */
export type AuditActor = { kind: "admin" | "brand" | "shopper" | "system"; id?: string | null; name?: string | null; role?: string | null }

export type AuditInput = {
  actor: AuditActor
  action: string
  target?: string | null
  subjectType?: string | null
  subjectId?: string | null
  brandId?: string | null
  reason?: string | null
  approvedBy?: string | null
  ipHash?: string | null
  meta?: Record<string, unknown>
}

/**
 * Keys that never reach audit meta, matched exactly (case-insensitive) at every depth: tokens and
 * secrets, user-written text and coordinates. Exact names, so legitimate keys such as
 * "platform", "template" or "relatedReportId" are kept.
 */
const FORBIDDEN_META = /^(access_?token|refresh_?token|id_?token|token|secret|client_?secret|password|body|text|caption|details|lat|lng|lon|latitude|longitude|coords?|coordinates)$/i

/** Drops forbidden keys at every depth (in development it says which, so a dropped key is never silent). */
export function scrubAuditMeta(value: unknown, path = "meta", depth = 0): unknown {
  if (depth > 6) return "[truncated]"
  if (Array.isArray(value)) return value.map((v, i) => scrubAuditMeta(v, `${path}.${i}`, depth + 1))
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_META.test(k)) {
        if (process.env.NODE_ENV !== "production") log.once(`audit-meta:${path}.${k}`, "warn", `[yard] audit meta key ${path}.${k} was dropped: audit rows never hold tokens, user-written text or coordinates.`)
        continue
      }
      out[k] = scrubAuditMeta(v, `${path}.${k}`, depth + 1)
    }
    return out
  }
  return value
}

/**
 * Yard setup (founding brands): Studio writes made by Yard staff in an unclaimed brand are the
 * admin's own actions. A brand actor with role yard_setup is recorded as actor_kind 'admin' with
 * the admin's user id (it is the same user) and meta.via = 'yard_setup', so the brand's audit
 * trail never shows Yard staff as a brand member.
 */
function asYardSetup(input: AuditInput): AuditInput {
  if (input.actor.kind !== "brand" || input.actor.role !== "yard_setup") return input
  return { ...input, actor: { ...input.actor, kind: "admin", role: "yard_setup" }, meta: { ...(input.meta ?? {}), via: "yard_setup" } }
}

export async function writeAudit(raw: AuditInput): Promise<AuditEntryDto> {
  const input = asYardSetup(raw)
  const meta = scrubAuditMeta(input.meta ?? {}) as Record<string, unknown>
  const d = await db()
  const [row] = await d
    .insert(auditLog)
    .values({
      id: newId("au"),
      actorKind: input.actor.kind,
      actorId: input.actor.id ?? null,
      actorName: input.actor.name ?? null,
      role: input.actor.role ?? null,
      action: input.action,
      target: input.target ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      brandId: input.brandId ?? null,
      reason: input.reason ?? null,
      approvedBy: input.approvedBy ?? null,
      ipHash: input.ipHash ?? null,
      meta,
    })
    .returning()
  return toAuditDto(row)
}

export function toAuditDto(row: typeof auditLog.$inferSelect): AuditEntryDto {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actorKind: row.actorKind as AuditEntryDto["actorKind"],
    actorId: row.actorId,
    actor: row.actorName ?? (row.actorKind === "system" ? "Yard" : (row.actorId ?? "Unknown")),
    role: row.role,
    action: row.action,
    target: row.target,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    brandId: row.brandId,
    reason: row.reason,
    approvedBy: row.approvedBy,
    source: "server",
  }
}
