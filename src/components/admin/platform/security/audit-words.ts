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

/**
 * The server's audit keys (§8.3), as the log reads them. The server writes dotted keys; the
 * legacy pages in this browser write sentences, which read as they are.
 */
export const serverActionLabels: Record<string, string> = {
  "admin.signed_in": "Signed in",
  "admin.signed_out": "Signed out",
  "message.removed": "Removed message",
  "message.released": "Released held message",
  "message_context.viewed": "Viewed report evidence",
  "message_held.viewed": "Viewed held message",
  "conversation.locked": "Locked conversation",
  "conversation.marked_spam": "Marked conversation as spam",
  "report.dismissed": "Dismissed report",
  "report.escalated": "Escalated report",
  "media.viewed": "Viewed private file",
  "post.hidden": "Hid post",
  "post.removed": "Removed post",
  "post.restored": "Restored post",
  "location.approved": "Approved place",
  "location.rejected": "Rejected place",
  "location.removed": "Removed place",
  "location.restored": "Restored place",
  "location_event.approved": "Approved event",
  "location_event.hidden": "Hid event",
  "location_event.removed": "Removed event",
  "social.sync_retried": "Retried social sync",
  "social.force_disconnected": "Disconnected social account",
  "social.paused": "Paused social feed",
  "social.resumed": "Resumed social feed",
  "social.connected": "Connected social account",
  "social.disconnected": "Disconnected social account",
  "chart_flag.cleared": "Cleared chart flag",
  "chart_flag.confirmed": "Confirmed chart flag",
  "chart.freeze_requested": "Requested Charts freeze",
  "chart.freeze_approved": "Approved Charts freeze",
  "chart.freeze_lifted": "Lifted Charts freeze",
  "charts.recomputed": "Recomputed charts",
  "delivery.contacted_brand": "Contacted brand about delivery",
  "delivery.resolved": "Resolved delivery issue",
  "delivery.escalated": "Escalated delivery issue",
  "holiday.added": "Added holiday",
  "holiday.removed": "Removed holiday",
  "user.status_changed": "Changed account status",
  "brand.status_changed": "Changed brand status",
  "restriction.added": "Added restriction",
  "restriction.lifted": "Lifted restriction",
  "abuse_alert.dismissed": "Dismissed abuse alert",
  "audit.exported": "Exported audit log",
  "dev.cleanup": "Removed test data (development)",
  "dev.reseeded": "Reseeded sample data (development)",
  "shipping.profile_saved": "Saved shipping settings",
  "location.published": "Published place",
  "block.added": "Blocked a customer",
}

/** A dotted key nobody labelled yet still reads as words ("quick_reply.created" → "Quick reply created"). */
function fromKey(action: string) {
  const words = action.replace(/[._]/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const actionLabel = (action: string) => pendingLabel[action] ?? serverActionLabels[action] ?? (/^[a-z_]+\.[a-z_.]+$/.test(action) ? fromKey(action) : action)

const statusVerbs: Record<string, Record<string, string>> = {
  "user.status_changed": { active: "Reinstated the account (active)", "reinstated (active)": "Reinstated the account (active)", restricted: "Restricted the account", suspended: "Suspended the account" },
  "brand.status_changed": {
    verified: "Verified the brand",
    "returned to review": "Returned the brand to review",
    restricted: "Restricted the brand",
    suspended: "Suspended the brand",
    "reinstated (verified)": "Reinstated the brand (verified)",
    "reinstated (in review)": "Reinstated the brand (in review)",
  },
}

/**
 * An entry's label with its outcome where the key alone doesn't say it: a status change names the
 * new status, read from the end of its target ("Ada Nwosu, ada@…: restricted"). Older rows whose
 * target has no status keep the generic label.
 */
export function entryLabel(action: string, target?: string | null) {
  const verbs = statusVerbs[action]
  if (verbs && target) {
    const tail = target.slice(target.lastIndexOf(": ") + 2)
    if (target.includes(": ") && verbs[tail]) return verbs[tail]
  }
  return actionLabel(action)
}

/** The store writes price changes as "$14/day → $15/day"; on screen it reads as words. */
export const readable = (s: string) => s.replace(/\s*→\s*/g, " to ")

/** Browser-source rows are written by the legacy pages, which always act as the store's admin (§8.3). */
export const LEGACY_NOTE = "Legacy page — acts as Kemi Ajayi in this browser"

/**
 * A CSV cell: quoted, quotes doubled, and a value a spreadsheet would run as a formula (one that
 * starts with =, +, -, @, a tab or a carriage return) gets a leading apostrophe. Brand-written text
 * (place names) reaches the Target column, and Excel evaluates formulas in quoted cells too.
 */
export function csvCell(v: string | null | undefined) {
  const s = v ?? ""
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

export const AUDIT_CSV_HEADER = ["Time (UTC)", "Source", "Actor", "Role", "Action", "Target", "Reason", "Approver", "IP"]

export type AuditCsvRow = { at: string; source: "server" | "browser"; actor: string; roleName: string; action: string; target: string; reason?: string | null; approvedBy?: string | null; ip?: string | null }

/** One audit entry as a CSV line (the server's export and this browser's rows read the same). */
export function auditCsvLine(a: AuditCsvRow) {
  const day = a.at.endsWith("T12:00:00.000Z")
  return [day ? a.at.slice(0, 10) : a.at, a.source === "server" ? "Server" : "This browser", a.actor, a.roleName, entryLabel(a.action, a.target), readable(a.target), a.reason, a.approvedBy, a.source === "server" ? "Not recorded" : a.ip]
    .map(csvCell)
    .join(",")
}
