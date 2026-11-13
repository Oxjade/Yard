import "server-only"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Reader, type CountryResponse } from "mmdb-lib"
import { getEnv } from "../env"
import { log } from "../log"

/**
 * IP → country (ISO 3166-1 alpha-2) from the free DB-IP "IP to Country Lite" database
 * (CC BY 4.0, https://db-ip.com), kept at ${YARD_DATA_DIR}/geoip/dbip-country.mmdb and refreshed
 * monthly by scripts/geoip-update.mjs. The file is re-read when it changes (checked at most hourly),
 * so an update needs no restart. Without the file every lookup returns null ("unknown").
 */
type State = { reader: Reader<CountryResponse> | null; mtimeMs: number; checkedAt: number; loading: Promise<void> | null }

const CHECK_EVERY_MS = 60 * 60 * 1000
const g = globalThis as typeof globalThis & { __yardGeo?: State }
const state = (): State => (g.__yardGeo ??= { reader: null, mtimeMs: 0, checkedAt: 0, loading: null })

export function geoDbPath() {
  return path.join(/*turbopackIgnore: true*/ getEnv().dataDir, "geoip", "dbip-country.mmdb")
}

async function refresh(s: State) {
  s.checkedAt = Date.now()
  try {
    const file = geoDbPath()
    const info = await stat(file)
    if (s.reader && info.mtimeMs === s.mtimeMs) return
    s.reader = new Reader<CountryResponse>(await readFile(file))
    s.mtimeMs = info.mtimeMs
  } catch (err) {
    if (s.reader === null) log.once("geo:missing", "warn", `[yard] No country database at ${geoDbPath()}: traffic shows as "Unknown" until scripts/geoip-update.mjs runs.`)
    else log.once("geo:reload", "warn", `[yard] Country database reload failed: ${(err as Error).message}`)
  }
}

/** True when a country database is loaded. */
export async function geoReady() {
  const s = state()
  if (!s.reader || Date.now() - s.checkedAt > CHECK_EVERY_MS) await (s.loading ??= refresh(s).finally(() => (s.loading = null)))
  return s.reader !== null
}

/** Two-letter country code for an IP, or null when unknown. Never throws. */
export async function countryOf(ip: string | null): Promise<string | null> {
  if (!ip) return null
  try {
    if (!(await geoReady())) return null
    const code = state().reader?.get(ip)?.country?.iso_code
    return code && /^[A-Z]{2}$/.test(code) ? code : null
  } catch {
    return null
  }
}
