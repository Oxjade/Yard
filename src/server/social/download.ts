import "server-only"
import { randomUUID } from "node:crypto"
import { copyFile, mkdir, open, readFile, rm, stat } from "node:fs/promises"
import path from "node:path"
import { getEnv } from "../env"
import { imageSize, mp4Info, sniff } from "../media/sniff"
import { storeUpload } from "../media/store"
import { MalformedMedia, stripMetadataBytes } from "../media/strip-metadata"

/**
 * The hardened downloader for provider media (§6.1 Sync, SEC-33). It fetches only URLs a
 * provider returned, and only when: the scheme is https; the host ends with an allowlisted CDN;
 * redirects are followed by hand (at most 3), re-checking scheme and host at every hop; the body
 * streams into the tmp folder and is cut off once it passes the cap, counting bytes as they
 * arrive (Content-Length is never trusted); and the whole download finishes within 15 s.
 * Files then go through the same sniffing and stripping as uploads, with purpose social_import.
 * The sandbox reads /public/media and never fetches. No database transaction is open here.
 */
export const ALLOWED_HOSTS = ["cdninstagram.com", "fbcdn.net", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com"]
export const IMAGE_CAP = 10 * 1024 * 1024
export const VIDEO_CAP = 50 * 1024 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 15_000

export class DownloadError extends Error {
  constructor(public reason: "scheme" | "host" | "redirects" | "status" | "too_large" | "timeout" | "type" | "io") {
    super(`download refused: ${reason}`)
    this.name = "DownloadError"
  }
}

export function hostAllowed(hostname: string) {
  const h = hostname.toLowerCase().replace(/\.$/, "")
  return ALLOWED_HOSTS.some((a) => h === a || h.endsWith(`.${a}`))
}

/** Throws unless `url` is https on an allowlisted host with the default port and no credentials. */
export function assertFetchable(url: URL) {
  if (url.protocol !== "https:") throw new DownloadError("scheme")
  if (url.username || url.password || (url.port && url.port !== "443") || !hostAllowed(url.hostname)) throw new DownloadError("host")
}

const tmpDir = () => path.join(getEnv().envDir, "uploads", "tmp")

async function tmpFile() {
  const dir = tmpDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return path.join(dir, `${randomUUID()}.part`)
}

/** Streams `url` into a new tmp file under the cap. Returns the path; the caller owns the file. */
export async function downloadToTmp(rawUrl: string, cap: number): Promise<{ path: string; bytes: number }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new DownloadError("scheme")
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertFetchable(url)
    let res: Response
    try {
      res = await fetch(url, { redirect: "manual", signal, cache: "no-store", headers: { Accept: "image/*,video/*" } })
    } catch {
      throw new DownloadError(signal.aborted ? "timeout" : "io")
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location")
      await res.body?.cancel().catch(() => {})
      if (!location) throw new DownloadError("redirects")
      url = new URL(location, url)
      continue
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {})
      throw new DownloadError("status")
    }
    const file = await tmpFile()
    const fh = await open(file, "wx", 0o600)
    let bytes = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > cap) {
          await reader.cancel().catch(() => {})
          throw new DownloadError("too_large")
        }
        await fh.write(value)
      }
      await fh.close()
      return { path: file, bytes }
    } catch (e) {
      await fh.close().catch(() => {})
      await rm(file, { force: true })
      if (e instanceof DownloadError) throw e
      throw new DownloadError(signal.aborted ? "timeout" : "io")
    }
  }
  throw new DownloadError("redirects")
}

/** The sandbox's "download": copies a /public/media file into tmp (no network). */
export async function copyPublicToTmp(publicPath: string): Promise<{ path: string; bytes: number }> {
  if (!/^\/media\/[\w./-]+$/.test(publicPath) || publicPath.includes("..")) throw new DownloadError("scheme")
  const file = await tmpFile()
  try {
    await copyFile(path.join(process.cwd(), "public", publicPath), file)
  } catch {
    await rm(file, { force: true })
    throw new DownloadError("io")
  }
  return { path: file, bytes: (await stat(file)).size }
}

export type ImportedMedia = { mediaId: string; kind: "image" | "video"; width?: number; height?: number; durationMs?: number }

/**
 * Downloads (or, for the sandbox, copies) one provider file and stores it as a private
 * social_import media row of the brand, through the same checks as uploads: sniff the bytes (the
 * kind must match what the provider said), strip image metadata, read the dimensions, then F2's
 * store (file first, then one short transaction). Images are capped at 10 MB, videos at 50 MB.
 */
export async function importMedia(i: { url: string; kind: "image" | "video"; sandbox: boolean; brandId: string; createdBy: string; source: "instagram" | "tiktok" | "sandbox" }): Promise<ImportedMedia> {
  const cap = i.kind === "video" ? VIDEO_CAP : IMAGE_CAP
  const got = i.sandbox ? await copyPublicToTmp(i.url) : await downloadToTmp(i.url, cap)
  try {
    if (got.bytes > cap) throw new DownloadError("too_large")
    const raw = await readFile(got.path)
    const sniffed = sniff(raw.subarray(0, 64))
    if (!sniffed || sniffed.kind !== i.kind) throw new DownloadError("type")
    let bytes: Buffer = raw
    let width: number | null = null
    let height: number | null = null
    let durationMs: number | null = null
    if (sniffed.kind === "image") {
      try {
        bytes = stripMetadataBytes(raw, sniffed.mime)
      } catch (e) {
        if (e instanceof MalformedMedia) throw new DownloadError("type")
        throw e
      }
      const size = imageSize(bytes, sniffed.mime)
      if (!size || size.width > 8000 || size.height > 8000 || size.width < 64 || size.height < 64) throw new DownloadError("type")
      width = size.width
      height = size.height
    } else if (sniffed.mime === "video/mp4") {
      const info = mp4Info(raw)
      width = info.width
      height = info.height
      durationMs = info.durationMs
    }
    const row = await storeUpload({ bytes, sniffed, purpose: "social_import", ownerKind: "brand", ownerId: i.brandId, brandId: i.brandId, conversationId: null, targetBrandId: null, createdBy: i.createdBy, width, height, durationMs, source: i.source })
    return { mediaId: row.id, kind: i.kind, width: width ?? undefined, height: height ?? undefined, durationMs: durationMs ?? undefined }
  } finally {
    await rm(got.path, { force: true }).catch(() => {})
  }
}
