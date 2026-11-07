"use client"

import { useState } from "react"
import { WarningIcon as AlertTriangle, CheckIcon as Check, FingerprintIcon, MinusIcon as Minus, SignOutIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { ReasonDialog } from "@/components/admin/ui/reason-dialog"
import { useNow } from "@/hooks/use-now"
import { adminRoles, adminTeam, adminUser, type AdminRole } from "@/lib/data/admin"
import { ADMIN_PERMISSIONS, adminPermissionLabels, adminRolePermissions } from "@/lib/permissions"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { relTime } from "../format"
import { useDialogReturn } from "../ready"
import { type TeamMember } from "./derive"
import { Initials } from "./initials"
import { adminSessions, CURRENT_SESSION_ID, type AdminSession } from "./sample"

const roles = Object.keys(adminRoles) as AdminRole[]
/**
 * The matrix keeps the legacy pages' descriptive rows (adminRoles[*].can) and adds the v2 server
 * permissions, generated from adminRolePermissions through adminPermissionLabels at module load
 * (§2.4), so the server's table and this one can't drift.
 */
const v2Rows = (r: AdminRole) => adminRolePermissions[r].map((p) => adminPermissionLabels[p])
const legacyPermissions = [...new Set(roles.flatMap((r) => adminRoles[r].can).filter((p) => p !== "everything"))]
const serverPermissions = ADMIN_PERMISSIONS.map((p) => adminPermissionLabels[p]).filter((label) => !legacyPermissions.includes(label))
const permissions = [...legacyPermissions, ...serverPermissions]
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const can = (r: AdminRole, p: string) => adminRoles[r].can.includes("everything") || adminRoles[r].can.includes(p) || v2Rows(r).includes(p)

/** The admin team, each member's MFA status, and what every role is allowed to do. */
export function TeamRoles({ ready, revoked, mfaRequired, onRevoke }: { ready: boolean; revoked: Set<string>; mfaRequired: Set<string>; onRevoke: (sessions: AdminSession[], opts: { announce: boolean }) => void }) {
  const requireMfa = useAdmin((s) => s.requireMfa)
  // Counted from the same today as every other Control Center page.
  const now = useNow(60_000)
  const [target, setTarget] = useState<TeamMember | null>(null)
  const [open, setOpen] = useState(false)
  // The Require MFA button goes away once MFA is required; focus then moves to the tab.
  const focus = useDialogReturn("#security-sections [role=tab][aria-selected=true]")
  const withoutMfa = adminTeam.filter((m) => !m.mfa && !mfaRequired.has(m.id))

  const openSessions = (m: TeamMember) => adminSessions.filter((x) => x.memberId === m.id && !revoked.has(x.id) && x.id !== CURRENT_SESSION_ID)
  const pendingSessions = (m: TeamMember) => adminSessions.filter((x) => x.memberId === m.id && revoked.has(x.id)).length
  const lastActive = (m: TeamMember) => {
    // Revoked sessions count until the auth service has actually signed them out.
    const s = adminSessions.filter((x) => x.memberId === m.id).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0]
    if (!s) return "Not signed in"
    return s.id === CURRENT_SESSION_ID ? "Active now" : relTime(s.lastActiveAt, now)
  }

  function ask(m: TeamMember) {
    setTarget(m)
    focus.openFrom(() => setOpen(true))
  }

  const mfaBadge = (m: TeamMember) =>
    m.mfa ? <StatusBadge tone="muted">MFA on</StatusBadge> : mfaRequired.has(m.id) ? <StatusBadge tone="info">Set-up required</StatusBadge> : <StatusBadge tone="danger">MFA off</StatusBadge>

  // Actions sit beside what they change, and only on the members they apply to: no menu of
  // items that are greyed out for most of the team.
  const requireButton = (m: TeamMember) =>
    !m.mfa && !mfaRequired.has(m.id) ? (
      <Button size="sm" variant="secondary" className="h-10 sm:h-7 sm:px-2.5 sm:text-[12px]" onClick={() => ask(m)} aria-label={`Require MFA for ${m.name}`}>
        <FingerprintIcon aria-hidden /> Require MFA
      </Button>
    ) : null

  const sessionsCell = (m: TeamMember) => {
    const open = openSessions(m)
    const pending = pendingSessions(m)
    const own = m.id === adminUser.id
    const summary = [open.length ? `${open.length} signed in` : null, pending ? `${pending} revoke${pending === 1 ? "" : "s"} pending` : null].filter(Boolean).join(", ")
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-[12px] whitespace-nowrap text-ink-2">{summary || (own ? "This session only" : "Not signed in")}</span>
        {open.length ? (
          <Button size="sm" variant="destructive" data-revoke className="h-10 sm:h-7 sm:px-2.5 sm:text-[12px]" onClick={() => onRevoke(open, { announce: true })} aria-label={`Revoke ${m.name}'s ${open.length === 1 ? "session" : `${open.length} sessions`}`}>
            <SignOutIcon aria-hidden /> Revoke
          </Button>
        ) : null}
      </span>
    )
  }

  const columns: Column<TeamMember>[] = [
    {
      key: "member",
      header: "Member",
      sortValue: (m) => m.name,
      cell: (m) => (
        <span className="flex min-w-0 max-w-[56vw] items-center gap-2.5 md:max-w-none">
          <Initials name={m.name} />
          <span className="min-w-0">
            <span className="block truncate text-ink">
              {m.name}
              {m.id === adminUser.id ? <span className="text-ink-3"> (you)</span> : null}
            </span>
            <span className="block truncate text-[11px] text-ink-3">
              <span className="md:hidden">{adminRoles[m.role].name}, </span>
              {m.email}
            </span>
            {/* Phones: the MFA status and sessions, with their actions, fold in under the name. */}
            <span className="mt-1.5 flex flex-wrap items-center gap-2 sm:hidden">
              {mfaBadge(m)}
              {requireButton(m)}
            </span>
            <span className="mt-2 block sm:hidden">{sessionsCell(m)}</span>
          </span>
        </span>
      ),
    },
    { key: "role", header: "Role", hideBelow: "md", sortValue: (m) => adminRoles[m.role].name, cell: (m) => <span className="whitespace-nowrap text-ink-2">{adminRoles[m.role].name}</span> },
    {
      key: "mfa",
      header: "MFA",
      hideBelow: "sm",
      sortValue: (m) => (m.mfa ? 2 : mfaRequired.has(m.id) ? 1 : 0),
      cell: (m) => (
        <span className="flex flex-wrap items-center gap-2">
          {mfaBadge(m)}
          {requireButton(m)}
        </span>
      ),
    },
    { key: "sessions", header: "Sessions", hideBelow: "sm", sortValue: (m) => openSessions(m).length, cell: sessionsCell },
    { key: "active", header: "Last active", hideBelow: "md", cell: (m) => <span className="whitespace-nowrap text-ink-2">{lastActive(m)}</span> },
  ]

  return (
    <div className="grid min-w-0 gap-4">
      {ready && withoutMfa.length ? (
        <div className="flex flex-col gap-3 rounded-[10px] border border-acid/25 bg-acid/5 p-3 sm:flex-row sm:items-center">
          <AlertTriangle className="hidden size-4 shrink-0 text-acid sm:block" aria-hidden />
          <p className="min-w-0 flex-1 text-[12.5px] text-ink">
            {withoutMfa.map((m) => m.name).join(", ")} {withoutMfa.length === 1 ? "signs" : "sign"} in without MFA.{" "}
            <span className="text-ink-2">
              {withoutMfa.length === 1 ? `${adminRoles[withoutMfa[0].role].name} can ${adminRoles[withoutMfa[0].role].can.slice(0, 2).join(" and ")}, so a stolen password is enough to act.` : "A stolen password is enough to act on their behalf."}
            </span>
          </p>
          {withoutMfa.length === 1 ? (
            <Button size="sm" variant="primary" onClick={() => ask(withoutMfa[0])} className="h-10 self-start sm:h-8 sm:self-auto">
              <FingerprintIcon aria-hidden /> Require MFA
            </Button>
          ) : null}
        </div>
      ) : null}

      <DataTable
        label="Admin team"
        rows={ready ? adminTeam : []}
        loading={!ready}
        columns={columns}
        getId={(m) => m.id}
        density="dense"
        minWidth={0}
        empty={{ title: "No team members" }}
      />

      <div className="min-w-0">
        <h3 className="font-label text-[13px] text-ink">What each role can do</h3>
        <p className="mt-1 text-[12px] text-ink-2">Owners can do everything. Everyone else gets only what their role needs.</p>

        <div className="admin-inset mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <caption className="sr-only">Role permissions</caption>
            <thead className="text-[11px] text-ink-3 shadow-[0_1px_0_var(--admin-hairline)]">
              <tr>
                <th scope="col" className="px-3 py-2.5 pl-4 font-normal">Permission</th>
                {roles.map((r) => {
                  const n = adminTeam.filter((m) => m.role === r).length
                  return (
                    <th key={r} scope="col" className="px-3 py-2.5 text-center font-normal last:pr-4">
                      <span className="block whitespace-nowrap text-ink-2">{adminRoles[r].name}</span>
                      <span className="block">{n} {n === 1 ? "person" : "people"}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="admin-divide">
              {permissions.map((p) => (
                <tr key={p} className="transition-colors duration-150 hover:bg-white/[0.02]">
                  <th scope="row" className="px-3 py-2.5 pl-4 font-normal whitespace-nowrap text-ink">{capitalise(p)}</th>
                  {roles.map((r) => (
                    <td key={r} className="px-3 py-2.5 text-center last:pr-4">
                      {can(r, p) ? <Check className={cn("mx-auto size-4", r === "owner" ? "text-ink-3" : "text-violet")} aria-label="Allowed" /> : <Minus className="mx-auto size-3.5 text-ink-3/50" aria-label="Not allowed" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-3 grid gap-2 md:hidden">
          {roles.map((r) => (
            <li key={r} className="admin-inset p-3">
              <p className="text-[13px] text-ink">
                {adminRoles[r].name} <span className="text-ink-3">({adminTeam.filter((m) => m.role === r).map((m) => m.name.split(" ")[0]).join(", ") || "nobody"})</span>
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {(adminRoles[r].can.includes("everything") ? ["Everything"] : [...new Set([...adminRoles[r].can, ...v2Rows(r)])].map(capitalise)).map((p) => (
                  <li key={p} className="inline-flex h-6 items-center rounded-full border border-[var(--admin-hairline-strong)] px-2.5 text-[11px] text-ink-2">{p}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <ReasonDialog
        key={target?.id ?? "none"}
        open={open}
        onOpenChange={setOpen}
        title={target ? `Require MFA for ${target.name}` : "Require MFA"}
        description={
          target
            ? `${target.name.split(" ")[0]} (${adminRoles[target.role].name.toLowerCase()}) has to set up an authenticator app at the next sign-in and can't approve or change anything until then. It's recorded now and enforced once the auth service is connected. To end their open sessions as well, revoke them from the row menu.`
            : ""
        }
        confirmLabel="Require MFA"
        onCloseAutoFocus={focus.onCloseAutoFocus}
        onConfirm={(reason) => {
          if (target) requireMfa(target.id, `${target.name} (${adminRoles[target.role].name.toLowerCase()})`, reason)
        }}
      />
    </div>
  )
}
