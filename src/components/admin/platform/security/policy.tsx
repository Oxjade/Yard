"use client"

import { CheckIcon as Check, MinusIcon as Minus } from "@phosphor-icons/react"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { adminRoles, type AdminRole } from "@/lib/data/admin"
import { sensitivePolicy, type Policy } from "./sample"

const roles = Object.keys(adminRoles) as AdminRole[]

function whoCan(p: Policy) {
  const list = p.permission ? roles.filter((r) => r !== "owner" && adminRoles[r].can.includes(p.permission!)).map((r) => adminRoles[r].name) : []
  return [...list, "Owner"]
}

function Chips({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((x) => (
        <span key={x} className="inline-flex h-6 items-center rounded-full border border-[var(--admin-hairline-strong)] px-2.5 text-[11px] whitespace-nowrap text-ink-2">{x}</span>
      ))}
    </span>
  )
}

function Yes({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-start gap-1.5 text-ink">
      <Check className="mt-0.5 size-3.5 shrink-0 text-violet" aria-hidden />
      <span>{children}</span>
    </span>
  )
}

function No({ children = "Not needed" }: { children?: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-ink-3">
      <Minus className="size-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  )
}

/** Which Control Center actions need a reason, which need a second approver, and who can take them. */
export function PolicyTable() {
  const reasons = sensitivePolicy.filter((p) => p.reason).length
  const approvals = sensitivePolicy.filter((p) => p.approver).length

  const columns: Column<Policy>[] = [
    {
      key: "action",
      header: "Action",
      sortValue: (p) => p.action,
      cell: (p) => (
        <span className="block max-w-[46vw] md:max-w-[300px]">
          <span className="block text-ink">{p.action}</span>
          {p.note ? <span className="block text-[11px] text-ink-3">{p.note}</span> : null}
          <span className="mt-1.5 block md:hidden">
            <Chips items={whoCan(p)} />
          </span>
        </span>
      ),
    },
    { key: "who", header: "Who can do it", hideBelow: "md", cell: (p) => <Chips items={whoCan(p)} /> },
    { key: "reason", header: "Reason", hideBelow: "sm", sortValue: (p) => Number(p.reason), cell: (p) => (p.reason ? <Yes>Required</Yes> : <No />) },
    { key: "approver", header: "Second approver", sortValue: (p) => Number(!!p.approver), cell: (p) => (p.approver ? <Yes>{p.approver}</Yes> : <No />) },
  ]

  return (
    <div className="grid gap-3">
      <p className="text-[12px] text-ink-2">
        {reasons} of {sensitivePolicy.length} actions need a written reason and {approvals} need a second admin. Reasons and approvers are saved with each audit entry.
      </p>
      <DataTable
        label="Sensitive-action policy"
        rows={sensitivePolicy}
        columns={columns}
        getId={(p) => p.action}
        density="dense"
        minWidth={0}
        pageSizes={[25, 50]}
        initialPageSize={25}
        search={{ placeholder: "Search actions", text: (p) => `${p.action} ${p.note ?? ""} ${whoCan(p).join(" ")} ${p.approver ?? ""}` }}
      />
    </div>
  )
}
