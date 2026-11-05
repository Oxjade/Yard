"use client"

import { useState } from "react"
import { MoneyIcon as Banknote, PauseCircleIcon as PauseCircle, PlayCircleIcon as PlayCircle, CheckIcon as Check } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { BrandMark } from "@/components/market/brand-mark"
import type { Payout } from "@/lib/data/admin"
import { brandById } from "@/lib/data/brands"
import type { CurrencyCode } from "@/config/markets"
import { convert } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { ReasonDialog, type ReasonAction } from "../platform/reason-dialog"
import { FilterSelect } from "../platform/table"
import { holdReason, providerFor } from "./derive"
import { amountIn, daysUntil, formatDate, plural, providerName, usd } from "./format"
import { payoutMeta } from "./meta"
import { AdminTable, TablePanel, useScrollToRow, type Column } from "./table"

type Filter = "all" | Payout["status"]
type Decision = { payout: Payout; to: Payout["status"]; action: ReasonAction; done: [string, string] }

const ORDER: Payout["status"][] = ["awaiting_approval", "held", "scheduled", "processing", "paid"]

function when(iso: string) {
  const d = daysUntil(iso)
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`
}

/** Brand payouts. Approve, hold and release are decisions with a reason; amounts are never edited here. */
export function PayoutsTab({ focus }: { focus?: string | null }) {
  const payouts = useAdmin((s) => s.payouts)
  const audit = useAdmin((s) => s.audit)
  const setPayoutStatus = useAdmin((s) => s.setPayoutStatus)
  const [filter, setFilter] = useState<Filter>("all")
  const [decision, setDecision] = useState<Decision | null>(null)
  const [open, setOpen] = useState(false)
  useScrollToRow(focus)

  const count = (s: Payout["status"]) => payouts.filter((p) => p.status === s).length
  const rows = payouts.filter((p) => filter === "all" || p.status === filter).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.scheduledFor.localeCompare(b.scheduledFor))

  const local = (p: Payout) => amountIn(convert(p.amountUsd, "USD", p.currency as CurrencyCode), p.currency as CurrencyCode)
  const facts = (p: Payout) => [
    { label: "Amount", value: usd(p.amountUsd) },
    { label: "In brand currency", value: local(p) },
    { label: "Orders included", value: p.orders },
    { label: "Method", value: p.method },
  ]

  function decide(p: Payout, kind: "approve" | "hold" | "release") {
    if (kind === "approve") {
      // Same transition as the overview's decision queue: approval hands the transfer to the provider.
      const brand = brandById.get(p.brandId)
      const provider = providerName[brand ? providerFor(brand) : "stripe"]
      setDecision({
        payout: p,
        to: "processing",
        action: {
          title: `Approve the ${usd(p.amountUsd)} payout to ${p.brandName}?`,
          body: `The transfer goes to ${provider} now, with a reference fixed at approval so a retry can't pay the brand twice. Once it's with the provider it can't be held.`,
          confirmLabel: "Approve payout",
          tone: "primary",
          facts: facts(p),
          presets: ["Balance and open refunds checked", "First payout; bank details confirmed with the brand", "Above the approval threshold; figures checked"],
        },
        done: [`Payout to ${p.brandName} approved`, `With ${provider} now, and recorded in the audit log.`],
      })
    } else if (kind === "hold") {
      setDecision({
        payout: p,
        to: "held",
        action: {
          title: `Hold the payout to ${p.brandName}?`,
          body: "The money stays in the brand's balance and isn't sent until someone releases it. The brand sees that it's on hold, with your reason.",
          confirmLabel: "Hold payout",
          tone: "destructive",
          facts: facts(p),
          presets: ["Open refund request exceeds reserve", "Chargeback under review", "Bank details changed in the last 48 hours"],
        },
        done: [`Payout to ${p.brandName} held`, "It won't be sent until it's released."],
      })
    } else {
      const why = holdReason(p, audit)
      setDecision({
        payout: p,
        to: "scheduled",
        action: {
          title: `Release the payout to ${p.brandName}?`,
          body: `It goes back on the schedule for ${formatDate(p.scheduledFor)}.`,
          confirmLabel: "Release payout",
          tone: "primary",
          facts: facts(p),
          warning: why ? `Held because: ${why}` : undefined,
          presets: ["Refund resolved; reserve covers the exposure", "Dispute closed in the brand's favour", "New bank details verified"],
        },
        done: [`Payout to ${p.brandName} released`, `Back on the schedule for ${formatDate(p.scheduledFor)}.`],
      })
    }
    setOpen(true)
  }

  function actions(p: Payout) {
    if (p.status === "awaiting_approval")
      return (
        <>
          <Button type="button" size="xs" variant="secondary" onClick={() => decide(p, "approve")}>
            <Check /> Approve payout
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => decide(p, "hold")}>
            <PauseCircle /> Hold
          </Button>
        </>
      )
    if (p.status === "scheduled")
      return (
        <Button type="button" size="xs" variant="ghost" onClick={() => decide(p, "hold")}>
          <PauseCircle /> Hold
        </Button>
      )
    if (p.status === "held")
      return (
        <Button type="button" size="xs" variant="secondary" onClick={() => decide(p, "release")}>
          <PlayCircle /> Release
        </Button>
      )
    return <span className="text-[11px] whitespace-nowrap text-ink-3">{p.status === "processing" ? "With the provider" : "Settled"}</span>
  }

  const statusCell = (p: Payout) => {
    const why = p.status === "held" ? holdReason(p, audit) : undefined
    return (
      <span className="grid justify-items-start gap-1">
        <StatusBadge tone={payoutMeta[p.status].tone}>{payoutMeta[p.status].label}</StatusBadge>
        {why ? <span className="max-w-56 text-[11px] leading-snug text-danger">{why}</span> : null}
      </span>
    )
  }

  const columns: Column<Payout>[] = [
    {
      key: "brand",
      header: "Brand",
      cell: (p) => {
        const b = brandById.get(p.brandId)
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            {b ? <BrandMark brand={b} size="sm" /> : null}
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">{p.brandName}</span>
              <span className="block text-[11px] text-ink-3">{plural(p.orders, "delivered order")}</span>
            </span>
          </span>
        )
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (p) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{usd(p.amountUsd)}</span>
          {p.currency !== "USD" ? <span className="block text-[11px] text-ink-3">{local(p)}</span> : null}
        </span>
      ),
    },
    { key: "method", header: "Method", cell: (p) => <span className="whitespace-nowrap text-ink-2">{p.method}</span> },
    {
      key: "date",
      header: "Scheduled for",
      cell: (p) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink-2">{formatDate(p.scheduledFor)}</span>
          {p.status !== "paid" ? <span className="block text-[11px] text-ink-3">{when(p.scheduledFor)}</span> : null}
        </span>
      ),
    },
    { key: "status", header: "Status", cell: statusCell },
    { key: "actions", header: "Decision", align: "right", cell: (p) => <span className="inline-flex items-center justify-end gap-1.5">{actions(p)}</span> },
  ]

  const toApprove = payouts.filter((p) => p.status === "awaiting_approval")

  return (
    <>
      <TablePanel
        id="payouts-title"
        title="Payouts"
        description={`${plural(toApprove.length, "payout")} awaiting approval, ${usd(toApprove.reduce((s, p) => s + p.amountUsd, 0))}. A payout that's already with the provider can't be held.`}
        toolbar={
          <FilterSelect
            label="Filter by status"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            className="md:w-[200px]"
            options={[{ value: "all", label: `All statuses (${payouts.length})` }, ...ORDER.filter((s) => count(s) || s === filter).map((s) => ({ value: s, label: `${payoutMeta[s].label} (${count(s)})` }))]}
          />
        }
      >
        {rows.length ? (
          <AdminTable
            rows={rows}
            columns={columns}
            rowKey={(p) => p.id}
            caption="Brand payouts"
            minWidth={940}
            selectedKey={focus}
            rowClassName={(p) => p.status === "held" && "bg-danger/[0.04]"}
            mobileRow={(p) => {
              const b = brandById.get(p.brandId)
              const why = p.status === "held" ? holdReason(p, audit) : undefined
              const acts = p.status === "awaiting_approval" || p.status === "scheduled" || p.status === "held"
              return {
                lead: b ? <BrandMark brand={b} size="sm" /> : undefined,
                title: p.brandName,
                meta: `${p.method}, ${p.status === "paid" ? formatDate(p.scheduledFor) : when(p.scheduledFor)}`,
                trail: (
                  <>
                    <span className="text-[13px] text-ink tabular">{usd(p.amountUsd)}</span>
                    <StatusBadge tone={payoutMeta[p.status].tone}>{payoutMeta[p.status].label}</StatusBadge>
                  </>
                ),
                footer:
                  why || acts ? (
                    <div className="grid gap-2 pl-11">
                      {why ? <p className="text-[11px] text-danger">{why}</p> : null}
                      {acts ? <div className="flex flex-wrap gap-1.5">{actions(p)}</div> : null}
                    </div>
                  ) : undefined,
              }
            }}
          />
        ) : (
          <EmptyState icon={Banknote} className="m-4" title={filter === "awaiting_approval" ? "No payouts awaiting approval" : filter === "processing" ? "No payouts with the provider" : `No ${filter === "all" ? "" : `${filter} `}payouts`} body="Payouts move here as their status changes." action={<Button size="sm" variant="secondary" onClick={() => setFilter("all")}>Show all payouts</Button>} />
        )}
      </TablePanel>

      <ReasonDialog
        action={decision?.action ?? null}
        open={open}
        onOpenChange={setOpen}
        onConfirm={async (reason) => {
          if (!decision) return
          setPayoutStatus(decision.payout.id, decision.to, reason)
          toast(decision.done[0], { description: decision.done[1] })
        }}
      />
    </>
  )
}
