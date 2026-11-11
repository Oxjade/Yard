/**
 * The demo switch as code outside React can read it synchronously: /api/session's request-time
 * answer, recorded by the session store when it arrives. There is deliberately no earlier source:
 * the root layout is prerendered at build, so a value it handed down would be the build's, not
 * this server's (the proxy's rule: read per request, never baked in at build).
 *
 * Used where a decision can't wait for a hook: the persisted cart and saved lists drop sample ids
 * while they rehydrate (when the answer is already in), the cart never sends a sample line to the
 * server, and the bag count never counts one. Until the answer arrives nothing is purged (unknown
 * counts as on, so demo never loses a line); <Providers> purges as soon as it says off.
 * No imports and no directive: safe in server code too (where nothing is recorded).
 */
let fromSession: boolean | null = null

export function setSampleDataFromSession(value: boolean | null) {
  fromSession = value
}

/** True when the sample catalogue is known to be off (production). Unknown counts as on. */
export function sampleDataOff(): boolean {
  return fromSession === false
}
