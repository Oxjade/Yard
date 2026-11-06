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

/** The store writes price changes as "$14/day → $15/day"; on screen it reads as words. */
export const readable = (s: string) => s.replace(/\s*→\s*/g, " to ")

/** Browser-source rows are written by the legacy pages, which always act as the store's admin (§8.3). */
export const LEGACY_NOTE = "Legacy page — acts as Kemi Ajayi in this browser"
