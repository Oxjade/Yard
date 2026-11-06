"use client"

import { durationLabels } from "@/lib/api/contracts/admin"
import type { ServerDecision } from "./shared"

export type Duration = keyof typeof durationLabels
export const DURATIONS: Duration[] = ["24h", "7d", "30d"]
const what = { messaging: "messaging", uploads: "uploads", reports: "reporting" } as const

/**
 * add-restriction for one account or brand (§8.1). The reason is shared with them in their
 * notification, so the field says so. `alertId` confirms the abuse alert it came from.
 */
export function restrictDecision(
  subject: { kind: "user" | "brand"; id: string; name: string },
  duration: Duration,
  opts: { kind?: "messaging" | "uploads" | "reports"; alertId?: string; onDone?: ServerDecision<"add-restriction">["onDone"] } = {},
): ServerDecision<"add-restriction"> {
  const kind = opts.kind ?? "messaging"
  const length = durationLabels[duration]
  return {
    action: "add-restriction",
    body: { id: subject.id, subjectKind: subject.kind, kind, duration, ...(opts.alertId ? { alertId: opts.alertId } : {}) },
    title: `Pause ${what[kind]} for ${subject.name}?`,
    description: [
      kind === "messaging"
        ? `${subject.name} can read their conversations but can't send messages, attachments or reactions for ${length}.`
        : kind === "uploads"
          ? `${subject.name} can't upload files for ${length}.`
          : `${subject.name} can't send reports for ${length}.`,
      opts.alertId ? "This confirms the abuse alert, which ends its shadow hold." : null,
      `${subject.name} is notified and sees your reason.`,
    ]
      .filter(Boolean)
      .join(" "),
    fieldLabel: `Reason, shown to ${subject.name}`,
    confirmLabel: `Pause for ${length}`,
    destructive: true,
    presets: kind === "messaging" ? ["Asked for payment outside Yard", "Sent spam to several brands", "Harassment in messages"] : undefined,
    done: `${what[kind].charAt(0).toUpperCase()}${what[kind].slice(1)} paused for ${length}`,
    onDone: opts.onDone,
  }
}
