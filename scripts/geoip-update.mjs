#!/usr/bin/env node
/**
 * Downloads the free DB-IP "IP to Country Lite" database (CC BY 4.0, https://db-ip.com) to
 * ${YARD_DATA_DIR}/geoip/dbip-country.mmdb for admin Traffic by country. DB-IP publishes a new
 * file each month; this skips the download when the current file is under 25 days old (pass
 * --force to refresh anyway). The running server picks up a new file within the hour, no restart.
 *
 *   YARD_DATA_DIR=/var/lib/yard node scripts/geoip-update.mjs [--force]
 */
import { createGunzip } from "node:zlib"
import { mkdir, readFile, rename, stat, unlink } from "node:fs/promises"
import { createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import path from "node:path"
import { Reader } from "mmdb-lib"

const dataDir = process.env.YARD_DATA_DIR
if (!dataDir || !path.isAbsolute(dataDir)) {
  console.error("geoip-update: set YARD_DATA_DIR to the data directory (absolute path).")
  process.exit(1)
}
const dir = path.join(dataDir, "geoip")
const target = path.join(dir, "dbip-country.mmdb")
const force = process.argv.includes("--force")

try {
  const info = await stat(target)
  const ageDays = (Date.now() - info.mtimeMs) / 86_400_000
  if (!force && ageDays < 25) {
    console.log(`geoip-update: ${target} is ${ageDays.toFixed(0)} days old; nothing to do.`)
    process.exit(0)
  }
} catch {
  /* no file yet */
}

await mkdir(dir, { recursive: true })
const month = (offset) => {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - offset)
  return d.toISOString().slice(0, 7)
}

const tmp = `${target}.download`
let ok = false
for (const m of [month(0), month(1)]) {
  const url = `https://download.db-ip.com/free/dbip-country-lite-${m}.mmdb.gz`
  try {
    const res = await fetch(url)
    if (!res.ok || !res.body) {
      console.log(`geoip-update: ${url} answered ${res.status}`)
      continue
    }
    await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmp))
    const reader = new Reader(await readFile(tmp))
    const probe = reader.get("8.8.8.8")?.country?.iso_code
    if (!probe) throw new Error("downloaded file failed the lookup check")
    await rename(tmp, target)
    console.log(`geoip-update: installed DB-IP country lite ${m} at ${target}`)
    ok = true
    break
  } catch (err) {
    console.log(`geoip-update: ${url} failed: ${err.message}`)
    await unlink(tmp).catch(() => {})
  }
}
// A failed refresh never breaks a deploy: the old file (if any) keeps working.
if (!ok) console.log("geoip-update: no new file installed; Traffic keeps using the existing database, or shows Unknown without one.")
