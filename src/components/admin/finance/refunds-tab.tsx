"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckIcon as Check, CopyIcon as Copy, CircleNotchIcon as Loader2, ArrowCounterClockwiseIcon as RotateCcw, XIcon as X } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import type { Refund } from "@/lib/data/admin"
import { brands } from "@/lib/data/brands"
import { useAdmin } from "@/lib/stores/admin"
import { ReasonDialog, type ReasonAction } from "../platform/reason-dialog"
import { FilterSelect } from "../platform/table"
import { orderIdOf, providerFor } from "./derive"
import { formatDateTime, plural, providerName, relDays, usd } from "./format"
import { refundMeta } from "./meta"
import { AdminTable, TablePanel, useScrollToRow, type Column } from "./table"

type Filter = "all" | Refund["status"]

const ORDER: Refund["status"][] = ["requested", "approved", "issued", "declined"]
type Decision = { refund: Refund; kind: "approve" | "decline"; action: ReasonAction }

/** Refunds sent to the provider and not yet confirmed. Module-level so a confirmation survives a tab change. */
const inFlight = new Set<string>()

function providerOf(r: Refund) {
  const b = brands.find((x) => x.name === r.brandName)
  return providerName[b ? providerFor(b) : "stripe"]
}

/**
 * Confirms a refund with the provider. In the frontend phase the provider's answer is simulated
 * after a short delay; in the backend it is the provider's webhook plus a verify call, keyed by
 * the refund's idempotency key so a retry can never pay twice.
 *
 * The confirmation is the provider's, not an admin decision, so it moves the refund to issued
 * without setRefundStatus: that action records an "Issued refund" decision in the signed-in
 * admin's name. The admin's one decision is the approval. (Shared change requested: a store
 * action such as markRefundIssued(id, by: "Stripe webhook") that logs the provider as actor.)
 */
function confirmWithProvider(r: Refund, delay = 1600) {
  if (inFlight.has(r.id)) return
  inFlight.add(r.id)
  window.setTimeout(() => {
    inFlight.delete(r.id)
    const now = useAdmin.getState().refunds.find((x) => x.id === r.id)
    if (now?.status !== "approved") return
    useAdmin.setState((s) => ({ refunds: s.refunds.map((x) => (x.id === r.id ? { ...x, status: "issued" } : x)) }))
    toast(`Refund for #${r.reference} issued`, { description: `${providerOf(r)} confirmed it. The customer is told by email.` })
  }, delay)
}

