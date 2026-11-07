"use client"

import type { SignalBody } from "@/lib/api/contracts/signals"
import { getServerSessionState } from "@/lib/session/use-server-session"

/**
 * Fire-and-forget chart signals (§6.3). Follows, wishlist changes and drop reminders are sent only
 * while a shopper session exists (the server checks too, and answers 401 otherwise); views may be
 * anonymous. Uses navigator.sendBeacon (text/plain JSON, survives navigation) and falls back to
 * fetch(keepalive). Never throws and never blocks the UI: the browser lists stay the UI's truth.
 */
const STATE_KINDS = new Set(["follow", "unfollow", "wishlist_add", "wishlist_remove", "reminder_set", "reminder_unset"])

export function reportSignal(signal: SignalBody) {
  if (typeof window === "undefined") return
  if (STATE_KINDS.has(signal.kind) && !getServerSessionState().shopper) return
  const body = JSON.stringify(signal)
  try {
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/signals", new Blob([body], { type: "text/plain" }))) return
  } catch {
    /* fall through to fetch */
  }
  void fetch("/api/signals", { method: "POST", body, keepalive: true, credentials: "same-origin", headers: { "Content-Type": "text/plain" } }).catch(() => {})
}
