import "server-only"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { and, eq, gt, sql } from "drizzle-orm"
import { writeAudit } from "../audit"
import { getAdmin, getBrandActor, getShopper, type Actor } from "../auth/dal"
import { db } from "../db"
import { auditLog, messageAttachments, messages, reports } from "../db/schema"
import { notFound } from "../http/errors"
import { log } from "../log"
import { canAdmin, type AdminPermission } from "@/lib/permissions"
import { resolveStored, type MediaRow } from "./store"

/**
 * GET /api/media/[id]?as=shopper|brand|admin (§5.4 step 9). Only the `as` cookie is read.
 *  - removed → 404 for everyone except the admins below;
 *  - public → anyone, no cookie needed;
 *  - private, as=shopper → the uploader, or the customer of the conversation the file is bound to;
 *  - private, as=brand → a member acting in the owning brand, or the brand side of the bound conversation;
 *  - private, as=admin → inbox attachments need messages.view_reports AND the file in a report
 *    snapshot or on a held message; social media needs content.moderate, place media
 *    places.moderate. Admin reads need Sec-Fetch-Site: same-origin (otherwise 404 and no audit)
 *    and write media.viewed, at most once per admin and file per hour.
 *  - anything else → 404, so existence never leaks.
 * Streams with Range (206) for video. Public: `public, max-age=300, must-revalidate` + ETag +
 * 304; private: `private, max-age=300`. Never immutable, so a removal lands within 5 minutes.
 */
type As = "shopper" | "brand" | "admin"

async function load(id: string) {
  if (!/^med_[\w-]{1,64}$/.test(id)) return null
  const d = await db()
  return (await d.query.mediaAssets.findFirst({ where: (m, { eq }) => eq(m.id, id) })) ?? null
}

async function conversationOf(m: MediaRow) {
  if (!m.conversationId) return null
  const d = await db()
  return (await d.query.conversations.findFirst({ where: (c, { eq }) => eq(c.id, m.conversationId!) })) ?? null
}

/** The admin permission a purpose's private media needs. */
const adminPermissionFor = (purpose: string): AdminPermission | null =>
  purpose === "inbox_attachment" ? "messages.view_reports" : purpose === "social_post" || purpose === "social_import" || purpose === "drop_image" ? "content.moderate" : purpose === "location_image" ? "places.moderate" : purpose === "onboarding_image" ? "brands.restrict" : purpose === "storefront_cover" ? "brands.founding" : null

/** An inbox attachment an admin may open: frozen into a report snapshot, or on a held message. */
async function inboxEvidence(mediaId: string) {
  const d = await db()
  const [inReport] = await d
    .select({ id: reports.id })
    .from(reports)
    .where(sql`jsonb_exists(coalesce(${reports.snapshot} -> 'mediaIds', '[]'::jsonb), ${mediaId})`)
    .limit(1)
  if (inReport) return true
  const [held] = await d
    .select({ id: messages.id })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .where(and(eq(messageAttachments.mediaId, mediaId), eq(messages.status, "held")))
    .limit(1)
  return !!held
}

/**
 * An inbox attachment the other side of the conversation may open: it is on a message that was
 * delivered (status `sent`). Before its message is sent, while it's held for review, or once Yard
 * removed it, only the uploader's side has it (and admins with evidence, below).
 */
async function onSentMessage(mediaId: string) {
  const d = await db()
  const [row] = await d
    .select({ id: messages.id })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .where(and(eq(messageAttachments.mediaId, mediaId), eq(messages.status, "sent")))
    .limit(1)
  return !!row
}

