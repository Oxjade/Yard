import "server-only"
import { NotImplemented } from "../http/errors"

/** `anon_` + HMAC(keys.anon, cookie id).slice(0, 20), or null without an established cookie (§6.3). */
export function anonActorId(cookieValue: string | undefined): { actorId: string; establishedMs: number } | null {
  void cookieValue
  throw new NotImplemented("signals.anonActorId")
}

/** Issues yard_anon = <16 random bytes>.<issuedAt>.<HMAC> (httpOnly, Lax, a year). */
export async function issueAnonCookie(): Promise<string> {
  throw new NotImplemented("signals.issueAnonCookie")
}
