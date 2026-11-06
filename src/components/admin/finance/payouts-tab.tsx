"use client"

import { CheckIcon, PauseCircleIcon, PlayCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DataTable, bulkBarControl, type BulkAction, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { BrandMark } from "@/components/market/brand-mark"
import { Panel } from "@/components/admin/ui/panel"
import type { AuditEntry, Payout } from "@/lib/data/admin"
import { brandById } from "@/lib/data/brands"
import type { CurrencyCode } from "@/config/markets"
import { convert } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useDecision, type Decision } from "../marketplace/decision"
import { Filters } from "../marketplace/filters"
import { holdReason, providerFor } from "./derive"
import { amountIn, daysUntil, formatDate, plural, providerName, usd } from "./format"
import { payoutMeta } from "./meta"
import { FocusCallout, useSearchParam, writeParams } from "./table"
import type { Meta } from "./meta"
import { usePhone } from "../marketplace/url-state"

type Kind = "approve" | "hold" | "release"
type Filter = "all" | Payout["status"]
const ORDER: Payout["status"][] = ["awaiting_approval", "held", "scheduled", "processing", "paid"]
const APPROVED = "Approved payout"
const isFilter = (v: string | null): v is Filter => v === "all" || ORDER.includes(v as Payout["status"])

const allowed: Record<Payout["status"], Kind[]> = { awaiting_approval: ["approve", "hold"], scheduled: ["hold"], held: ["release"], processing: [], paid: [] }
const kindDef: Record<Kind, { label: string; to: Payout["status"]; icon: React.ComponentType<{ className?: string }>; destructive: boolean; done: string }> = {
  approve: { label: "Approve payout", to: "processing", icon: CheckIcon, destructive: false, done: "approved" },
  hold: { label: "Hold payout", to: "held", icon: PauseCircleIcon, destructive: true, done: "held" },
  release: { label: "Release payout", to: "scheduled", icon: PlayCircleIcon, destructive: false, done: "released" },
}

function when(iso: string) {
  const d = daysUntil(iso)
  return d <= 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`
}
const local = (p: Payout) => amountIn(convert(p.amountUsd, "USD", p.currency as CurrencyCode), p.currency as CurrencyCode)
const providerOf = (p: Payout) => {
  const b = brandById.get(p.brandId)
  return providerName[b ? providerFor(b) : "stripe"]
}
/** Approved in this browser: the decision is recorded, but nothing was sent (no provider). */
const approvedHere = (p: Payout, audit: AuditEntry[]) => p.status === "processing" && audit.some((a) => a.subjectId === p.id && a.action === APPROVED)

/**
 * The status as Finance should read it. A payout approved here isn't with a provider (there's
 * none in this build), so it reads "Approval recorded", not "Processing" as if money were moving.
 */
const RECORDED: Meta = { label: "Approval recorded", tone: "info" }
const statusOf = (p: Payout, audit: AuditEntry[]): Meta => (approvedHere(p, audit) ? RECORDED : payoutMeta[p.status])

/** Why a bulk action is unavailable: none of the selected payouts is in a status it applies to. */
function noneApplies(kind: Kind) {
  const from = (Object.keys(allowed) as Payout["status"][]).filter((s) => allowed[s].includes(kind)).map((s) => payoutMeta[s].label.toLowerCase())
  const states = from.length > 1 ? `${from.slice(0, -1).join(", ")} or ${from.at(-1)}` : from[0]
  return `None of the selected payouts is ${states}.`
}

/** Why a payout's menu greys out a decision, in its own terms. */
function unavailable(kind: Kind, p: Payout, audit: AuditEntry[]) {
  if (p.status === "paid") return "Already completed."
  const recorded = approvedHere(p, audit)
  if (kind === "approve") return p.status === "scheduled" ? "It's on the payout schedule, so it needs no approval." : p.status === "held" ? "Held. Release it first." : recorded ? "Approval already recorded." : "Already processing."
  if (kind === "hold") return p.status === "held" ? "Already held." : recorded ? "Approval is recorded, so it can't be held." : "Processing payouts can't be held."
  return "Only held payouts can be released."
}

function payoutDecision(kind: Kind, list: Payout[], audit: AuditEntry[]): Decision | null {
  const def = kindDef[kind]
  const items = list.filter((p) => allowed[p.status].includes(kind))
  if (!items.length) return null
  const one = items.length === 1 ? items[0] : null
  const total = items.reduce((s, p) => s + p.amountUsd, 0)
  const skipped = list.length - items.length
  const facts = one ? `${usd(one.amountUsd)}${one.currency !== "USD" ? ` (${local(one)})` : ""} for ${plural(one.orders, "delivered order")}, via ${one.method}.` : `${usd(total)} in total.`
  const why = one && kind === "release" ? holdReason(one, audit) : undefined
  const means = {
    approve: `Approval is recorded with your name. No payments provider is connected in this build, so the transfer through ${one ? providerOf(one) : "each brand's provider"} isn't sent; the payout shows Approval recorded and is marked completed only when a provider confirms it.`,
    hold: "The money stays in the brand's balance and isn't sent until someone releases it with a reason.",
    release: one ? `It goes back on the schedule for ${formatDate(one.scheduledFor)}.${why ? ` It was held because: ${why}` : ""}` : "They go back on their schedules.",
  }[kind]
  return {
    title: one ? `${def.label.replace(" payout", "")} the payout to ${one.brandName}?` : `${def.label.replace(" payout", "")} ${plural(items.length, "payout")}?`,
    description: [facts, means, skipped ? `${plural(skipped, "selected payout")} ${skipped === 1 ? "isn't" : "aren't"} in a status this applies to and ${skipped === 1 ? "is" : "are"} left as ${skipped === 1 ? "it is" : "they are"}.` : null].filter(Boolean).join(" "),
    confirmLabel: one ? def.label : `${def.label.replace(" payout", "")} ${plural(items.length, "payout")}`,
    destructive: def.destructive,
    run: (reason) => {
      const set = useAdmin.getState().setPayoutStatus
      for (const p of items) set(p.id, def.to, reason)
      toast.success(kind === "approve" ? (one ? `Approval recorded for the payout to ${one.brandName}` : `Approval recorded for ${plural(items.length, "payout")}`) : one ? `Payout to ${one.brandName} ${def.done}` : `${plural(items.length, "payout")} ${def.done}`, { description: kind === "approve" ? "Approval recorded. Nothing is sent until a payments provider is connected." : "Recorded in the audit log with your reason." })
    },
  }
}

