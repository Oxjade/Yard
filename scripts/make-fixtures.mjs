#!/usr/bin/env node
// Writes the upload test fixtures (§9.2) into <out> (default: $SCRATCH/fixtures, or ./scratchpad/fixtures):
//   exif.jpg  a /public/media JPEG with an APP1 Exif segment carrying GPS tags spliced in after SOI
//   exif-appended.jpg  exif.jpg twice, back to back: a second image (with its own Exif) after the
//             first EOI, as MPO/MPF phone photos store theirs (stripping must end at the first EOI)
//   exif-midscan.jpg   the progressive JPEG with the Exif segment and a COM placed between its
//             first and second scans (stripping must walk past the first SOS)
//   fake.jpg  an SVG document renamed .jpg (must be refused with 415)
//   big.jpg   a valid JPEG padded with a COM segment run to 9 MB (over the 8 MB inbox cap)
//   clip.mp4  a minimal ftyp + moov (mvhd + trak/tkhd) stub: 2.5 s, 640×360
//   tiny.png  a 16×16 PNG (under the 64 px minimum: 422)
//   text.png  a 96×96 PNG with a tEXt chunk (stripped on upload)
// Usage: node scripts/make-fixtures.mjs [outDir]
import { deflateSync } from "node:zlib"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const out = path.resolve(process.argv[2] ?? (process.env.SCRATCH ? path.join(process.env.SCRATCH, "fixtures") : path.join(root, "scratchpad", "fixtures")))
mkdirSync(out, { recursive: true })

const SOURCE = path.join(root, "public/media/objects/sneakers-white-leather-linen-01.jpg")
const src = readFileSync(SOURCE)
if (src[0] !== 0xff || src[1] !== 0xd8) throw new Error(`${SOURCE} is not a JPEG`)

// --- exif.jpg: a TIFF (little-endian) IFD0 with a GPS IFD pointer, GPS latitude/longitude rationals.
function exifSegment() {
  const tiff = Buffer.alloc(200)
  tiff.write("II", 0, "latin1")
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4) // IFD0 at 8
  // IFD0: 2 entries: Make (0x010F, ASCII) and GPSInfo (0x8825, LONG → offset)
  let o = 8
  tiff.writeUInt16LE(2, o)
  o += 2
  tiff.writeUInt16LE(0x010f, o); tiff.writeUInt16LE(2, o + 2); tiff.writeUInt32LE(4, o + 4); tiff.write("Yrd\0", o + 8, "latin1"); o += 12
  tiff.writeUInt16LE(0x8825, o); tiff.writeUInt16LE(4, o + 2); tiff.writeUInt32LE(1, o + 4); tiff.writeUInt32LE(38, o + 8); o += 12
  tiff.writeUInt32LE(0, o) // next IFD
  // GPS IFD at 38: LatitudeRef 'N', Latitude 6/1 27/1 0/1, LongitudeRef 'E', Longitude 3/1 23/1 0/1
  o = 38
  tiff.writeUInt16LE(4, o)
  o += 2
  const ratBase = 38 + 2 + 4 * 12 + 4 // 94
  tiff.writeUInt16LE(1, o); tiff.writeUInt16LE(2, o + 2); tiff.writeUInt32LE(2, o + 4); tiff.write("N\0", o + 8, "latin1"); o += 12
  tiff.writeUInt16LE(2, o); tiff.writeUInt16LE(5, o + 2); tiff.writeUInt32LE(3, o + 4); tiff.writeUInt32LE(ratBase, o + 8); o += 12
  tiff.writeUInt16LE(3, o); tiff.writeUInt16LE(2, o + 2); tiff.writeUInt32LE(2, o + 4); tiff.write("E\0", o + 8, "latin1"); o += 12
  tiff.writeUInt16LE(4, o); tiff.writeUInt16LE(5, o + 2); tiff.writeUInt32LE(3, o + 4); tiff.writeUInt32LE(ratBase + 24, o + 8); o += 12
  tiff.writeUInt32LE(0, o)
  const rats = [6, 1, 27, 1, 0, 1, 3, 1, 23, 1, 0, 1]
  rats.forEach((v, i) => tiff.writeUInt32LE(v, ratBase + i * 4))
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff.subarray(0, ratBase + rats.length * 4)])
  const seg = Buffer.alloc(4)
  seg[0] = 0xff
  seg[1] = 0xe1
  seg.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([seg, payload])
}
const exif = Buffer.concat([src.subarray(0, 2), exifSegment(), src.subarray(2)])
writeFileSync(path.join(out, "exif.jpg"), exif)
writeFileSync(path.join(out, "exif-appended.jpg"), Buffer.concat([exif, exif]))

