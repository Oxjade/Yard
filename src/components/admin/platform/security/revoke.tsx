"use client"

import { useState } from "react"
import { toast } from "sonner"
import { ReasonDialog } from "@/components/admin/ui/reason-dialog"
import { useAdmin } from "@/lib/stores/admin"
import { formatDateTime } from "../format"
import { useDialogReturn } from "../ready"
import { memberById, useSecurityState } from "./derive"
import { CURRENT_SESSION_ID, type AdminSession } from "./sample"

const nameOf = (s: AdminSession) => memberById.get(s.memberId)?.name ?? "Unknown member"
const first = (s: AdminSession) => nameOf(s).split(" ")[0]

/**
 * Revoking sessions, one or several, behind a reasoned confirmation. Each revoke is recorded
 * through the store (status "Revoke pending") and takes effect once the auth service is
 * connected; this session can't be revoked from here, only signed out.
 */
export function useRevoke() {
  const revokeSession = useAdmin((s) => s.revokeSession)
  const { revoked } = useSecurityState()
  const [target, setTarget] = useState<{ sessions: AdminSession[]; announce: boolean; skipped: string | null } | null>(null)
  const [open, setOpen] = useState(false)
  // The Revoke button goes once the revoke is recorded; focus moves on to the next one, or the tab.
  const focus = useDialogReturn(["[data-revoke]:not([disabled])", "#security-sections [role=tab][aria-selected=true]"])

  /** Your own session and ones already pending are left out, and the dialog says so. */
  function ask(sessions: AdminSession[], { announce = false }: { announce?: boolean } = {}) {
    const own = sessions.some((s) => s.id === CURRENT_SESSION_ID)
    const pending = sessions.filter((s) => s.id !== CURRENT_SESSION_ID && revoked.has(s.id)).length
    const list = sessions.filter((s) => s.id !== CURRENT_SESSION_ID && !revoked.has(s.id))
    const ownNote = own ? "Your own session ends when you sign out." : null
    const pendingNote = pending ? (pending === 1 ? "1 already has a revoke pending." : `${pending} already have a revoke pending.`) : null
    if (!list.length) {
      toast.info("Nothing to revoke", { description: [ownNote, pendingNote].filter(Boolean).join(" ") || undefined })
      return
    }
    const skipped = own && pending ? `Your session and ${pending} already pending are skipped.` : own ? "Your session is skipped: it ends when you sign out." : pending ? `${pending} already pending ${pending === 1 ? "is" : "are"} skipped.` : null
    setTarget({ sessions: list, announce, skipped })
    focus.openFrom(() => setOpen(true))
  }

  const list = target?.sessions ?? []
  const one = list.length === 1 ? list[0] : null
  const people = [...new Set(list.map(nameOf))]
  const title = one ? `Revoke ${nameOf(one)}'s session on ${one.device}` : `Revoke ${list.length} sessions`
  const description = one
    ? `${one.device}, ${one.browser}, in ${one.location}, signed in ${formatDateTime(one.signedInAt)}.${one.flag ? ` Flagged: ${one.flag.charAt(0).toLowerCase()}${one.flag.slice(1)}.` : ""} ${first(one)}'s other sessions keep working. The revoke is recorded now and signs the device out once the auth service is connected.`
    : `${people.join(", ")}: ${list.map((s) => `${s.device} in ${s.location}`).join("; ")}. The revokes are recorded now and sign the devices out once the auth service is connected.`
  const fullDescription = target?.skipped ? `${description} ${target.skipped}` : description

  function confirm(reason: string) {
    for (const s of list) revokeSession(s.id, `${nameOf(s)}, ${s.device} in ${s.location} (${s.id})`, reason)
    if (target?.announce) toast(list.length === 1 ? "Revoke recorded" : `${list.length} revokes recorded`, { description: `Shown as revoke pending under Sessions. ${people.join(", ")} ${people.length === 1 ? "is" : "are"} signed out once the auth service is connected.` })
  }

  const dialog = (
    <ReasonDialog
      key={list.map((s) => s.id).join(",") || "none"}
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={fullDescription}
      confirmLabel={one ? "Revoke session" : `Revoke ${list.length} sessions`}
      destructive
      onConfirm={confirm}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    />
  )

  return { ask, dialog }
}