/** Brand payouts. Approve, hold and release are decisions with a reason; amounts are never edited here and nothing is marked paid. */
export function PayoutsTab({ focus, ready }: { focus?: string | null; ready: boolean }) {
  const payouts = useAdmin((s) => s.payouts)
  const phone = usePhone()
  const audit = useAdmin((s) => s.audit)
  // The status filter lives in the URL (?status=…), so a reload keeps it.
  const linked = useSearchParam("status")
  const filter: Filter = isFilter(linked) ? linked : "all"
  const setFilter = (f: Filter) => writeParams({ status: f === "all" ? null : f })
  // A decided row can leave the filtered table; focus then goes back to the selection bar while
  // rows stay selected, else to the table's search.
  const { ask, dialog } = useDecision(() => bulkBarControl(document.querySelector('main [role="tabpanel"]')) ?? document.querySelector<HTMLElement>('main [role="tabpanel"] input[type="search"]'))
  // The row menu and the bulk bar only offer a decision for payouts it applies to. What `ask`
  // returns goes back to the bulk bar, so a decision that reports a cancel keeps the selection.
  const decide = (kind: Kind, list: Payout[]) => {
    const d = payoutDecision(kind, list, audit)
    return d ? ask(d) : false
  }

  const count = (s: Payout["status"]) => payouts.filter((p) => p.status === s).length
  const rows = payouts.filter((p) => filter === "all" || p.status === filter).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.scheduledFor.localeCompare(b.scheduledFor))
  const focused = focus ? payouts.find((p) => p.id === focus) : undefined
  const toApprove = payouts.filter((p) => p.status === "awaiting_approval")

  const statusCell = (p: Payout) => {
    const why = p.status === "held" ? holdReason(p, audit) : undefined
    const meta = statusOf(p, audit)
    return (
      <span className="grid justify-items-start gap-1">
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        {why ? <span className="max-w-56 text-[11px] leading-snug whitespace-normal text-danger">{why}</span> : null}
        {approvedHere(p, audit) ? <span className="max-w-56 text-[11px] leading-snug whitespace-normal text-ink-3">Approval recorded. Not sent: no payments provider in this build.</span> : null}
      </span>
    )
  }

  const columns: Column<Payout>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (p) => p.brandName,
      cell: (p) => {
        const b = brandById.get(p.brandId)
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            {b ? <span className="hidden sm:inline-flex"><BrandMark brand={b} size="sm" /></span> : null}
            <span className="min-w-0 max-w-[34vw] sm:max-w-none">
              <span className="block truncate font-medium text-ink">{p.brandName}</span>
              <span className="block truncate text-[11.5px] text-ink-3">
                <span className="sm:hidden">{statusOf(p, audit).label}, </span>
                {plural(p.orders, "delivered order")}
              </span>
            </span>
          </span>
        )
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (p) => p.amountUsd,
      cell: (p) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{usd(p.amountUsd)}</span>
          {p.currency !== "USD" ? <span className="hidden text-[11px] text-ink-3 sm:block">{local(p)}</span> : null}
        </span>
      ),
    },
    { key: "method", header: "Method", hideBelow: "lg", cell: (p) => <span className="whitespace-nowrap text-ink-2">{p.method}</span> },
    {
      key: "date",
      header: "Schedule",
      hideBelow: "md",
      sortValue: (p) => p.scheduledFor,
      cell: (p) =>
        p.status === "paid" ? (
          // A completed payout isn't scheduled any more: it says Paid, with the date only once it has passed.
          <span className="block whitespace-nowrap">
            <span className="block text-ink-2">Paid</span>
            {daysUntil(p.scheduledFor) <= 0 ? <span className="block text-[11px] text-ink-3">{formatDate(p.scheduledFor)}</span> : null}
          </span>
        ) : (
          <span className="block whitespace-nowrap">
            <span className="block text-ink-2">{formatDate(p.scheduledFor)}</span>
            <span className="block text-[11px] text-ink-3">{when(p.scheduledFor)}</span>
          </span>
        ),
    },
    { key: "status", header: "Status", hideBelow: "sm", sortValue: (p) => ORDER.indexOf(p.status), cell: statusCell },
  ]

  const allows = (k: Kind) => (p: Payout) => allowed[p.status].includes(k)
  const rowActions: RowAction<Payout>[] = (["approve", "hold", "release"] as Kind[]).map((k) => ({ label: kindDef[k].label, icon: kindDef[k].icon, destructive: kindDef[k].destructive, disabled: (p: Payout) => !allows(k)(p), disabledReason: (p: Payout) => unavailable(k, p, audit), onSelect: (p: Payout) => decide(k, [p]) }))
  // The bar offers the decisions a status in this filter can take; processing and paid can take
  // none, so those filters have no checkboxes.
  const bulkKinds = (["approve", "hold", "release"] as Kind[]).filter((k) => (filter === "all" ? ORDER : [filter]).some((s) => allowed[s].includes(k)))
  const bulkLabel: Record<Kind, string> = { approve: "Approve", hold: "Hold", release: "Release" }
  const bulkActions: BulkAction<Payout>[] = bulkKinds.map((k) => ({ label: bulkLabel[k], destructive: kindDef[k].destructive, appliesTo: allows(k), disabledReason: noneApplies(k), onSelect: (list) => decide(k, list) }))

  return (
    <div className="grid gap-3">
      {focused ? (
        <FocusCallout
          title={`Payout to ${focused.brandName}, ${usd(focused.amountUsd)}`}
          badge={<StatusBadge tone={statusOf(focused, audit).tone}>{statusOf(focused, audit).label}</StatusBadge>}
          meta={focused.status === "paid" ? `${focused.method}, paid` : approvedHere(focused, audit) ? `${focused.method}. Approval recorded; not sent, no payments provider in this build.` : `${focused.method}, scheduled for ${formatDate(focused.scheduledFor)}`}
          actions={allowed[focused.status].map((k) => (
            <Button key={k} type="button" size="sm" className="h-10 sm:h-8" variant={k === "hold" ? "destructive" : "secondary"} onClick={() => decide(k, [focused])}>
              {kindDef[k].label}
            </Button>
          ))}
          onDismiss={() => writeParams({ focus: null })}
        />
      ) : null}

      <Panel title="Payouts" description={ready ? `${plural(toApprove.length, "payout")} awaiting approval, ${usd(toApprove.reduce((s, p) => s + p.amountUsd, 0))}. A payout that's already processing can't be held.` : "Brand payouts and the decisions on them."} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
        <DataTable
          label="Brand payouts"
          rows={rows}
          columns={columns}
          getId={(p) => p.id}
          loading={!ready}
          search={{ placeholder: "Search brands or methods", text: (p) => `${p.brandName} ${p.method}` }}
          toolbar={
            <Filters
              noun="payouts"
              results={rows.length}
              onClear={() => setFilter("all")}
              filters={[{ key: "status", label: "Status", value: filter, onChange: (v) => setFilter(v as Filter), all: { value: "all", label: `All statuses (${payouts.length})` }, options: ORDER.map((s) => ({ value: s, label: `${s === "processing" && payouts.some((p) => approvedHere(p, audit)) ? "Processing or approval recorded" : payoutMeta[s].label} (${count(s)})` })), width: "w-[244px]" }]}
            />
          }
          rowActions={rowActions}
          bulkActions={phone || !bulkActions.length ? undefined : bulkActions}
          highlightedRowId={focused?.id}
          empty={{ title: filter === "all" ? "No payouts yet" : `No payouts ${payoutMeta[filter as Payout["status"]].label.toLowerCase()}`, body: "Payouts move between statuses as they're decided.", action: filter !== "all" ? <Button size="sm" variant="secondary" onClick={() => setFilter("all")}>Show all payouts</Button> : undefined }}
          minWidth={300}
        />
      </Panel>
      {dialog}
    </div>
  )
}
