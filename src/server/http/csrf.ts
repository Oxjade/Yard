import "server-only"
import { csrfFailed } from "./errors"
import { appOrigin } from "./request"

/**
 * CSRF for every non-GET Route Handler (§2.5). Route Handlers don't get the Server Action Origin
 * check, so this requires all of:
 *  - Origin equal to the app origin (or Sec-Fetch-Site: same-origin when Origin is absent);
 *  - X-Yard-Client: 1 (a custom header forces a CORS preflight we never answer);
 *  - for JSON endpoints, Content-Type: application/json.
 * `beacon` (POST /api/signals) accepts text/plain from navigator.sendBeacon without the custom
 * header, but still needs a same-origin Origin.
 */
export function assertSameOrigin(req: Request, opts: { body?: "json" | "multipart" | "beacon" | "none" } = {}) {
  const origin = req.headers.get("origin")
  const site = req.headers.get("sec-fetch-site")
  const expected = appOrigin(req)
  const sameOrigin = origin ? origin === expected : site === "same-origin"
  if (!sameOrigin) throw csrfFailed()
  const kind = opts.body ?? "json"
  if (kind === "beacon") {
    const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
    if (ct && ct !== "text/plain" && ct !== "application/json") throw csrfFailed()
    return
  }
  if (req.headers.get("x-yard-client") !== "1") throw csrfFailed()
  if (kind === "json") {
    const ct = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
    const hasBody = req.headers.get("content-length") !== "0" && (req.headers.has("content-length") || req.headers.has("transfer-encoding"))
    if (hasBody && ct !== "application/json") throw csrfFailed()
  }
  if (kind === "multipart") {
    const ct = (req.headers.get("content-type") ?? "").toLowerCase()
    if (!ct.startsWith("multipart/form-data")) throw csrfFailed()
  }
}
