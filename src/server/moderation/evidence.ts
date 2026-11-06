import "server-only"
import type { EvidenceDto, EvidenceMessage } from "@/lib/api/contracts/admin"
import { mediaSrc } from "../media"

/**
 * Turns a report's frozen snapshot (§5.3, built by F2's reports/snapshot.ts) into what the admin
 * evidence view shows. Tolerant of field names, so a snapshot written by an older build still
 * reads; it never fetches anything the snapshot didn't freeze.
 */

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null)
const first = (o: Obj, keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]
  return undefined
}

/** Private media is read as admin (§5.4); seeded public media keeps its /media/… path. */
export function adminMediaSrc(src: string | null | undefined, mediaId?: string | null): string | null {
  if (mediaId) return mediaSrc(mediaId, "admin")
  if (!src) return null
  if (src.startsWith("/api/media/")) {
    const id = src.slice("/api/media/".length).split("?")[0]
    return mediaSrc(decodeURIComponent(id), "admin")
  }
  return src.startsWith("/media/") ? src : null
}

function attachmentsOf(m: Obj): EvidenceMessage["attachments"] {
  const raw = first(m, ["attachments", "attachmentIds", "mediaIds", "media"])
  if (!Array.isArray(raw)) return []
  const out: EvidenceMessage["attachments"] = []
  for (const a of raw) {
    const id = typeof a === "string" ? a : isObj(a) ? str(first(a, ["mediaId", "id"])) : null
    if (id && /^[\w-]{1,80}$/.test(id)) out.push({ mediaId: id, src: mediaSrc(id, "admin") })
  }
  return out
}

export function normaliseEvidence(snapshot: unknown, ctx: { reportedMessageId: string | null; customerName: string; brandName: string }): EvidenceDto {
  const snap = isObj(snapshot) ? snapshot : {}
  const list = first(snap, ["messages", "thread", "context"])
  if (Array.isArray(list)) {
    const reportedId = str(first(snap, ["reportedMessageId", "messageId", "subjectId"])) ?? ctx.reportedMessageId
    const messages: EvidenceMessage[] = list.filter(isObj).map((m, i) => {
      const id = str(first(m, ["id", "messageId"])) ?? `m${i}`
      const sideRaw = str(first(m, ["side", "senderSide"]))
      const side = sideRaw === "brand" || sideRaw === "system" ? sideRaw : "customer"
      const product = first(m, ["product", "productSnapshot"])
      const order = first(m, ["order", "orderSnapshot"])
      return {
        id,
        side,
        sender: str(first(m, ["senderName", "sender", "name"])) ?? (side === "brand" ? ctx.brandName : side === "system" ? "Yard" : ctx.customerName),
        kind: str(m.kind) ?? "text",
        body: str(first(m, ["body", "text"])),
        at: str(first(m, ["createdAt", "at", "sentAt"])),
        reported: m.reported === true || (!!reportedId && id === reportedId),
        status: str(m.status),
        attachments: attachmentsOf(m),
        product: isObj(product) ? str(first(product, ["name", "slug"])) : str(product),
        order: isObj(order) ? str(first(order, ["reference", "id"])) : str(order),
      }
    })
    return { kind: "messages", messages, note: str(snap.note) }
  }
  const rec = (isObj(snap.record) ? snap.record : isObj(snap.post) ? snap.post : isObj(snap.place) ? snap.place : isObj(snap.event) ? snap.event : snap) as Obj
  const fieldNames: [string, string[]][] = [
    ["Title", ["title", "name"]],
    ["Kind", ["kind", "type"]],
    ["Caption", ["caption"]],
    ["Description", ["description"]],
    ["Promotion", ["promoText", "promo"]],
    ["Address", ["addressLine", "address"]],
    ["Area", ["neighbourhood"]],
    ["City", ["city"]],
    ["Starts", ["startsAt"]],
    ["Ends", ["endsAt"]],
    ["Posted", ["postedAt"]],
    ["Link", ["permalink"]],
  ]
  const fields: { label: string; value: string }[] = []
  for (const [label, keys] of fieldNames) {
    const v = str(first(rec, keys))
    if (v) fields.push({ label, value: v.length > 600 ? `${v.slice(0, 600)}…` : v })
  }
  const mediaRaw = first(rec, ["media", "images"]) ?? (isObj(rec.image) ? [rec.image] : undefined)
  const media: { src: string; alt: string }[] = []
  if (Array.isArray(mediaRaw))
    for (const m of mediaRaw.filter(isObj)) {
      const src = adminMediaSrc(str(first(m, ["src", "posterSrc"])), str(m.mediaId))
      if (src) media.push({ src, alt: str(m.alt) ?? "" })
    }
  const title = str(first(rec, ["title", "name"])) ?? (str(rec.caption)?.slice(0, 60) || "Reported item")
  return { kind: "record", title, fields, media }
}
