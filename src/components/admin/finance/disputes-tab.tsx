"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { ClipboardTextIcon as FileCheck2, GavelIcon as Gavel, CircleNotchIcon as Loader2 } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { adminUser, disputes, type Dispute } from "@/lib/data/admin"
import { merchantOrders } from "@/lib/data/orders"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { EVIDENCE_ACTION, disputeStage, orderIdOf } from "./derive"
import { daysUntil, dueLabel, formatDate, plural, relDays, usd } from "./format"
import { disputeMeta, type DisputeStage } from "./meta"
import { AdminTable, TablePanel, useScrollToRow, type Column } from "./table"

type Row = { d: Dispute; stage: DisputeStage }

const EVIDENCE = ["Proof of delivery", "Carrier tracking history", "Messages with the customer", "Product listing and photos", "Return and refund policy"] as const
const MIN_SUMMARY = 30
const isOpen = (s: DisputeStage) => s === "needs_evidence" || s === "evidence_submitted" || s === "under_review"

/** Disputes and chargebacks, soonest evidence deadline first. Evidence is submitted here; the provider decides. */
export function DisputesTab({ focus }: { focus?: string | null }) {
  const audit = useAdmin((s) => s.audit)
  const [current, setCurrent] = useState<Dispute | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  useScrollToRow(focus)

  const rank: Record<DisputeStage, number> = { needs_evidence: 0, evidence_submitted: 1, under_review: 1, won: 2, lost: 2 }
  const rows: Row[] = disputes.map((d) => ({ d, stage: disputeStage(d, audit) })).sort((a, b) => rank[a.stage] - rank[b.stage] || a.d.dueBy.localeCompare(b.d.dueBy))
  const needs = rows.filter((r) => r.stage === "needs_evidence")
  const exposure = rows.filter((r) => isOpen(r.stage)).reduce((s, r) => s + r.d.amountUsd, 0)

  const due = (r: Row) => {
    if (!isOpen(r.stage)) return <span className="whitespace-nowrap text-ink-3">Closed</span>
    const urgent = r.stage === "needs_evidence" && daysUntil(r.d.dueBy) <= 2
    return (
      <span className="block whitespace-nowrap">
        <span className={cn("block", r.stage === "needs_evidence" ? (urgent ? "text-danger" : "text-acid") : "text-ink-2")}>{r.stage === "needs_evidence" ? dueLabel(r.d.dueBy) : "Submitted"}</span>
        <span className="block text-[11px] text-ink-3">{formatDate(r.d.dueBy)}</span>
      </span>
    )
  }

  const action = (r: Row) =>
    r.stage === "needs_evidence" ? (
      <Button
        type="button"
        size="xs"
        variant="secondary"
        onClick={() => {
          setCurrent(r.d)
          setDialogOpen(true)
        }}
      >
        <FileCheck2 /> Submit evidence
      </Button>
    ) : (
      <span className="text-[11px] whitespace-nowrap text-ink-3">{isOpen(r.stage) ? "With the provider" : r.stage === "won" ? "Funds returned" : "Funds debited"}</span>
    )

  const columns: Column<Row>[] = [
    {
      key: "ref",
      header: "Order",
      cell: (r) => (
        <Link href={`/admin/orders?order=${orderIdOf(r.d.id)}`} className="font-medium whitespace-nowrap text-ink tabular hover:text-violet">
          #{r.d.reference}
        </Link>
      ),
    },
    { key: "brand", header: "Brand", cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.d.brandName}</span> },
    {
      key: "reason",
      header: "Type and reason",
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{r.d.type === "chargeback" ? "Chargeback" : "Inquiry"}</span>
          <span className="block text-[11px] text-ink-3">{r.d.reason}</span>
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="whitespace-nowrap text-ink">{usd(r.d.amountUsd)}</span> },
    { key: "opened", header: "Opened", cell: (r) => <span className="whitespace-nowrap text-ink-2">{relDays(r.d.openedAt)}</span> },
    { key: "due", header: "Evidence due", cell: due },
    { key: "stage", header: "Stage", cell: (r) => <StatusBadge tone={disputeMeta[r.stage].tone}>{disputeMeta[r.stage].label}</StatusBadge> },
    { key: "action", header: "Next step", align: "right", cell: action },
  ]

  return (
    <>
      <TablePanel
        id="disputes-title"
        title="Disputes and chargebacks"
        description={`${plural(needs.length, "dispute")} need evidence, ${usd(exposure)} at stake. A dispute with no evidence by its due date is accepted and lost.`}
      >
        {rows.length ? (
          <AdminTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.d.id}
            caption="Disputes and chargebacks"
            minWidth={980}
            selectedKey={focus}
            rowClassName={(r) => r.stage === "needs_evidence" && "bg-acid/[0.03]"}
            mobileRow={(r) => ({
              title: (
                <>
                  <span className="tabular">#{r.d.reference}</span> <span className="text-ink-2">{r.d.brandName}</span>
                </>
              ),
              meta: `${r.d.type === "chargeback" ? "Chargeback" : "Inquiry"}, ${r.d.reason.toLowerCase()}`,
              trail: (
                <>
                  <span className="text-[13px] text-ink tabular">{usd(r.d.amountUsd)}</span>
                  <StatusBadge tone={disputeMeta[r.stage].tone}>{disputeMeta[r.stage].label}</StatusBadge>
                </>
              ),
              footer:
                r.stage === "needs_evidence" ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-[11px]", daysUntil(r.d.dueBy) <= 2 ? "text-danger" : "text-acid")}>{dueLabel(r.d.dueBy)}</span>
                    {action(r)}
                  </div>
                ) : undefined,
            })}
          />
        ) : (
          <EmptyState icon={Gavel} className="m-4" title="No disputes" body="Chargebacks and payment inquiries from the providers appear here with their deadlines." />
        )}
      </TablePanel>

      <EvidenceDialog dispute={current} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

