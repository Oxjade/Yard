import "server-only"

/**
 * Content sniffing (§5.4 steps 3–4). The client's filename and MIME type are ignored: only the
 * bytes decide. Anything that isn't JPEG, PNG, WebP, MP4 or WebM is refused with 415, including
 * SVG, GIF, HEIC and HTML. Image dimensions come from the headers (JPEG SOFn, PNG IHDR, WebP
 * VP8/VP8L/VP8X); MP4 dimensions and duration come from the first video track's tkhd and mvhd.
 */
export type Sniffed = { mime: "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/webm"; ext: string; kind: "image" | "video"; width?: number; height?: number }

const MP4_BRANDS = new Set(["isom", "iso2", "mp41", "mp42", "avc1", "M4V "])

const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len))

/** Sniffs the first 32 bytes; null = 415. WebM additionally needs its EBML DocType to read "webm" when more bytes are given. */
export function sniff(head: Uint8Array): Sniffed | null {
  if (head.length < 12) return null
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", kind: "image" }
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => head[i] === v)) return { mime: "image/png", ext: "png", kind: "image" }
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP") return { mime: "image/webp", ext: "webp", kind: "image" }
  if (ascii(head, 4, 4) === "ftyp" && MP4_BRANDS.has(ascii(head, 8, 4))) return { mime: "video/mp4", ext: "mp4", kind: "video" }
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    // EBML: Matroska shares the magic; the DocType says "webm". Within the first 64 bytes when we have them.
    if (head.length > 32 && !ascii(head, 0, Math.min(head.length, 64)).includes("webm")) return null
    return { mime: "video/webm", ext: "webm", kind: "video" }
  }
  return null
}

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const be32 = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3])
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)

/** JPEG: the first SOFn segment (C0–CF except C4 DHT, C8 JPG, CC DAC). */
function jpegSize(b: Uint8Array) {
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null
    let marker = b[i + 1]
    while (marker === 0xff && i + 2 < b.length) marker = b[++i + 1] // fill bytes
    i += 2
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9 || marker === 0xda) return null // EOI or SOS before any SOF
    if (i + 2 > b.length) return null
    const len = be16(b, i)
    if (len < 2) return null
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 7 > b.length) return null
      return { height: be16(b, i + 3), width: be16(b, i + 5) }
    }
    i += len
  }
  return null
}

function pngSize(b: Uint8Array) {
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null
  return { width: be32(b, 16), height: be32(b, 20) }
}

function webpSize(b: Uint8Array) {
  if (b.length < 30) return null
  const chunk = ascii(b, 12, 4)
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null
    const b0 = b[21]
    const b1 = b[22]
    const b2 = b[23]
    const b3 = b[24]
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
  }
  if (chunk === "VP8X") return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) }
  return null
}

/** Image width and height from the headers, or null when they can't be read. */
export function imageSize(b: Uint8Array, mime: Sniffed["mime"]): { width: number; height: number } | null {
  const s = mime === "image/jpeg" ? jpegSize(b) : mime === "image/png" ? pngSize(b) : mime === "image/webp" ? webpSize(b) : null
  return s && s.width > 0 && s.height > 0 ? s : null
}

/** Walks ISO-BMFF boxes in [from, to): yields type, payload start and end. */
function* boxes(b: Uint8Array, from: number, to: number) {
  let i = from
  while (i + 8 <= to) {
    let size = be32(b, i)
    const type = ascii(b, i + 4, 4)
    let header = 8
    if (size === 1) {
      if (i + 16 > to) return
      size = be32(b, i + 8) * 2 ** 32 + be32(b, i + 12)
      header = 16
    } else if (size === 0) size = to - i
    if (size < header || i + size > to) return
    yield { type, start: i + header, end: i + size }
    i += size
  }
}

/** MP4: duration from moov/mvhd and the first non-zero track size from moov/trak/tkhd. Missing parts are null. */
export function mp4Info(b: Uint8Array): { durationMs: number | null; width: number | null; height: number | null } {
  const out = { durationMs: null as number | null, width: null as number | null, height: null as number | null }
  for (const top of boxes(b, 0, b.length)) {
    if (top.type !== "moov") continue
    for (const box of boxes(b, top.start, top.end)) {
      if (box.type === "mvhd" && out.durationMs === null) {
        const v = b[box.start]
        const p = box.start + 4
        const timescale = v === 1 ? be32(b, p + 16) : be32(b, p + 8)
        const duration = v === 1 ? be32(b, p + 20) * 2 ** 32 + be32(b, p + 24) : be32(b, p + 12)
        if (timescale > 0) out.durationMs = Math.round((duration / timescale) * 1000)
      }
      if (box.type === "trak" && out.width === null) {
        for (const t of boxes(b, box.start, box.end)) {
          if (t.type !== "tkhd") continue
          const v = b[t.start]
          const sizeAt = t.start + 4 + (v === 1 ? 32 : 20) + 8 + 8 + 36
          if (sizeAt + 8 > t.end) continue
          const w = be32(b, sizeAt) >>> 16
          const h = be32(b, sizeAt + 4) >>> 16
          if (w > 0 && h > 0) {
            out.width = w
            out.height = h
          }
        }
      }
    }
  }
  return out
}