/** Decides access for a private (or removed) file. Returns the actor that may read it, or null. */
async function authorise(m: MediaRow, as: As | null, req: Request): Promise<Actor | null> {
  if (!as) return null
  if (as === "shopper") {
    if (m.moderationStatus === "removed") return null
    const s = await getShopper()
    if (!s) return null
    if (m.createdBy === s.userId && m.ownerKind === "user") return s
    const c = await conversationOf(m)
    if (!c || c.customerId !== s.userId) return null
    // The brand's attachment reaches the shopper only once its message was delivered.
    return m.purpose !== "inbox_attachment" || (await onSentMessage(m.id)) ? s : null
  }
  if (as === "brand") {
    if (m.moderationStatus === "removed") return null
    const b = await getBrandActor()
    if (!b) return null
    if (m.brandId && m.brandId === b.brandId) return b
    const c = await conversationOf(m)
    if (!c || c.brandId !== b.brandId) return null
    // The shopper's attachment reaches the brand only once its message was delivered.
    return m.purpose !== "inbox_attachment" || (await onSentMessage(m.id)) ? b : null
  }
  // Admin: same-origin requests only, so a cross-site <img> can neither read nor write an audit row.
  if (req.headers.get("sec-fetch-site") !== "same-origin") return null
  const a = await getAdmin()
  const permission = adminPermissionFor(m.purpose)
  if (!a || !permission || !canAdmin(a.role, permission)) return null
  if (m.purpose === "inbox_attachment" && !(await inboxEvidence(m.id))) return null
  await auditView(a, m)
  return a
}

async function auditView(a: Extract<Actor, { kind: "admin" }>, m: MediaRow) {
  try {
    const d = await db()
    const hourAgo = new Date(Date.now() - 3600_000)
    const [recent] = await d
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, "media.viewed"), eq(auditLog.actorId, a.userId), eq(auditLog.subjectId, m.id), gt(auditLog.at, hourAgo)))
      .limit(1)
    if (recent) return
    await writeAudit({
      actor: { kind: "admin", id: a.userId, name: a.name, role: a.role },
      action: "media.viewed",
      target: `${m.purpose.replace("_", " ")} ${m.id}`,
      subjectType: "media",
      subjectId: m.id,
      brandId: m.brandId,
      meta: { purpose: m.purpose, conversationId: m.conversationId, moderationStatus: m.moderationStatus },
    })
  } catch (e) {
    log.error("[yard] media.viewed audit", e)
  }
}

/** One `bytes=` range; null = serve it all (none given, or several). `false` = unsatisfiable. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null | false {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === "" && b === "") return false
  let start: number
  let end: number
  if (a === "") {
    const n = Number(b)
    if (n === 0) return false
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === "" ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (start >= size || start > end) return false
  return { start, end }
}

const etagMatches = (header: string | null, etag: string) =>
  !!header &&
  header
    .split(",")
    .map((s) => s.trim().replace(/^W\//, ""))
    .some((t) => t === etag || t === "*")

export async function serveMedia(req: Request, id: string, as: As | null): Promise<Response> {
  const m = await load(id)
  if (!m) throw notFound()
  const isPublic = m.visibility === "public" && m.moderationStatus !== "removed"
  if (!isPublic) {
    const who = await authorise(m, as, req)
    if (!who) throw notFound()
  }
  const file = resolveStored(m.storagePath)
  if (!file) throw notFound()
  let size: number
  try {
    size = (await stat(file)).size
  } catch {
    log.once(`media-missing:${m.id}`, "warn", `[yard] media ${m.id} has a row but no file (${m.storagePath})`)
    throw notFound()
  }

  const etag = `"${m.sha256}"`
  const headers = new Headers({
    "Content-Type": m.mime,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `inline; filename="${m.id}.${m.ext}"`,
    "Accept-Ranges": "bytes",
    "Cache-Control": isPublic ? "public, max-age=300, must-revalidate" : "private, max-age=300",
    "Referrer-Policy": "no-referrer",
  })
  if (isPublic) {
    headers.set("ETag", etag)
    if (etagMatches(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers })
  }

  const range = parseRange(req.headers.get("range"), size)
  if (range === false) {
    headers.set("Content-Range", `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }
  const { start, end } = range ?? { start: 0, end: size - 1 }
  headers.set("Content-Length", String(end - start + 1))
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`)
  if (req.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers })
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status: range ? 206 : 200, headers })
}
