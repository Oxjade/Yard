"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowSquareOutIcon, CheckIcon, XIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DataTable, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Panel } from "@/components/admin/ui/panel"
import type { Refund } from "@/lib/data/admin"
import { brands } from "@/lib/data/brands"
import { useAdmin } from "@/lib/stores/admin"
import { CopyValue } from "../marketplace/bits"
import { useDecision, type Decision } from "../marketplace/decision"
import { Filters } from "../marketplace/filters"
import { notifyRefundDecision, refundAudience } from "../marketplace/notify"
import { orderIdOf, providerFor } from "./derive"
import { formatDateTime, plural, providerName, relDays, usd } from "./format"
import { refundMeta } from "./meta"
import { FocusCallout, refLinkClass, useSearchParam, writeParams } from "./table"
import { usePhone } from "../marketplace/url-state"

type Filter = "all" | Refund["status"]
type Kind = "approve" | "decline"
const ORDER: Refund["status"][] = ["requested", "approved", "issued", "declined"]
const isFilter = (v: string | null): v is Filter => v === "all" || ORDER.includes(v as Refund["status"])

function providerOf(r: Refund) {
  const b = brands.find((x) => x.name === r.brandName)
  return providerName[b ? providerFor(b) : "stripe"]
}

/**
 * Who sees the decision outside the Control Center. Declining quotes your reason to the
 * shopper (on their own order) and to the Studio brand; approving tells them it's approved.
 */
function audience(items: Refund[], kind: Kind) {
  const shopper = items.find((r) => refundAudience(r).shopper)
  const merchant = items.find((r) => refundAudience(r).merchant)
  if (!shopper && !merchant) return null
  const person = shopper ? (items.length === 1 ? shopper.customer : "The shopper") : null
  const who = person && merchant ? `${person} and ${merchant.brandName} are notified` : person ? `${person} is notified in their account` : `${merchant!.brandName} is notified in Studio`
  const both = !!(person && merchant)
  return kind === "decline" ? `${who} and ${both ? "see" : "sees"} your reason.` : `${who} that it's approved; your reason stays in the audit log.`
}

/** Why a bulk action changed nothing: every selected refund has been decided already. */
function nothingApplies(kind: Kind, count: number) {
  const done = kind === "approve" ? "approved" : "declined"
  return count === 1 ? `The selected refund has already been decided, so nothing was ${done}.` : `None of the ${count} selected refunds is waiting for a decision, so nothing was ${done}.`
}

function refundDecision(kind: Kind, list: Refund[]): Decision | null {
  const items = list.filter((r) => r.status === "requested")
  if (!items.length) return null
  const one = items.length === 1 ? items[0] : null
  const total = items.reduce((s, r) => s + r.amountUsd, 0)
  const skipped = list.length - items.length
  const skip = skipped ? `${plural(skipped, "selected refund")} ${skipped === 1 ? "has" : "have"} already been decided and ${skipped === 1 ? "is" : "are"} left as ${skipped === 1 ? "it is" : "they are"}.` : null
  if (kind === "approve") {
    return {
      title: one ? `Approve the ${usd(one.amountUsd)} refund for #${one.reference}?` : `Approve ${plural(items.length, "refund")}, ${usd(total)}?`,
      description: [
        one ? `${one.customer} asked for it: ${one.reason.toLowerCase()}.` : null,
        `Approval is recorded with ${one ? `idempotency key ${one.idempotencyKey}` : "each refund's idempotency key"}, so a retry can never refund twice. No payments provider is connected in this build, so nothing is sent to ${one ? providerOf(one) : "the provider"} and no money moves yet; the brand's share and the 5% commission reverse when the provider confirms.`,
        audience(items, "approve"),
        skip,
      ]
        .filter(Boolean)
        .join(" "),
      confirmLabel: one ? "Approve refund" : `Approve ${plural(items.length, "refund")}`,
      run: (reason) => {
        const set = useAdmin.getState().setRefundStatus
        for (const r of items) {
          set(r.id, "approved", reason)
          notifyRefundDecision(r, "approved", reason)
        }
        toast.success(one ? `Refund for #${one.reference} approved` : `${plural(items.length, "refund")} approved`, { description: "Approval recorded. Not sent: no payments provider in this build." })
      },
    }
  }
  return {
    title: one ? `Decline the refund for #${one.reference}?` : `Decline ${plural(items.length, "refund")}?`,
    description: ["No money moves and nothing is posted to the ledger. Your reason is recorded in the audit log.", audience(items, "decline"), skip].filter(Boolean).join(" "),
    confirmLabel: one ? "Decline refund" : `Decline ${plural(items.length, "refund")}`,
    destructive: true,
    run: (reason) => {
      const set = useAdmin.getState().setRefundStatus
      for (const r of items) {
        set(r.id, "declined", reason)
        notifyRefundDecision(r, "declined", reason)
      }
      toast.success(one ? `Refund for #${one.reference} declined` : `${plural(items.length, "refund")} declined`, { description: "Recorded in the audit log with your reason." })
    },
  }
}

