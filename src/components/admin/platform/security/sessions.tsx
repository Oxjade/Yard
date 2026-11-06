"use client"

import { useMemo } from "react"
import { SignOutIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type BulkAction, type Column } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { adminRoles } from "@/lib/data/admin"
import { cn } from "@/lib/utils"
import { formatDateTime, relTime } from "../format"
import { memberById } from "./derive"
import { Initials } from "./initials"
import { adminSessions, CURRENT_SESSION_ID, type AdminSession } from "./sample"

const nameOf = (s: AdminSession) => memberById.get(s.memberId)?.name ?? "Unknown member"

/** Active admin sessions. A revoke is reasoned, recorded and shown as pending until the auth service signs the device out. */
export function Sessions({ ready, revoked, onRevoke }: { ready: boolean; revoked: Set<string>; onRevoke: (sessions: AdminSession[]) => void }) {
  // Flagged first, then most recent; revoked ones sink to the bottom.
  const rows = useMemo(
    () => [...adminSessions].sort((a, b) => Number(revoked.has(a.id)) - Number(revoked.has(b.id)) || Number(!!b.flag) - Number(!!a.flag) || b.lastActiveAt.localeCompare(a.lastActiveAt)),
    [revoked],
  )
  // A pending revoke is still signed in until the auth service ends it, so it still counts.
  const signedIn = adminSessions.length
  const pending = adminSessions.filter((s) => revoked.has(s.id)).length
  const flagged = adminSessions.filter((s) => s.flag && !revoked.has(s.id))
  const revocable = (s: AdminSession) => s.id !== CURRENT_SESSION_ID && !revoked.has(s.id)

  const status = (s: AdminSession) =>
    revoked.has(s.id) ? (
      <StatusBadge tone="muted">Revoke pending</StatusBadge>
    ) : s.id === CURRENT_SESSION_ID ? (
      <StatusBadge tone="info">This session</StatusBadge>
    ) : s.flag ? (
      <StatusBadge tone="attention">Check this</StatusBadge>
    ) : (
      <StatusBadge tone="muted">Active</StatusBadge>
    )

  const columns: Column<AdminSession>[] = [
    {
      key: "member",
      header: "Member",
      sortValue: (s) => nameOf(s),
      cell: (s) => {
        const m = memberById.get(s.memberId)
        const off = revoked.has(s.id)
        return (
          <span className={cn("flex min-w-0 max-w-[46vw] items-center gap-2.5 sm:max-w-[280px]", off && "opacity-60")}>
            <Initials name={nameOf(s)} />
            <span className="min-w-0">
              <span className="block truncate text-ink">{nameOf(s)}</span>
              {/* Below xl the device and place fold in here; wider, they have their own columns. */}
              <span className="block truncate text-[11px] text-ink-3 xl:hidden">
                {s.device}, {s.location}
              </span>
              <span className="hidden truncate text-[11px] text-ink-3 xl:block">{m ? adminRoles[m.role].name : ""}</span>
              {/* The reason a session needs a check, in full: it's what the revoke decision rests on. */}
              {s.flag && !off ? <span className="block text-[11px] leading-snug text-acid xl:hidden">{s.flag}</span> : null}
              <span className="mt-1.5 block sm:hidden">{status(s)}</span>
            </span>
          </span>
        )
      },
    },
    {
      key: "device",
      header: "Device",
      className: "hidden xl:table-cell",
      sortValue: (s) => s.device,
      cell: (s) => (
        <span className={cn("block whitespace-nowrap", revoked.has(s.id) && "opacity-60")}>
          <span className="block text-ink-2">{s.device}</span>
          <span className="block text-[11px] text-ink-3">{s.browser}</span>
        </span>
      ),
    },
    {
      key: "where",
      header: "Location",
      className: "hidden xl:table-cell",
      sortValue: (s) => s.location,
      cell: (s) => (
        <span className={cn("block max-w-[240px]", revoked.has(s.id) && "opacity-60")}>
          <span className="block whitespace-nowrap text-ink-2">{s.location}</span>
          <span className={cn("block text-[11px]", s.flag && !revoked.has(s.id) ? "text-acid" : "text-ink-3")}>{s.flag && !revoked.has(s.id) ? s.flag : s.ip}</span>
        </span>
      ),
    },
    { key: "signed", header: "Signed in", className: "hidden min-[1400px]:table-cell", sortValue: (s) => s.signedInAt, cell: (s) => <span className="whitespace-nowrap text-ink-2 tabular">{formatDateTime(s.signedInAt)}</span> },
    { key: "last", header: "Last active", hideBelow: "sm", sortValue: (s) => s.lastActiveAt, cell: (s) => <span className="whitespace-nowrap text-ink-2">{relTime(s.lastActiveAt)}</span> },
    { key: "status", header: "Status", hideBelow: "sm", cell: status },
    {
      // Inline rather than in a row menu: only revocable sessions get the button, and the others say why not.
      key: "action",
      header: "Action",
      align: "right",
      cell: (s) =>
        revocable(s) ? (
          <Button size="sm" variant="destructive" data-revoke className="h-10 sm:h-8" onClick={() => onRevoke([s])} aria-label={`Revoke ${nameOf(s)}'s session on ${s.device}`}>
            <SignOutIcon aria-hidden />
            Revoke
          </Button>
        ) : (
          <span className="block text-[11px] leading-snug text-ink-3">{s.id === CURRENT_SESSION_ID ? "Sign out to end it" : "Recorded"}</span>
        ),
    },
  ]

  // The dialog says which selected sessions it leaves out (yours, and ones already pending).
  const bulk: BulkAction<AdminSession>[] = [{ label: "Revoke selected", destructive: true, onSelect: (list) => onRevoke(list) }]

  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-ink-2">
        {ready ? `${signedIn} active admin ${signedIn === 1 ? "session" : "sessions"}${pending ? `, ${pending} with a revoke pending until the auth service is connected` : ""}${flagged.length ? `, ${flagged.length} flagged for a check` : ""}. ` : ""}
        Sessions expire after 12 hours idle. Revoke one when a device is lost or a sign-in looks wrong; your own session ends when you sign out.
      </p>
      <DataTable
        label="Active admin sessions"
        rows={ready ? rows : []}
        loading={!ready}
        columns={columns}
        getId={(s) => s.id}
        bulkActions={bulk}
        density="dense"
        minWidth={0}
        search={{ placeholder: "Search by member, device or place", text: (s) => `${nameOf(s)} ${s.device} ${s.browser} ${s.location} ${s.ip}` }}
        empty={{ title: "No active sessions", body: "Every admin is signed out." }}
      />
    </div>
  )
}
