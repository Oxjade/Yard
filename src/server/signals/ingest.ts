import "server-only"
import { NotImplemented } from "../http/errors"

export type SignalInput = { kind: string; productId?: string; dropId?: string; brandId?: string }
export type SignalVerdict = "counted" | "deduped" | "excluded_self" | "excluded_restricted" | "excluded_fraud" | "excluded_anon"

/** POST /api/signals (F2, §6.3): allowlisted kinds, server-side state, dedupe and the IP cap. */
export async function ingestSignal(input: SignalInput, who: { actorKind: "shopper" | "anon"; actorId: string; ipHash: string | null; uaHash: string | null; accountAgeDays: number | null }): Promise<SignalVerdict> {
  void input
  void who
  throw new NotImplemented("signals.ingestSignal")
}
