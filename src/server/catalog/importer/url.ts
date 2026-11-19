import { BlockList, isIP } from "node:net"

/**
 * URL rules for the website importer (docs/IMPORTER.md). Plain Node, no server-only, so the unit
 * tests load it directly. Everything the importer fetches goes through cleanUrl first, and every
 * address a host resolves to goes through isBlockedAddress before a socket is opened (fetch.ts).
 */

export class ImportUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImportUrlError"
  }
}

/** Query parameters that only track a visit: removed before the URL is stored or fetched. */
const TRACKING_EXACT = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "ttclid",
  "twclid",
  "igshid",
  "igsh",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "yclid",
  "srsltid",
  "sccid",
  "scid",
  "li_fat_id",
  "epik",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "oly_anon_id",
  "oly_enc_id",
  "vero_id",
  "rb_clickid",
  "s_cid",
  "ref_src",
])
const TRACKING_PREFIXES = ["utm_", "pk_", "mtm_", "hsa_", "_bta_"]

export function isTrackingParam(name: string) {
  const n = name.toLowerCase()
  return TRACKING_EXACT.has(n) || TRACKING_PREFIXES.some((p) => n.startsWith(p))
}

/** Hosts that only make sense inside a private network. */
const INTERNAL_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".home.arpa", ".corp", ".localdomain", ".test", ".invalid", ".example"]

export function isBlockedHostname(hostname: string) {
  const h = hostname.toLowerCase().replace(/\.$/, "")
  if (!h || h === "localhost") return true
  // An IP literal is judged by its address.
  const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h
  if (isIP(bare)) return isBlockedAddress(bare)
  // A single label ("intranet", "db") resolves through the search domain to something private.
  if (!h.includes(".")) return true
  if (INTERNAL_SUFFIXES.some((s) => h.endsWith(s))) return true
  // Purely numeric labels are an IPv4 address in another notation (0x7f.1, 2130706433.com is fine).
  if (/^[0-9.]+$/.test(h) || /^0x[0-9a-f]+(\.|$)/.test(h)) return true
  return false
}

const v4 = new BlockList()
for (const [net, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  v4.addSubnet(net, bits, "ipv4")

const v6 = new BlockList()
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001::", 32], // Teredo
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  v6.addSubnet(net, bits, "ipv6")

/** Expands an IPv6 address to its 8 groups (numbers), or null. */
function v6Groups(addr: string): number[] | null {
  let a = addr.toLowerCase()
  const zone = a.indexOf("%")
  if (zone >= 0) a = a.slice(0, zone)
  // A trailing dotted IPv4 becomes two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (dotted) {
    const p = dotted[1].split(".").map(Number)
    if (p.some((n) => n > 255)) return null
    a = a.slice(0, -dotted[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const halves = a.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const groups = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail].map((g) => parseInt(g, 16))
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`

/**
 * True for any address the importer must never connect to: private, loopback, link-local, CGNAT,
 * multicast, documentation and reserved ranges, and IPv6 forms that carry such an IPv4 address
 * (IPv4-mapped, IPv4-compatible, NAT64 64:ff9b::/96, 6to4 2002::/16). Unparseable is blocked.
 */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address.replace(/%.*$/, ""))
  if (kind === 4) return v4.check(address, "ipv4")
  if (kind !== 6) return true
  const g = v6Groups(address)
  if (!g) return true
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, deprecated): judged as the IPv4 inside.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0) && (g[6] || g[7])) return isBlockedAddress(v4From(g[6], g[7]))
  // NAT64 well-known prefix 64:ff9b::/96 and the local-use 64:ff9b:1::/48.
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 1 ? true : isBlockedAddress(v4From(g[6], g[7]))
  // 6to4: 2002:AABB:CCDD::/48 carries AA.BB.CC.DD.
  if (g[0] === 0x2002) return isBlockedAddress(v4From(g[1], g[2]))
  return v6.check(g.map((x) => x.toString(16)).join(":"), "ipv6")
}

/**
 * Parses and cleans a URL the importer may fetch: http(s) only, no user name or password, the
 * default port only, a public-looking host, no fragment, tracking parameters removed. A bare
 * "brand.com" is read as https://brand.com. Throws ImportUrlError with a sentence for people.
 */
export function cleanUrl(raw: string, base?: string | URL): URL {
  const input = raw.trim()
  if (!input) throw new ImportUrlError("Paste the brand's website address.")
  if (input.length > 2000) throw new ImportUrlError("That address is too long.")
  let url: URL
  try {
    url = base ? new URL(input, base) : new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`)
  } catch {
    throw new ImportUrlError("That isn't a web address. Paste it as https://brand.com.")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ImportUrlError("Only http and https addresses can be imported.")
  if (url.username || url.password) throw new ImportUrlError("Remove the user name and password from the address.")
  if (url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))) throw new ImportUrlError("Use the site's normal address, without a port number.")
  if (isBlockedHostname(url.hostname)) throw new ImportUrlError("That address points to a private network. Use the brand's public website.")
  url.hash = ""
  for (const k of [...url.searchParams.keys()]) if (isTrackingParam(k)) url.searchParams.delete(k)
  // An empty query leaves a bare "?" behind.
  if (!url.searchParams.toString()) url.search = ""
  return url
}

/** The URL without tracking parameters as a string, or null when it can't be fetched. */
export function cleanHref(raw: string, base?: string | URL): string | null {
  try {
    return cleanUrl(raw, base).toString()
  } catch {
    return null
  }
}

/** Same host, ignoring a leading www. */
export function sameSite(a: URL | string, b: URL | string) {
  const h = (u: URL | string) => (typeof u === "string" ? new URL(u) : u).hostname.toLowerCase().replace(/^www\./, "")
  try {
    return h(a) === h(b)
  } catch {
    return false
  }
}
