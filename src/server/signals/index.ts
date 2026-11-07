import "server-only"

/** Signals contract (§6.3): ingest for POST /api/signals and the yard_anon cookie. C reads chart_events. */
export const IMPL: string = "F2-2026-11-06"
export { ingestSignal, ingestSignalDetailed, accountAgeDays, STATE_KINDS, IP_CAP, type SignalInput, type SignalVerdict, type SignalActor } from "./ingest"
export { anonActorId, issueAnonCookie, currentAnon, anonCookieName } from "./anon"
export const jobs = {}
