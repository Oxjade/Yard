import "server-only"
import { getEnv } from "../env"
import { hmacHex } from "../security/crypto"
import { keys } from "../security/keys"

/**
 * Client IP trust model (§5.1). Next fills X-Forwarded-For only when it's absent and Route
 * Handlers have no request.ip, so any client can choose its own header. With
 * YARD_TRUSTED_PROXY_HOPS = N ≥ 1 the N-th entry from the right is the address the outermost
 * trusted proxy saw; entries a client prepends sit further left and are never read. With N = 0
 * (the default) the IP is unknown: null.
 */
export function clientIp(req: Request): string | null {
  const hops = getEnv().trustedProxyHops
  if (hops < 1) return null
  const header = req.headers.get("x-forwarded-for")
  if (!header) return null
  const entries = header
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (entries.length < hops) return null
  const ip = entries[entries.length - hops]
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip.replace(/^::ffff:/, "") : null
}

/** HMAC(keys.ip, ip|yyyy-mm).slice(0,16): rotates monthly, never reversible. */
export function ipHash(ip: string | null, at = new Date()) {
  if (!ip) return null
  return hmacHex(keys().ip, `${ip}|${at.toISOString().slice(0, 7)}`).slice(0, 16)
}

/** Hosts a development server answers as itself: loopback, plus YARD_PUBLIC_URL's host. */
function trustedDevHost(host: string, publicOrigin: string) {
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]
  if (name === "localhost" || name === "127.0.0.1" || name === "[::1]") return true
  try {
    return name === new URL(publicOrigin).hostname || host === new URL(publicOrigin).host
  } catch {
    return false
  }
}

/**
 * The app origin for CSRF checks (§2.5): YARD_PUBLIC_URL's origin in production; in development
 * `${proto}://${Host}`, but only for a loopback host or YARD_PUBLIC_URL's host. Any other Host
 * (DNS rebinding: a page on evil.example re-pointed at 127.0.0.1) falls back to YARD_PUBLIC_URL,
 * so its own Origin never matches. X-Forwarded-Host/Proto are trusted only behind a configured
 * proxy, and the same host rule applies to them.
 */
export function appOrigin(req: Request) {
  const env = getEnv()
  if (!env.dev) return env.publicOrigin
  const trust = env.trustedProxyHops > 0
  const host = (trust && req.headers.get("x-forwarded-host")?.split(",")[0]?.trim()) || req.headers.get("host")
  const proto = (trust && req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()) || new URL(req.url).protocol.replace(":", "")
  if (!host || !trustedDevHost(host.toLowerCase(), env.publicOrigin) || (proto !== "http" && proto !== "https")) return env.publicOrigin
  return `${proto}://${host}`
}
