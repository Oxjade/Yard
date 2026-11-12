/**
 * The global per-IP safety net for /api/* (src/proxy.ts). Route limits (route.ts `rate`) are the
 * real per-action budgets; this sits in front of all of them so that one address can't flood the
 * server with requests that each pass their own route's budget, or with requests to routes that
 * answer 401/404 before any limit is counted.
 *
 * In-memory token buckets, one process by design (a single Yard server per deployment). Plain
 * code with no imports: the proxy is bundled apart from the app and must not load the server's
 * configuration or database, and the unit tests run it under plain Node.
 */

export type GuardConfig = {
  /** Requests a minute per client IP for /api/* (bucket size and refill rate). */
  apiPerMin: number
  /** Requests a minute per client IP for /api/auth/*, counted in its own bucket on top of the API one. */
  authPerMin: number
  /** Largest declared request body for a JSON API (uploads and webhooks aren't matched). */
  maxBodyBytes: number
  /** YARD_TRUSTED_PROXY_HOPS. */
  hops: number
  /** Not production: the dev-only test hooks (…/dev, …/dev/*; 404 in production) aren't counted. */
  dev?: boolean
}

export const GUARD_DEFAULTS = { apiPerMin: 300, authPerMin: 60, maxBodyBytes: 1024 * 1024 } as const

function intIn(raw: string | undefined, fallback: number, min: number, max: number) {
  const s = raw?.trim()
  if (!s) return fallback
  const n = Number(s)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/**
 * Reads the guard's settings from the environment; anything invalid falls back to the default.
 * Development defaults are ten times roomier (the acceptance kits drive hundreds of auth calls a
 * minute from one address, like auth/limits.ts's development budget); set the variables to test
 * the production numbers there.
 */
export function guardConfigFrom(env: Record<string, string | undefined>): GuardConfig {
  const dev = env.NODE_ENV !== "production"
  const scale = dev ? 10 : 1
  return {
    apiPerMin: intIn(env.YARD_RATE_API_PER_MIN, GUARD_DEFAULTS.apiPerMin * scale, 1, 100_000),
    authPerMin: intIn(env.YARD_RATE_AUTH_PER_MIN, GUARD_DEFAULTS.authPerMin * scale, 1, 100_000),
    maxBodyBytes: intIn(env.YARD_MAX_JSON_BODY_BYTES, GUARD_DEFAULTS.maxBodyBytes, 1024, 64 * 1024 * 1024),
    hops: intIn(env.YARD_TRUSTED_PROXY_HOPS, 0, 0, 5),
    dev,
  }
}

/**
 * The client IP under the same trust model as route.ts clientIp() (§5.1): the N-th
 * X-Forwarded-For entry from the right with N = YARD_TRUSTED_PROXY_HOPS; null when N = 0 or the
 * header is missing, short or malformed.
 */
export function clientIpFrom(forwardedFor: string | null, hops: number): string | null {
  if (hops < 1 || !forwardedFor) return null
  const entries = forwardedFor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (entries.length < hops) return null
  const ip = entries[entries.length - hops]
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip.replace(/^::ffff:/, "") : null
}

/** Paths the guard never counts: the health check (monitors, deploys) and provider webhooks. */
export function exemptPath(path: string) {
  return path === "/api/health" || path.startsWith("/api/health/") || path.startsWith("/api/webhooks/")
}

export const isAuthPath = (path: string) => path === "/api/auth" || path.startsWith("/api/auth/")

type Bucket = { tokens: number; at: number }

/**
 * Token buckets keyed by string: `capacity` tokens, refilled continuously at capacity per minute.
 * Bounded: past `maxKeys` the least recently used key is dropped (a full bucket is the same as no
 * bucket), and a sweep forgets buckets that have refilled.
 */
export class TokenBuckets {
  private buckets = new Map<string, Bucket>()
  constructor(private maxKeys = 50_000) {}

  /** Takes one token. ok: false carries the seconds until one is available again. */
  take(key: string, perMin: number, now = Date.now()): { ok: true; remaining: number } | { ok: false; retryAfter: number } {
    const rate = perMin / 60_000
    let b = this.buckets.get(key)
    if (b) {
      this.buckets.delete(key) // re-inserted below: Map order is the LRU order
      b.tokens = Math.min(perMin, b.tokens + (now - b.at) * rate)
      b.at = now
    } else b = { tokens: perMin, at: now }
    let out: { ok: true; remaining: number } | { ok: false; retryAfter: number }
    if (b.tokens >= 1) {
      b.tokens -= 1
      out = { ok: true, remaining: Math.floor(b.tokens) }
    } else out = { ok: false, retryAfter: Math.max(1, Math.ceil((1 - b.tokens) / rate / 1000)) }
    this.buckets.set(key, b)
    while (this.buckets.size > this.maxKeys) this.buckets.delete(this.buckets.keys().next().value as string)
    return out
  }

  /** Forgets buckets that would be full by now. */
  sweep(perMinFor: (key: string) => number, now = Date.now()) {
    for (const [k, b] of this.buckets) if (b.tokens + (now - b.at) * (perMinFor(k) / 60_000) >= perMinFor(k)) this.buckets.delete(k)
  }

  get size() {
    return this.buckets.size
  }
}

export type GuardVerdict =
  | { ok: true }
  | { ok: false; status: 429; retryAfter: number; message: string }
  | { ok: false; status: 413; message: string }

/**
 * One /api/* request. Unknown client IP (YARD_TRUSTED_PROXY_HOPS = 0, or the request came from the
 * server itself) isn't counted: there is no per-caller key, and one shared bucket would let a
 * single client lock everyone out. The route limits still apply (their anonymous global budgets).
 */
export function guardRequest(
  buckets: TokenBuckets,
  cfg: GuardConfig,
  req: { method: string; path: string; forwardedFor: string | null; contentLength: string | null; contentType: string | null },
  now = Date.now(),
): GuardVerdict {
  if (exemptPath(req.path)) return { ok: true }
  // The acceptance kits poll these test hooks (emails, fixtures) many times a minute from one address.
  if (cfg.dev && /\/dev(\/|$)/.test(req.path)) return { ok: true }
  const method = req.method.toUpperCase()
  // Images: one page of products is dozens of /api/media reads, and visitors on a mobile carrier
  // share addresses (CGNAT). They have their own, larger budget (media.read in the route).
  if ((method === "GET" || method === "HEAD") && req.path.startsWith("/api/media/")) return { ok: true }
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && req.contentLength && /^\d+$/.test(req.contentLength.trim())) {
    const multipart = (req.contentType ?? "").toLowerCase().startsWith("multipart/")
    if (!multipart && Number(req.contentLength) > cfg.maxBodyBytes)
      return { ok: false, status: 413, message: `This request is too large. Keep it under ${Math.round(cfg.maxBodyBytes / 1024)} KB.` }
  }
  const ip = clientIpFrom(req.forwardedFor, cfg.hops)
  if (!ip) return { ok: true }
  const slow = "Too many requests from your network. Wait a moment and try again."
  if (isAuthPath(req.path)) {
    const a = buckets.take(`auth|${ip}`, cfg.authPerMin, now)
    if (!a.ok) return { ok: false, status: 429, retryAfter: a.retryAfter, message: slow }
  }
  const r = buckets.take(`api|${ip}`, cfg.apiPerMin, now)
  if (!r.ok) return { ok: false, status: 429, retryAfter: r.retryAfter, message: slow }
  return { ok: true }
}
