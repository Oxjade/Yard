import { CheckIcon as Check, MinusIcon as Minus } from "@phosphor-icons/react/ssr"
import { adminRoles, type AdminRole } from "@/lib/data/admin"
import { PlatformTable, type Column } from "../table"
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
        <span key={x} className="inline-flex h-6 items-center rounded-[5px] border border-line px-2 text-[11px] whitespace-nowrap text-ink-2">{x}</span>
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
    <span className="flex items-center gap-1.5 text-ink-3">
      <Minus className="size-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  )
}

/** Which Control Center actions need a reason, which need a second approver, and who can take them. */
export function PolicyTable() {
  const columns: Column<Policy>[] = [
    {
      key: "action",
      header: "Action",
      cell: (p) => (
        <span className="block max-w-[300px]">
          <span className="block font-medium text-ink">{p.action}</span>
          {p.note ? <span className="block text-[11px] text-ink-3">{p.note}</span> : null}
        </span>
      ),
    },
    { key: "who", header: "Who can do it", cell: (p) => <Chips items={whoCan(p)} /> },
    { key: "reason", header: "Reason", cell: (p) => (p.reason ? <Yes>Required</Yes> : <No />) },
    { key: "approver", header: "Second approver", cell: (p) => (p.approver ? <Yes>{p.approver}</Yes> : <No />) },
  ]

  const reasons = sensitivePolicy.filter((p) => p.reason).length
  const approvals = sensitivePolicy.filter((p) => p.approver).length

  return (
    <div>
      <p className="px-4 py-3 text-[12px] text-ink-2">
        {reasons} of {sensitivePolicy.length} actions need a written reason and {approvals} need a second admin. Reasons and approvers are saved with each audit entry.
      </p>
      <PlatformTable
        rows={sensitivePolicy}
        columns={columns}
        rowKey={(p) => p.action}
        caption="Sensitive-action policy"
        minWidth={900}
        mobileRow={(p) => ({
          title: p.action,
          meta: p.reason ? "Reason required" : "No reason needed",
          below: (
            <div className="grid gap-1.5">
              {p.approver ? <p className="text-[12px] text-ink-2">Second approver: {p.approver.charAt(0).toLowerCase() + p.approver.slice(1)}</p> : null}
              {p.note ? <p className="text-[11px] text-ink-3">{p.note}</p> : null}
              <Chips items={whoCan(p)} />
            </div>
          ),
        })}
      />
    </div>
  )
}