/** Refund requests: approve or decline, each with a reason. The idempotency key is shown so support can trace a retry. */
export function RefundsTab({ focus, ready }: { focus?: string | null; ready: boolean }) {
  const router = useRouter()
  const phone = usePhone()
  const refunds = useAdmin((s) => s.refunds)
  const focused = focus ? refunds.find((r) => r.id === focus) : undefined
  // The status filter lives in the URL (?status=…, the queue of requests when absent), so a
  // reload keeps it. A linked refund opens on its own status, once, so it's in the table.
  const linked = useSearchParam("status")
  const filter: Filter = isFilter(linked) ? linked : "requested"
  const setFilter = (f: Filter) => writeParams({ status: f === "requested" ? null : f })
  const focusedStatus = ready ? focused?.status : undefined
  // Once per linked record: a decision on it mustn't move the table.
  const applied = useRef<string | null>(null)
  useEffect(() => {
    if (!focus || !focusedStatus || applied.current === focus) return
    applied.current = focus
    if (!new URLSearchParams(window.location.search).get("status")) writeParams({ status: focusedStatus === "requested" ? null : focusedStatus })
  }, [focus, focusedStatus])
  // A decided row can leave the filtered table; focus then goes to the table's search.
  const { ask, dialog } = useDecision(() => document.querySelector<HTMLElement>('main [role="tabpanel"] input[type="search"]'))
  const decide = (kind: Kind, list: Refund[]) => {
    const d = refundDecision(kind, list)
    if (d) ask(d)
    else toast.info(nothingApplies(kind, list.length))
  }

  const count = (s: Refund["status"]) => refunds.filter((r) => r.status === s).length
  const rows = refunds.filter((r) => filter === "all" || r.status === filter).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
  const requested = refunds.filter((r) => r.status === "requested")

  const statusCell = (r: Refund) => (
    <span className="grid justify-items-start gap-1">
      <StatusBadge tone={refundMeta[r.status].tone}>{refundMeta[r.status].label}</StatusBadge>
      {r.status === "approved" ? <span className="max-w-48 text-[11px] leading-snug whitespace-normal text-ink-3">Not sent: no payments provider in this build.</span> : null}
    </span>
  )

  const columns: Column<Refund>[] = [
    {
      key: "ref",
      header: "Order",
      sortValue: (r) => r.reference,
      cell: (r) => (
        <span className="block min-w-0">
          <Link href={`/admin/orders?order=${orderIdOf(r.id)}`} className={refLinkClass}>
            #{r.reference}
          </Link>
          <span className="block max-w-[36vw] truncate text-[11.5px] text-ink-3 md:hidden">
            {r.brandName}
            <span className="sm:hidden">, {refundMeta[r.status].label.toLowerCase()}</span>
          </span>
        </span>
      ),
    },
    {
      key: "who",
      header: "Brand and customer",
      hideBelow: "md",
      sortValue: (r) => r.brandName,
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate text-ink">{r.brandName}</span>
          <span className="block truncate text-[11px] text-ink-3">{r.customer}</span>
        </span>
      ),
    },
    { key: "reason", header: "Reason", hideBelow: "lg", cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.reason}</span> },
    { key: "amount", header: "Amount", align: "right", sortValue: (r) => r.amountUsd, cell: (r) => <span className="whitespace-nowrap text-ink">{usd(r.amountUsd)}</span> },
    { key: "requested", header: "Requested", hideBelow: "md", sortValue: (r) => r.requestedAt, cell: (r) => <time dateTime={r.requestedAt} title={formatDateTime(r.requestedAt)} className="whitespace-nowrap text-ink-2">{relDays(r.requestedAt)}</time> },
    { key: "key", header: "Idempotency key", hideBelow: "lg", cell: (r) => <CopyValue value={r.idempotencyKey} label="Copy idempotency key" className="text-[12px] text-ink-2" /> },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (r) => ORDER.indexOf(r.status), cell: statusCell },
  ]

  const rowActions: RowAction<Refund>[] = [
    { label: "Approve refund", icon: CheckIcon, disabled: (r) => r.status !== "requested", onSelect: (r) => decide("approve", [r]) },
    { label: "Decline refund", icon: XIcon, destructive: true, disabled: (r) => r.status !== "requested", onSelect: (r) => decide("decline", [r]) },
    { label: "Open the order", icon: ArrowSquareOutIcon, separatorBefore: true, onSelect: (r) => router.push(`/admin/orders?order=${orderIdOf(r.id)}`) },
  ]
  const bulkActions: BulkAction<Refund>[] = [
    { label: "Approve", onSelect: (list) => decide("approve", list) },
    { label: "Decline", destructive: true, onSelect: (list) => decide("decline", list) },
  ]

  return (
    <div className="grid gap-3">
      {focused ? (
        <FocusCallout
          title={`Refund for #${focused.reference}, ${usd(focused.amountUsd)}`}
          badge={<StatusBadge tone={refundMeta[focused.status].tone}>{refundMeta[focused.status].label}</StatusBadge>}
          meta={
            <>
              {focused.customer}, {focused.reason.toLowerCase()}. Key <CopyValue value={focused.idempotencyKey} label="Copy idempotency key" className="text-ink" />
            </>
          }
          actions={
            focused.status === "requested" ? (
              <>
                <Button type="button" size="sm" variant="destructive" className="h-10 sm:h-8" onClick={() => decide("decline", [focused])}>Decline</Button>
                <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => decide("approve", [focused])}>Approve</Button>
              </>
            ) : null
          }
          onDismiss={() => writeParams({ focus: null })}
        />
      ) : null}

      <Panel title="Refunds" description={ready ? `${plural(requested.length, "request")} to decide, ${usd(requested.reduce((s, r) => s + r.amountUsd, 0))}. Amounts in USD; each refund carries one idempotency key from request to provider.` : "Refund requests and the decisions on them."} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
        <DataTable
          label="Refunds"
          rows={rows}
          columns={columns}
          getId={(r) => r.id}
          loading={!ready}
          search={{ placeholder: "Order, brand, customer or key", text: (r) => `${r.reference} ${r.brandName} ${r.customer} ${r.idempotencyKey}` }}
          toolbar={
            <Filters
              noun="refunds"
              results={rows.length}
              onClear={() => setFilter("all")}
              filters={[{ key: "status", label: "Status", value: filter, onChange: (v) => setFilter(v as Filter), all: { value: "all", label: `All statuses (${refunds.length})` }, options: ORDER.map((s) => ({ value: s, label: `${refundMeta[s].label} (${count(s)})` })), width: "w-[196px]" }]}
            />
          }
          rowActions={rowActions}
          bulkActions={phone ? undefined : bulkActions}
          empty={{ title: filter === "requested" ? "No refunds to decide" : `No ${filter === "all" ? "" : `${refundMeta[filter as Refund["status"]].label.toLowerCase()} `}refunds`, body: filter === "requested" ? "Return requests from shoppers and support land here." : "Refunds move here as they're decided.", action: filter !== "all" ? <Button size="sm" variant="secondary" onClick={() => setFilter("all")}>Show all refunds</Button> : undefined }}
          minWidth={300}
        />
      </Panel>
      {dialog}
    </div>
  )
}
