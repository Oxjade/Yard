import "server-only"
import type { Actor } from "../auth/dal"
import { badRequest, HttpError, rateLimited, rule } from "../http/errors"
import { log } from "../log"
import type { MediaDto, UploadPurpose } from "@/lib/api/contracts/uploads"
import { authorizeAdminUpload, authorizeBrandUpload, authorizeShopperUpload } from "./authorize"
import { toMediaDto } from "./dto"
import { imageSize, mp4Info, sniff } from "./sniff"
import { brandBytesToday, BRAND_DAILY_KIB, headerCap, kindCap, storeUpload } from "./store"
import { MalformedMedia, stripMetadataBytes } from "./strip-metadata"

/** Room for the multipart envelope (boundaries, part headers, the file name) around the file itself. */
const ENVELOPE = 16 * 1024
const MB = (n: number) => `${Math.round(n / (1 << 20))} MB`

export const lengthRequired = () => new HttpError(411, "length_required", "Yard needs the file's size before it uploads. Try again from the upload button.")
const tooLarge = (cap: number) => new HttpError(413, "too_large", `This file is too large. The limit here is ${MB(cap)}.`)
const unsupported = (video: boolean) =>
  new HttpError(415, "unsupported_type", video ? "Yard couldn't read this as a JPEG, PNG or WebP photo, or an MP4 or WebM video. Export it again and add it." : "Yard couldn't read this as a JPEG, PNG or WebP photo. Export it again and add it.")

/** The whole upload pipeline (§5.4 steps 1–6) after route() has checked CSRF, the actor and the rate limit. */
export async function handleUpload(actor: Actor, query: { purpose: UploadPurpose; conversationId?: string; brandId?: string }, req: Request): Promise<{ media: MediaDto }> {
  // 1. Authorise from the URL alone.
  const target = actor.kind === "shopper" ? await authorizeShopperUpload(actor, query) : actor.kind === "brand" ? await authorizeBrandUpload(actor, query) : await authorizeAdminUpload(actor, query)
  const videoOk = target.purpose === "social_post"

  // 2. Size before the body: no Content-Length → 411; over the purpose's cap → 413.
  const declared = req.headers.get("content-length")
  if (declared === null || !/^\d+$/.test(declared.trim())) throw lengthRequired()
  const cap = headerCap(target.purpose)
  if (Number(declared) > cap + ENVELOPE) throw tooLarge(cap)
  if (target.brandId && (await brandBytesToday(target.brandId)) * 1024 + Number(declared) > BRAND_DAILY_KIB * 1024) {
    throw rateLimited(secondsToUtcMidnight(), "Your brand has uploaded 2 GB today, Yard's daily limit. Try again tomorrow.")
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    throw badRequest({ file: "Send the file as multipart form data." }, "The upload didn't arrive in one piece. Try again.")
  }
  const files = form.getAll("file")
  const extra = [...form.keys()].filter((k) => k !== "file")
  if (files.length !== 1 || extra.length) throw badRequest({ file: "Send one file, in the field named file." })
  const file = files[0]
  if (typeof file === "string") throw badRequest({ file: "Send a file, not text." })
  if (file.size === 0) throw badRequest({ file: "This file is empty." })
  if (file.size > cap) throw tooLarge(cap)

  // 3. Sniff the bytes; the client's name and type are ignored.
  const raw = Buffer.from(await file.arrayBuffer())
  const sniffed = sniff(raw.subarray(0, 64))
  if (!sniffed) throw unsupported(videoOk)
  if (sniffed.kind === "video" && !videoOk) throw unsupported(false)
  const kcap = kindCap(target.purpose, sniffed.kind)
  if (raw.length > kcap) throw tooLarge(kcap)

  // 4–5. Dimensions, then metadata stripping (images only; video is stored as it is).
  let bytes: Buffer = raw
  let width: number | null = null
  let height: number | null = null
  let durationMs: number | null = null
  if (sniffed.kind === "image") {
    try {
      bytes = stripMetadataBytes(raw, sniffed.mime)
    } catch (e) {
      if (e instanceof MalformedMedia) throw unsupported(videoOk)
      throw e
    }
    const size = imageSize(bytes, sniffed.mime)
    if (!size) throw unsupported(videoOk)
    if (size.width > 8000 || size.height > 8000) throw rule("This photo is larger than 8000 px on a side. Resize it and add it again.")
    if (size.width < 64 || size.height < 64) throw rule("This photo is smaller than 64 px on a side. Use a larger one.")
    width = size.width
    height = size.height
  } else if (sniffed.mime === "video/mp4") {
    const info = mp4Info(raw)
    width = info.width
    height = info.height
    durationMs = info.durationMs
  }

  // 6. Store: the file first, then one short transaction for the row.
  const row = await storeUpload({ ...target, bytes, sniffed, createdBy: actor.userId, width, height, durationMs })
  log.info(`[yard] upload ${row.id} ${target.purpose} ${row.mime} ${row.bytes} B by ${actor.kind}:${actor.userId}`)
  return { media: toMediaDto(row, actor.kind) }
}

function secondsToUtcMidnight() {
  const now = new Date()
  return Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000))
}
