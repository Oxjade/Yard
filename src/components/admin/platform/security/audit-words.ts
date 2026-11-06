/**
 * How an audit entry reads on screen, shared by the Security audit log and the Overview's audit
 * trail so the two never word the same entry differently.
 *
 * Operational actions are recorded now and carried out once the job runner, payments service
 * or auth service is connected, so the log says what was recorded, not that it already ran.
 */
const pendingLabel: Record<string, string> = {
  "Retried background job": "Recorded a job retry",
  "Replayed webhook": "Recorded a webhook replay",
  "Revoked session": "Recorded a session revoke",
  "Required MFA": "Recorded an MFA requirement",
}

export const actionLabel = (action: string) => pendingLabel[action] ?? action

/** The store writes price changes as "$14/day → $15/day"; on screen it reads as words. */
export const readable = (s: string) => s.replace(/\s*→\s*/g, " to ")