/** Refund requests: approve and issue, or decline, each with a reason. The idempotency key is shown so support can trace a retry. */
export function RefundsTab({ focus }: { focus?: string | null }) {
  const refunds = useAdmin((s) => s.refunds)
  const setRefundStatus = useAdmin((s) => s.setRefundStatus)
  const focused = focus ? refunds.find((r) => r.id === focus) : undefined
  const [filter, setFilter] = useState<Filter>(focused ? focused.status : "requested")
  const [decision, setDecision] = useState<Decision | null>(null)
  const [open, setOpen] = useState(false)
  useScrollToRow(focus)

  // A refund left sending by a reload is picked up again: ask the provider where it is.
  const sending = refunds.filter((r) => r.status === "approved").map((r) => r.id).join(",")
  useEffect(() => {
    for (const r of useAdmin.getState().refunds) if (r.status === "approved") confirmWithProvider(r, 2400)
  }, [sending])

  const count = (s: Refund["status"]) => refunds.filter((r) => r.status === s).length
  const rows = refunds.filter((r) => filter === "all" || r.status === filter)

  function decide(r: Refund, kind: Decision["kind"]) {
    const facts = [
      { label: "Amount", value: usd(r.amountUsd) },
      { label: "Customer", value: r.customer },
      { label: "Brand", value: r.brandName },
      { label: "Customer's reason", value: r.reason },
    ]
    setDecision(
      kind === "approve"
        ? {
            refund: r,
            kind,
            action: {
              title: `Approve and issue a ${usd(r.amountUsd)} refund for #${r.reference}?`,
              body: `It goes to ${providerOf(r)} with idempotency key ${r.idempotencyKey}, so a retry can't pay twice. The brand's share and the 5% commission are reversed as new ledger entries.`,
              confirmLabel: "Approve and issue",
              tone: "primary",
              facts,
              presets: ["Return received and checked by the brand", "Damage confirmed from the customer's photos", "Carrier confirmed the parcel was lost"],
            },
          }
        : {
            refund: r,
            kind,
            action: {
              title: `Decline the refund for #${r.reference}?`,
              body: "The customer and the brand are told why. No money moves and nothing is posted to the ledger.",
              confirmLabel: "Decline refund",
              tone: "destructive",
              facts,
              presets: ["Outside the return window", "Item came back worn or damaged", "Tracking shows delivery; no fault found"],
            },
          },
    )
    setOpen(true)
  }

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key)
      toast("Idempotency key copied", { description: key })
    } catch {
      toast("Couldn't copy", { description: `Select the key by hand: ${key}` })
    }
  }

  function actions(r: Refund) {
    if (r.status === "requested")
      return (
        <>
          <Button type="button" size="xs" variant="secondary" onClick={() => decide(r, "approve")}>
            <Check /> Approve and issue
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => decide(r, "decline")}>
            <X /> Decline
          </Button>
        </>
      )
    if (r.status === "approved")
      return (
        <span role="status" className="inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap text-ink-2">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Waiting for {providerOf(r)}
        </span>
      )
    return <span className="text-[11px] whitespace-nowrap text-ink-3">{r.status === "issued" ? "Done" : "Closed"}</span>
  }

  const keyCell = (r: Refund) => (
    <button type="button" onClick={() => copyKey(r.idempotencyKey)} className="group inline-flex items-center gap-1.5 rounded-sm text-[11px] whitespace-nowrap text-ink-2 tabular hover:text-ink" aria-label={`Copy idempotency key ${r.idempotencyKey}`}>
      {r.idempotencyKey}
      <Copy className="size-3 text-ink-3 group-hover:text-ink" aria-hidden />
    </button>
  )

  const columns: Column<Refund>[] = [
    {
      key: "ref",
      header: "Order",
      cell: (r) => (
        <Link href={`/admin/orders?order=${orderIdOf(r.id)}`} className="font-medium whitespace-nowrap text-ink tabular hover:text-violet">
          #{r.reference}
        </Link>
      ),
    },
    {
      key: "who",
      header: "Brand and customer",
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate text-ink">{r.brandName}</span>
          <span className="block truncate text-[11px] text-ink-3">{r.customer}</span>
        </span>
      ),
    },
    { key: "reason", header: "Reason", cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.reason}</span> },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="whitespace-nowrap text-ink">{usd(r.amountUsd)}</span> },
    { key: "requested", header: "Requested", cell: (r) => <time dateTime={r.requestedAt} title={formatDateTime(r.requestedAt)} className="whitespace-nowrap text-ink-2">{relDays(r.requestedAt)}</time> },
    { key: "key", header: "Idempotency key", cell: keyCell },
    { key: "status", header: "Status", cell: (r) => <StatusBadge tone={refundMeta[r.status].tone}>{refundMeta[r.status].label}</StatusBadge> },
    { key: "actions", header: "Decision", align: "right", cell: (r) => <span className="inline-flex items-center justify-end gap-1.5">{actions(r)}</span> },
  ]

  const requested = refunds.filter((r) => r.status === "requested")

  return (
    <>
      <TablePanel
        id="refunds-title"
        title="Refunds"
        description={`${plural(requested.length, "request")} to decide, ${usd(requested.reduce((s, r) => s + r.amountUsd, 0))}. Each refund carries one idempotency key from request to provider.`}
        toolbar={
          <FilterSelect
            label="Filter by status"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            className="md:w-[200px]"
            options={[{ value: "all", label: `All statuses (${refunds.length})` }, ...ORDER.filter((s) => count(s) || s === filter).map((s) => ({ value: s, label: `${refundMeta[s].label} (${count(s)})` }))]}
          />
        }
      >
        {rows.length ? (
          <AdminTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            caption="Refunds"
            minWidth={1060}
            selectedKey={focus}
            mobileRow={(r) => ({
              title: (
                <>
                  <span className="tabular">#{r.reference}</span> <span className="text-ink-2">{r.brandName}</span>
                </>
              ),
              meta: `${r.customer}, ${r.reason.toLowerCase()}`,
              trail: (
                <>
                  <span className="text-[13px] text-ink tabular">{usd(r.amountUsd)}</span>
                  <StatusBadge tone={refundMeta[r.status].tone}>{refundMeta[r.status].label}</StatusBadge>
                </>
              ),
              footer: (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {keyCell(r)}
                  <div className="flex flex-wrap gap-1.5">{actions(r)}</div>
                </div>
              ),
            })}
          />
        ) : (
          <EmptyState
            icon={RotateCcw}
            className="m-4"
            title={filter === "requested" ? "No refunds to decide" : filter === "approved" ? "No refunds sending to provider" : `No ${filter === "all" ? "" : `${filter} `}refunds`}
            body={filter === "requested" ? "New requests from brands and support land here." : "Refunds move here as they're decided."}
            action={filter !== "all" ? <Button size="sm" variant="secondary" onClick={() => setFilter("all")}>Show all refunds</Button> : null}
          />
        )}
      </TablePanel>

      <ReasonDialog
        action={decision?.action ?? null}
        open={open}
        onOpenChange={setOpen}
        onConfirm={async (reason) => {
          if (!decision) return
          const r = decision.refund
          if (decision.kind === "approve") {
            setRefundStatus(r.id, "approved", reason)
            toast(`Refund for #${r.reference} approved`, { description: `Sent to ${providerOf(r)} with key ${r.idempotencyKey}.` })
            confirmWithProvider(r)
          } else {
            setRefundStatus(r.id, "declined", reason)
            toast(`Refund for #${r.reference} declined`, { description: "The customer and the brand will see your reason." })
          }
        }}
      />
    </>
  )
}
