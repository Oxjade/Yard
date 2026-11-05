"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { adminRoles } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { formatDateTime, relTime } from "../format"
import { ReasonDialog, type ReasonAction } from "../reason-dialog"
import { Initials, PlatformTable, type Column } from "../table"
import { memberById, REVOKE_ACTION, useSecurityState } from "./derive"
import { adminSessions, CURRENT_SESSION_ID, type AdminSession } from "./sample"

/** Active admin sessions. Revoking one signs that device out at once and is audited. */
export function Sessions() {
  const log = useAdmin((s) => s.log)
  const { revoked } = useSecurityState()
  const [target, setTarget] = useState<AdminSession | null>(null)
  const [open, setOpen] = useState(false)

  const rows = [...adminSessions].sort((a, b) => Number(revoked.has(a.id)) - Number(revoked.has(b.id)) || Number(!!b.flag) - Number(!!a.flag) || b.lastActiveAt.localeCompare(a.lastActiveAt))
  const name = (s: AdminSession) => memberById.get(s.memberId)?.name ?? "Unknown"

  const action: ReasonAction | null = target
    ? {
        title: `Revoke ${name(target)}'s session`,
        body: `${target.device} in ${target.location} is signed out straight away. ${name(target).split(" ")[0]}'s other sessions keep working.`,
        confirmLabel: "Revoke session",
        tone: "destructive",
        presets: target.flag ? ["Unrecognised location", "Member confirmed it wasn't them"] : ["Device lost or replaced", "Member left the team", "Unrecognised location"],
        facts: [
          { label: "Device", value: `${target.device}, ${target.browser}` },
          { label: "Location", value: target.location },
          { label: "Signed in", value: formatDateTime(target.signedInAt) },
          { label: "IP address", value: target.ip },
        ],
        warning: target.flag,
      }
    : null

  async function confirm(reason: string) {
    if (!target) return
    log(REVOKE_ACTION, `${name(target)}, ${target.device} in ${target.location} (${target.id})`, reason)
    toast("Session marked revoked", { description: `${name(target)} is signed out on ${target.device} once the auth service is connected. Logged in the audit trail.` })
  }

  const status = (s: AdminSession) =>
    revoked.has(s.id) ? (
      <StatusBadge tone="muted">Revoke pending</StatusBadge>
    ) : s.id === CURRENT_SESSION_ID ? (
      <StatusBadge tone="info">This session</StatusBadge>
    ) : s.flag ? (
      <StatusBadge tone="attention">Check this</StatusBadge>
    ) : (
      <StatusBadge tone="success">Active</StatusBadge>
    )

  const act = (s: AdminSession) =>
    revoked.has(s.id) ? null : s.id === CURRENT_SESSION_ID ? (
      <span className="text-[11px] whitespace-nowrap text-ink-3">Sign out to end</span>
    ) : (
      <Button
        size="xs"
        variant="secondary"
        onClick={() => {
          setTarget(s)
          setOpen(true)
        }}
        aria-label={`Revoke ${name(s)}'s session on ${s.device}`}
      >
        Revoke
      </Button>
    )

  const columns: Column<AdminSession>[] = [
    {
      key: "member",
      header: "Member",
      cell: (s) => {
        const m = memberById.get(s.memberId)
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <Initials name={name(s)} />
            <span className="min-w-0">
              <span className="block truncate text-ink">{name(s)}</span>
              <span className="block truncate text-[11px] text-ink-3">{m ? adminRoles[m.role].name : ""}</span>
            </span>
          </span>
        )
      },
    },
    {
      key: "device",
      header: "Device",
      cell: (s) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink-2">{s.device}</span>
          <span className="block text-[11px] text-ink-3">{s.browser}</span>
        </span>
      ),
    },
    {
      key: "where",
      header: "Location",
      cell: (s) => (
        <span className="block max-w-[240px]">
          <span className="block whitespace-nowrap text-ink-2">{s.location}</span>
          <span className={cn("block text-[11px]", s.flag && !revoked.has(s.id) ? "text-acid" : "text-ink-3")}>{s.flag && !revoked.has(s.id) ? s.flag : s.ip}</span>
        </span>
      ),
    },
    { key: "signed", header: "Signed in", cell: (s) => <span className="whitespace-nowrap text-ink-2 tabular">{formatDateTime(s.signedInAt)}</span> },
    { key: "last", header: "Last active", cell: (s) => <span className="whitespace-nowrap text-ink-2">{relTime(s.lastActiveAt)}</span> },
    { key: "status", header: "Status", cell: status },
    { key: "act", header: "", align: "right", className: "w-[1%]", cell: act },
  ]

  return (
    <div>
      <p className="px-4 py-3 text-[12px] text-ink-2">
        {adminSessions.length - revoked.size} active admin sessions. Sessions expire after 12 hours idle; revoke one when a device is lost or a sign-in looks wrong.
      </p>
      <PlatformTable
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        caption="Active admin sessions"
        minWidth={960}
        rowClassName={(s) => revoked.has(s.id) && "opacity-55"}
        mobileRow={(s) => ({
          lead: <Initials name={name(s)} />,
          title: name(s),
          meta: `${s.device}, ${s.location}, ${relTime(s.lastActiveAt).toLowerCase()}`,
          trail: status(s),
          below: (
            <div className="flex items-center justify-between gap-3 pl-10">
              <span className={cn("min-w-0 text-[11px]", s.flag && !revoked.has(s.id) ? "text-acid" : "text-ink-3")}>{s.flag && !revoked.has(s.id) ? s.flag : `${s.browser}, ${s.ip}`}</span>
              {act(s)}
            </div>
          ),
        })}
      />
      <ReasonDialog action={action} open={open} onOpenChange={setOpen} onConfirm={confirm} />
    </div>
  )
}
