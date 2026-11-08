import { z } from "zod"

/**
 * Shared contract pieces (§1.10). Request bodies are strict(): unknown fields are a 400, so a
 * client can't slip in an id, brandId or customerId.
 */

export const id = (prefix?: string) => (prefix ? z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,64}$`), { error: "That id isn't valid." }) : safeId())

/**
 * One shared rule for ids and free text, so a NUL (which Postgres refuses in text, surfacing as a
 * 500 with the statement in the log) or another control character is a 400 everywhere.
 *
 * - `SAFE_ID`: letters, digits, `_` and `-`, 1–80 characters. Every row, product, brand and media
 *   id in Yard has this shape.
 * - `CONTROL_CHARS`: control characters other than tab and line breaks.
 * - `safeText()` allows tabs and line breaks (messages, notes); `safeLine()` refuses them too
 *   (names, titles, single-line fields).
 */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/
export const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const LINE_BREAKS = /[\r\n\t]/
export const isSafeId = (v: unknown): v is string => typeof v === "string" && SAFE_ID.test(v)
export const hasControlChars = (s: string) => CONTROL_CHARS.test(s)
export const safeId = () => z.string().regex(SAFE_ID, { error: "That id isn't valid." })
export const safeText = (opts: { max?: number; tooLong?: string; message?: string } = {}) => {
  const base = opts.max === undefined ? z.string() : z.string().max(opts.max, { error: opts.tooLong ?? `Keep it under ${opts.max} characters.` })
  return base.refine((s) => !CONTROL_CHARS.test(s), { error: opts.message ?? "Remove the hidden characters." })
}
export const safeLine = (opts: { max?: number; tooLong?: string; message?: string } = {}) => {
  const base = opts.max === undefined ? z.string() : z.string().max(opts.max, { error: opts.tooLong ?? `Keep it under ${opts.max} characters.` })
  return base.refine((s) => !CONTROL_CHARS.test(s) && !LINE_BREAKS.test(s), { error: opts.message ?? "Remove the hidden characters." })
}

/**
 * A calendar date that exists ("2027-02-30", "2027-13-45" and "0000-00-00" are refused), in the
 * years 1900–2199. Postgres would refuse the others with a data exception, which must never be a 500.
 */
export function isRealDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const y = Number(m[1])
  if (y < 1900 || y > 2199) return false
  return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === v
}
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Use a date like 2026-11-06." })
  // Only judged once the shape is right, so a malformed value gets one message, not two.
  .refine((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v) || isRealDate(v), { error: "Use a real date, like 2026-11-06." })
export const isoDateTime = z.string().datetime({ offset: true })

export const money = z.object({ amount: z.number().int(), currency: z.string().length(3) })
export type Money = z.infer<typeof money>

export const actorKind = z.enum(["shopper", "brand", "admin"])
export type ActorKindDto = z.infer<typeof actorKind>

/** `?as=` on multi-actor endpoints (/api/reports, /api/uploads, /api/media/[id], /api/notifications). */
export const asQuery = z.object({ as: actorKind })

export const cursorQuery = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).optional() })

/** The error wire format: `{ error: { code, message, fields? } }`. */
export const errorCode = z.enum([
  "validation",
  "unauthenticated",
  "forbidden",
  "csrf",
  "blocked",
  "restricted",
  "suspended",
  "not_found",
  "conflict",
  "length_required",
  "too_large",
  "unsupported_type",
  "rule",
  "rate_limited",
  "not_configured",
  "busy",
  "internal",
])
export type ErrorCodeDto = z.infer<typeof errorCode>
export const errorBody = z.object({ error: z.object({ code: errorCode, message: z.string(), fields: z.record(z.string(), z.string()).optional() }) })

export const ok = z.object({ ok: z.literal(true) })

/** A page of items with an opaque cursor. */
export const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() })

/** The audit entry a decision returns (§8.2), matching the existing AuditEntry shape plus subject and brand. */
export const auditEntryDto = z.object({
  id: z.string(),
  at: z.string(),
  actorKind: z.enum(["admin", "brand", "shopper", "system"]),
  actorId: z.string().nullable(),
  actor: z.string(),
  role: z.string().nullable(),
  action: z.string(),
  target: z.string().nullable(),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  brandId: z.string().nullable(),
  reason: z.string().nullable(),
  approvedBy: z.string().nullable(),
  source: z.literal("server"),
})
export type AuditEntryDto = z.infer<typeof auditEntryDto>

/** Media as the server sends it: `src` is always /api/media/<id>[?as=…] or a seed /media/… path. */
export const mediaRef = z.object({ mediaId: z.string().optional(), src: z.string(), alt: z.string(), width: z.number(), height: z.number() })
export type MediaRef = z.infer<typeof mediaRef>
