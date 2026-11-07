import { signalBody } from "@/lib/api/contracts/signals"
import { getShopper } from "@/server/auth/dal"
import { unauthenticated } from "@/server/http/errors"
import { noContent, route } from "@/server/http/route"
import { hmacHex } from "@/server/security/crypto"
import { keys } from "@/server/security/keys"
import { hit, recordAbuse } from "@/server/security/rate-limit"
import { accountAgeDays, anonActorId, currentAnon, ingestSignal, issueAnonCookie, STATE_KINDS, type SignalActor } from "@/server/signals"

/**
 * POST /api/signals (§6.3). Sent with navigator.sendBeacon (text/plain JSON) or
 * fetch(keepalive); the beacon CSRF mode still needs a same-origin Origin (§2.5).
 *  - Only the nine client kinds (400 otherwise); follow, wishlist and reminder kinds need a
 *    shopper session (401): the client's "only when signed in" isn't trusted.
 *  - Anonymous callers get a server-issued yard_anon cookie; without an established one the
 *    signal is stored as excluded_anon and never counted. New cookies have their own budget
 *    (MINT_GLOBAL a minute across everyone, MINT_PER_IP per known IP): past it the beacon gets a
 *    204 with no cookie and nothing stored, so a script can't mint visitors faster than that, and
 *    ingest caps how many anonymous visitors count per brand and day while the IP is unknown.
 *  - Limits: 120/min per signed-in actor; anonymous 120/min per anon cookie and per known IP,
 *    plus 3,000/min across all anonymous callers. Over a limit: 204 without counting, and an
 *    abuse_events row (at most one per key per minute).
 */
const PER_ACTOR = 120
const ANON_GLOBAL = 3000
const MINT_GLOBAL = 60
const MINT_PER_IP = 10

export const POST = route({ auth: "public", csrf: "beacon", body: signalBody, maxBody: 2048 }, async ({ body, ipHash, req }) => {
  const shopper = await getShopper()
  if (STATE_KINDS.has(body.kind) && !shopper) throw unauthenticated("Sign in to follow brands, save pieces or set drop reminders.")
  const ua = req.headers.get("user-agent")
  const uaHash = ua ? hmacHex(keys().anon, ua).slice(0, 16) : null

  let who: SignalActor
  const limits: string[] = []
  if (shopper) {
    who = { actorKind: "shopper", actorId: shopper.userId, ipHash, uaHash, accountAgeDays: accountAgeDays(shopper.createdAt), status: shopper.status }
    limits.push(`signals:shopper:${shopper.userId}`)
  } else {
    const anon = await currentAnon()
    if (anon) {
      who = { actorKind: "anon", actorId: anon.actorId, ipHash, uaHash, accountAgeDays: null, anonEstablished: anon.establishedMs >= 60_000 }
      limits.push(`signals:anon:${anon.actorId}`)
    } else {
      // No (valid) cookie: issue one now, within the minting budget. This signal is stored as
      // excluded_anon either way; past the budget nothing is stored and no cookie is set.
      const mintKey = ipHash && !hit(`signals:anon-mint:ip:${ipHash}`, MINT_PER_IP, 60).ok ? `signals:anon-mint:ip:${ipHash}` : !hit("signals:anon-mint", MINT_GLOBAL, 60).ok ? "signals:anon-mint" : null
      if (mintKey) {
        await recordAbuse(mintKey, { kind: "anon", id: null, ipHash }, "signal", "signal_anon", { reason: "mint_budget", limit: mintKey === "signals:anon-mint" ? MINT_GLOBAL : MINT_PER_IP, windowSec: 60 }).catch(() => {})
        return noContent()
      }
      const fresh = anonActorId(await issueAnonCookie())!
      who = { actorKind: "anon", actorId: fresh.actorId, ipHash, uaHash, accountAgeDays: null, anonEstablished: false }
    }
    if (ipHash) limits.push(`signals:ip:${ipHash}`)
  }
  for (const key of limits) {
    if (!hit(key, PER_ACTOR, 60).ok) {
      await recordAbuse(key, { kind: who.actorKind, id: who.actorKind === "shopper" ? who.actorId : null, ipHash }, "signal", "rate_limit", { limit: PER_ACTOR, windowSec: 60 }).catch(() => {})
      return noContent()
    }
  }
  if (!shopper && !hit("signals:anon-global", ANON_GLOBAL, 60).ok) {
    await recordAbuse("signals:anon-global", { kind: "anon", id: null, ipHash }, "signal", "rate_limit", { limit: ANON_GLOBAL, windowSec: 60 }).catch(() => {})
    return noContent()
  }

  return { verdict: await ingestSignal(body, who) }
})
