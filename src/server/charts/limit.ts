import "server-only"
import { headers } from "next/headers"
import { clientIp, ipHash } from "../http/request"
import { hit, recordAbuse } from "../security/rate-limit"
import { currentAnon } from "../signals/anon"

/**
 * The /charts page reads boards straight from the server module, so it takes the same budget as
 * GET /api/charts (§5.1): 120 a minute per caller and 6,000 a minute for every anonymous caller
 * together, in the same buckets, so loading the page and polling the API draw on one allowance.
 * The caller is the client IP's hash when the server trusts a proxy hop, else this browser's
 * signed anonymous id (yard_anon), else only the shared anonymous bucket applies.
 */
export const READ_RATE = { key: "charts.read", limit: 120, windowSec: 60, anonGlobal: 6000 } as const

export async function pageReadAllowed(): Promise<boolean> {
  const h = await headers()
  const hash = ipHash(clientIp(new Request("http://yard.local/charts", { headers: h })))
  const anon = hash ? null : await currentAnon()
  const who = hash ? `ip:${hash}` : anon ? `anon:${anon.actorId}` : null
  const checks = [...(who ? [{ key: `${READ_RATE.key}:${who}`, limit: READ_RATE.limit }] : []), { key: `${READ_RATE.key}:anon-global`, limit: READ_RATE.anonGlobal }]
  for (const c of checks) {
    if (hit(c.key, c.limit, READ_RATE.windowSec).ok) continue
    await recordAbuse(c.key, { kind: "anon", id: anon?.actorId ?? null, ipHash: hash }, READ_RATE.key, "rate_limit", { limit: c.limit, windowSec: READ_RATE.windowSec, surface: "page" }).catch(() => {})
    return false
  }
  return true
}
