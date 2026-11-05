"use client"

import { useState } from "react"
import { toast } from "sonner"
import { WarningIcon as AlertTriangle, CheckIcon as Check, MinusIcon as Minus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { adminRoles, adminTeam, adminUser, type AdminRole } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { relTime } from "../format"
import { ReasonDialog, type ReasonAction } from "../reason-dialog"
import { Initials, PlatformTable, type Column } from "../table"
import { MFA_ACTION, useSecurityState, type TeamMember } from "./derive"
import { adminSessions } from "./sample"

const roles = Object.keys(adminRoles) as AdminRole[]
const permissions = [...new Set(roles.flatMap((r) => adminRoles[r].can).filter((p) => p !== "everything"))]
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const can = (r: AdminRole, p: string) => adminRoles[r].can.includes("everything") || adminRoles[r].can.includes(p)

/** The admin team, each member's MFA status, and what every role is allowed to do. */
export function TeamRoles() {
  const log = useAdmin((s) => s.log)
  const { revoked, mfaRequired } = useSecurityState()
  const [target, setTarget] = useState<TeamMember | null>(null)
  const [open, setOpen] = useState(false)
  const withoutMfa = adminTeam.filter((m) => !m.mfa && !mfaRequired.has(m.id))

  function ask(m: TeamMember) {
    setTarget(m)
    setOpen(true)
  }

  const action: ReasonAction | null = target
    ? {
        title: `Require MFA for ${target.name}`,
        body: `${target.name.split(" ")[0]} has to set up an authenticator app at the next sign-in, and can't approve or change anything until then. To make it take effect now, also revoke their open sessions.`,
        confirmLabel: "Require MFA",
        tone: "primary",
        presets: ["Policy: every admin account needs MFA", "Sign-in from a new country without MFA"],
        facts: [
          { label: "Member", value: target.name },
          { label: "Role", value: adminRoles[target.role].name },
        ],
      }
    : null

  async function confirm(reason: string) {
    if (!target) return
    log(MFA_ACTION, `${target.name} (${adminRoles[target.role].name.toLowerCase()})`, reason)
    toast(`MFA marked as required for ${target.name}`, { description: "It's enforced at their next sign-in once the auth service is connected. Logged in the audit trail." })
  }

  const lastActive = (m: TeamMember) => {
    const s = adminSessions.filter((x) => x.memberId === m.id && !revoked.has(x.id)).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))[0]
    return s ? relTime(s.lastActiveAt) : "Not signed in"
  }

  const mfaBadge = (m: TeamMember) =>
    m.mfa ? <StatusBadge tone="success">MFA on</StatusBadge> : mfaRequired.has(m.id) ? <StatusBadge tone="info">Set-up required</StatusBadge> : <StatusBadge tone="danger">MFA off</StatusBadge>

  const columns: Column<TeamMember>[] = [
    {
      key: "member",
      header: "Member",
      cell: (m) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Initials name={m.name} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              {m.name}
              {m.id === adminUser.id ? <span className="font-normal text-ink-3"> (you)</span> : null}
            </span>
            <span className="block truncate text-[11px] text-ink-3">{m.email}</span>
          </span>
        </span>
      ),
    },
    { key: "role", header: "Role", cell: (m) => <span className="whitespace-nowrap text-ink-2">{adminRoles[m.role].name}</span> },
    { key: "mfa", header: "MFA", cell: mfaBadge },
    { key: "active", header: "Last active", cell: (m) => <span className="whitespace-nowrap text-ink-2">{lastActive(m)}</span> },
    {
      key: "act",
      header: "",
      align: "right",
      className: "w-[1%]",
      cell: (m) =>
        !m.mfa && !mfaRequired.has(m.id) && withoutMfa.length > 1 ? (
          <Button size="xs" variant="secondary" onClick={() => ask(m)}>Require MFA</Button>
        ) : null,
    },
  ]

  return (
    <div>
      {withoutMfa.length ? (
        <div className="mx-4 mt-3 flex flex-col gap-3 rounded-md border border-acid/25 bg-acid/5 p-3 sm:flex-row sm:items-center">
          <AlertTriangle className="hidden size-4 shrink-0 text-acid sm:block" aria-hidden />
          <p className="min-w-0 flex-1 text-[12px] text-ink">
            {withoutMfa.map((m) => m.name).join(", ")} {withoutMfa.length === 1 ? "signs" : "sign"} in without MFA.{" "}
            <span className="text-ink-2">
              {withoutMfa.length === 1 ? `${adminRoles[withoutMfa[0].role].name} can ${adminRoles[withoutMfa[0].role].can.slice(0, 2).join(" and ")}, so a stolen password is enough to act.` : "A stolen password is enough to act on their behalf."}
            </span>
          </p>
          {withoutMfa.length === 1 ? (
            <Button size="sm" variant="primary" onClick={() => ask(withoutMfa[0])} className="self-start sm:self-auto">Require MFA</Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3">
        <PlatformTable
          rows={adminTeam}
          columns={columns}
          rowKey={(m) => m.id}
          caption="Admin team"
          minWidth={760}
          mobileRow={(m) => ({
            lead: <Initials name={m.name} />,
            title: m.name,
            meta: `${adminRoles[m.role].name}, ${lastActive(m).toLowerCase()}`,
            trail: mfaBadge(m),
            below:
              !m.mfa && !mfaRequired.has(m.id) && withoutMfa.length > 1 ? (
                <Button size="xs" variant="secondary" onClick={() => ask(m)} className="ml-10">Require MFA</Button>
              ) : undefined,
          })}
        />
      </div>

      <div className="border-t border-line-soft px-4 pt-4 pb-4">
        <h3 className="text-[13px] font-medium text-ink">What each role can do</h3>
        <p className="mt-0.5 text-[11px] text-ink-2">Owners can do everything. Everyone else gets only what their role needs.</p>

        <div className="mt-3 hidden overflow-x-auto rounded-md border border-line-soft md:block">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <caption className="sr-only">Role permissions</caption>
            <thead className="border-b border-line-soft bg-surface/60 text-[11px] text-ink-3">
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
            <tbody className="divide-y divide-line-soft">
              {permissions.map((p) => (
                <tr key={p} className="hover:bg-white/[0.02]">
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
            <li key={r} className="rounded-md border border-line-soft bg-surface/50 p-3">
              <p className="text-[13px] font-medium text-ink">
                {adminRoles[r].name} <span className="font-normal text-ink-3">({adminTeam.filter((m) => m.role === r).map((m) => m.name.split(" ")[0]).join(", ") || "nobody"})</span>
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {(adminRoles[r].can.includes("everything") ? ["Everything"] : adminRoles[r].can.map(capitalise)).map((p) => (
                  <li key={p} className="inline-flex h-6 items-center rounded-[5px] border border-line px-2 text-[11px] text-ink-2">{p}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <ReasonDialog action={action} open={open} onOpenChange={setOpen} onConfirm={confirm} />
    </div>
  )
}
