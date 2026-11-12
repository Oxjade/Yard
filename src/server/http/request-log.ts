/**
 * One structured line per API request (production by default; YARD_REQUEST_LOG=1 turns it on
 * elsewhere, YARD_REQUEST_LOG=0 off): method, path, status, duration and the request id that the
 * response carries in X-Request-Id. Never a query string (tokens travel there: unsubscribe links,
 * OAuth callbacks), a body, a header, a cookie or an IP. No imports: src/proxy.ts logs its own
 * refusals with it too.
 */
export function requestLogEnabled(env: Record<string, string | undefined> = process.env) {
  const v = env.YARD_REQUEST_LOG?.trim()
  if (v === "1") return true
  if (v === "0") return false
  return env.NODE_ENV === "production"
}

export type RequestLine = { id: string; method: string; path: string; status: number; ms: number; by?: string }

/** A JSON line journald and log tools can parse: {"t":"req",...}. The path is cut at 200 characters. */
export function requestLine(r: RequestLine) {
  const path = r.path.length > 200 ? `${r.path.slice(0, 200)}…` : r.path
  return JSON.stringify({ t: "req", id: r.id, m: r.method, p: path, s: r.status, ms: Math.round(r.ms), ...(r.by ? { by: r.by } : {}) })
}

export function logRequest(r: RequestLine, env: Record<string, string | undefined> = process.env) {
  if (requestLogEnabled(env)) console.log(requestLine(r))
}