// --- exif-midscan.jpg: after the first scan's entropy-coded data (the next marker that isn't FF00,
// RSTn or fill), splice an Exif APP1 and a COM, then the rest of the file.
function firstScanEnd(b) {
  let i = 2
  while (i < b.length) {
    while (b[i + 1] === 0xff) i++
    const m = b[i + 1]
    const len = b.readUInt16BE(i + 2)
    if (m !== 0xda) {
      i += 2 + len
      continue
    }
    let j = i + 2 + len
    for (;;) {
      j = b.indexOf(0xff, j)
      if (j < 0) throw new Error("no marker after the first scan")
      const n = b[j + 1]
      if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) j += 2
      else if (n === 0xff) j += 1
      else return j
    }
  }
  throw new Error("no SOS")
}
const cut = firstScanEnd(src)
if (src[cut + 1] === 0xd9) throw new Error(`${SOURCE} is not progressive: nothing between scans`)
const com = Buffer.from("Shot at 6.4600 N 3.5200 E", "latin1")
const comSeg = Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), com])
comSeg.writeUInt16BE(com.length + 2, 2)
writeFileSync(path.join(out, "exif-midscan.jpg"), Buffer.concat([src.subarray(0, cut), exifSegment(), comSeg, src.subarray(cut)]))

// --- fake.jpg: an SVG with a script, renamed.
writeFileSync(path.join(out, "fake.jpg"), `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><script>alert(1)</script><rect width="200" height="200"/></svg>\n`)

// --- big.jpg: COM segments (max 65533 bytes of payload each) after SOI until the file is 9 MB.
const TARGET = 9 * 1024 * 1024
const parts = [src.subarray(0, 2)]
let size = src.length
while (size < TARGET) {
  const n = Math.min(65533, TARGET - size)
  const seg = Buffer.alloc(4 + n, 0x20)
  seg[0] = 0xff
  seg[1] = 0xfe
  seg.writeUInt16BE(n + 2, 2)
  parts.push(seg)
  size += 4 + n
}
parts.push(src.subarray(2))
writeFileSync(path.join(out, "big.jpg"), Buffer.concat(parts))

// --- clip.mp4: ftyp(isom) + moov(mvhd v0 timescale 1000 duration 2500, trak(tkhd v0 640×360)).
const box = (type, ...payloads) => {
  const body = Buffer.concat(payloads)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.length, 0)
  head.write(type, 4, "latin1")
  return Buffer.concat([head, body])
}
const ftyp = box("ftyp", Buffer.from("isom", "latin1"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41", "latin1"))
const mvhd = Buffer.alloc(100)
mvhd.writeUInt32BE(1000, 12) // timescale (after version/flags 4, creation 4, modification 4)
mvhd.writeUInt32BE(2500, 16) // duration
mvhd.writeUInt32BE(0x00010000, 20) // rate 1.0
mvhd.writeUInt16BE(0x0100, 24) // volume 1.0
mvhd.writeUInt32BE(2, 96) // next track id
const tkhd = Buffer.alloc(84)
tkhd.writeUInt32BE(0x00000003, 0) // version 0, flags enabled|in movie
tkhd.writeUInt32BE(1, 12) // track id
tkhd.writeUInt32BE(2500, 20) // duration
tkhd.writeUInt32BE(640 << 16, 76) // width 16.16
tkhd.writeUInt32BE(360 << 16, 80) // height 16.16
writeFileSync(path.join(out, "clip.mp4"), Buffer.concat([ftyp, box("moov", box("mvhd", mvhd), box("trak", box("tkhd", tkhd))), box("mdat", Buffer.alloc(64))]))

// --- PNGs.
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, "latin1"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w, h, extra = []) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const rows = Buffer.alloc((w * 3 + 1) * h, 0x11)
  for (let y = 0; y < h; y++) rows[y * (w * 3 + 1)] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))])
}
writeFileSync(path.join(out, "tiny.png"), png(16, 16))
writeFileSync(path.join(out, "text.png"), png(96, 96, [chunk("tEXt", Buffer.from("Comment\0Shot at 6.4600 N 3.5200 E", "latin1"))]))

console.log(`fixtures in ${out}:`)
for (const f of ["exif.jpg", "exif-appended.jpg", "exif-midscan.jpg", "fake.jpg", "big.jpg", "clip.mp4", "tiny.png", "text.png"]) console.log(`  ${f.padEnd(17)} ${readFileSync(path.join(out, f)).length} bytes`)