function EvidenceDialog({ dispute, open, onOpenChange }: { dispute: Dispute | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-lg">{dispute ? <EvidenceForm key={`${dispute.id}-${String(open)}`} dispute={dispute} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  )
}

function EvidenceForm({ dispute, onDone }: { dispute: Dispute; onDone: () => void }) {
  const id = useId()
  const log = useAdmin((s) => s.log)
  const order = merchantOrders.find((o) => o.id === orderIdOf(dispute.id))
  const [items, setItems] = useState<string[]>(order?.tracking ? ["Proof of delivery", "Carrier tracking history"] : [])
  const [tracking, setTracking] = useState(order?.tracking ? `${order.tracking.carrier} ${order.tracking.number}` : "")
  const [summary, setSummary] = useState("")
  const [errors, setErrors] = useState<{ items?: string; summary?: string }>({})
  const [pending, setPending] = useState(false)

  function validate() {
    const e: typeof errors = {}
    if (!items.length) e.items = "Choose at least one piece of evidence."
    if (summary.trim().length < MIN_SUMMARY) e.summary = summary.trim() ? `Say a little more: at least ${MIN_SUMMARY} characters.` : "Summarise the case for the provider."
    return e
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (pending) return
    const e = validate()
    setErrors(e)
    if (e.items || e.summary) {
      document.getElementById(e.items ? `${id}-ev-0` : `${id}-summary`)?.focus()
      return
    }
    setPending(true)
    log(EVIDENCE_ACTION, `#${dispute.reference}`, `${items.join(", ")}${tracking.trim() ? ` (tracking ${tracking.trim()})` : ""}. ${summary.trim()}`)
    toast(`Evidence saved for #${dispute.reference}`, { description: "Sending it to the provider needs the payments backend, which isn't connected yet. Logged in the audit trail." })
    setPending(false)
    onDone()
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="pr-6 text-[15px] leading-snug">Submit evidence for #{dispute.reference}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          {dispute.type === "chargeback" ? "Chargeback" : "Inquiry"} for {usd(dispute.amountUsd)} from {dispute.brandName}: {dispute.reason.toLowerCase()}. {dueLabel(dispute.dueBy)}. Once sent, evidence can&apos;t be changed.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="grid gap-2" aria-describedby={errors.items ? `${id}-items-error` : undefined}>
        <legend className="mb-2 text-[13px] font-medium">Evidence included</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {EVIDENCE.map((label, i) => {
            const on = items.includes(label)
            return (
              <label key={label} htmlFor={`${id}-ev-${i}`} className={cn("flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-[12px] transition-colors", on ? "border-violet/40 bg-purple/10 text-ink" : "border-line text-ink-2 hover:text-ink")}>
                <Checkbox
                  id={`${id}-ev-${i}`}
                  checked={on}
                  aria-invalid={!!errors.items}
                  onCheckedChange={(c) => {
                    const next = c === true ? [...items, label] : items.filter((x) => x !== label)
                    setItems(next)
                    if (errors.items && next.length) setErrors({ ...errors, items: undefined })
                  }}
                />
                {label}
              </label>
            )
          })}
        </div>
        {errors.items ? (
          <p id={`${id}-items-error`} role="alert" className="text-xs text-danger">{errors.items}</p>
        ) : null}
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-tracking`} className="text-[13px]">Tracking reference</Label>
        <Input id={`${id}-tracking`} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Carrier and tracking number" className="h-9 rounded-md border-line bg-obsidian/40 text-[13px]" />
        <p className="text-[11px] text-ink-3">{order?.tracking ? "Filled in from the brand's shipment." : "No shipment on file for this order."}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-summary`} className="text-[13px]">Summary for the provider</Label>
        <Textarea
          id={`${id}-summary`}
          value={summary}
          onChange={(e) => {
            setSummary(e.target.value)
            if (errors.summary && e.target.value.trim().length >= MIN_SUMMARY) setErrors({ ...errors, summary: undefined })
          }}
          rows={4}
          aria-invalid={!!errors.summary}
          aria-describedby={errors.summary ? `${id}-summary-error` : `${id}-summary-hint`}
          placeholder="What happened, and how the evidence shows the charge was valid"
          className="min-h-24 rounded-md border-line bg-obsidian/40 text-[13px]"
        />
        {errors.summary ? (
          <p id={`${id}-summary-error`} role="alert" className="text-xs text-danger">{errors.summary}</p>
        ) : (
          <p id={`${id}-summary-hint`} className="text-[11px] text-ink-3">Recorded in the audit log as {adminUser.name}.</p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Submit evidence
        </Button>
      </DialogFooter>
    </form>
  )
}
