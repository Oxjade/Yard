import "server-only"
import { readFile, writeFile } from "node:fs/promises"

/**
 * Metadata stripping (§5.4 step 5), on the bytes before they're stored:
 *  - JPEG: drops APP1 (Exif, XMP), APP13 (IPTC/Photoshop) and COM segments; keeps APP0, APP2
 *    (ICC), APP14 (Adobe colour transform) and everything from SOS on, byte for byte;
 *  - PNG: drops eXIf, tEXt, iTXt and zTXt chunks;
 *  - WebP: drops EXIF and "XMP " chunks, clears the matching VP8X flags and fixes the RIFF size.
 * Video metadata is not stripped (the upload sheet says so, §10). A file that can't be walked is
 * returned unchanged only when it has nothing to strip; a malformed one throws (the upload is 415).
 */
export class MalformedMedia extends Error {
  constructor(what: string) {
    super(`malformed ${what}`)
    this.name = "MalformedMedia"
  }
}

const ascii = (b: Buffer, at: number, len: number) => b.toString("latin1", at, at + len)

function stripJpeg(b: Buffer): Buffer {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new MalformedMedia("jpeg")
  const out: Buffer[] = [b.subarray(0, 2)]
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) throw new MalformedMedia("jpeg")
    // Fill bytes before a marker are dropped with nothing lost.
    while (b[i + 1] === 0xff) i++
    const marker = b[i + 1]
    if (marker === undefined) throw new MalformedMedia("jpeg")
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      out.push(b.subarray(i, i + 2))
      i += 2
      continue
    }
    if (marker === 0xd9) {
      out.push(b.subarray(i, i + 2))
      return Buffer.concat(out)
    }
    if (i + 4 > b.length) throw new MalformedMedia("jpeg")
    const len = b.readUInt16BE(i + 2)
    if (len < 2 || i + 2 + len > b.length) throw new MalformedMedia("jpeg")
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data and everything after it stay exactly as they are.
      out.push(b.subarray(i))
      return Buffer.concat(out)
    }
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe
    if (!drop) out.push(b.subarray(i, i + 2 + len))
    i += 2 + len
  }
  return Buffer.concat(out)
}

const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt"])

function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)]
  let i = 8
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i)
    const type = ascii(b, i + 4, 4)
    const end = i + 12 + len
    if (end > b.length) throw new MalformedMedia("png")
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end))
    i = end
    if (type === "IEND") break
  }
  return Buffer.concat(out)
}

function stripWebp(b: Buffer): Buffer {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") throw new MalformedMedia("webp")
  const chunks: Buffer[] = []
  let i = 12
  const riffEnd = Math.min(b.length, 8 + b.readUInt32LE(4))
  while (i + 8 <= riffEnd) {
    const fourcc = ascii(b, i, 4)
    const size = b.readUInt32LE(i + 4)
    const padded = size + (size & 1)
    const end = Math.min(i + 8 + padded, riffEnd)
    if (i + 8 + size > riffEnd) throw new MalformedMedia("webp")
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = Buffer.from(b.subarray(i, end))
      // VP8X flags: bit 3 = EXIF, bit 2 = XMP.
      if (fourcc === "VP8X" && chunk.length > 8) chunk[8] &= ~0x0c
      chunks.push(chunk)
    }
    i = end
  }
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write("RIFF", 0, "latin1")
  header.writeUInt32LE(4 + body.length, 4)
  header.write("WEBP", 8, "latin1")
  return Buffer.concat([header, body])
}

/** Strips metadata from image bytes; video is returned as it is. */
export function stripMetadataBytes(bytes: Buffer, mime: string): Buffer {
  if (mime === "image/jpeg") return stripJpeg(bytes)
  if (mime === "image/png") return stripPng(bytes)
  if (mime === "image/webp") return stripWebp(bytes)
  return bytes
}

/** In place on a file (for tools; uploads strip in memory before the file is written). */
export async function stripMetadata(path: string, mime: string): Promise<void> {
  const before = await readFile(path)
  const after = stripMetadataBytes(before, mime)
  if (after !== before) await writeFile(path, after)
}
