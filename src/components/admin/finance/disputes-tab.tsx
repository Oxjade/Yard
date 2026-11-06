"use client"

import { useId, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowSquareOutIcon, ClipboardTextIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, type Column, type RowAction } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Panel } from "@/components/admin/ui/panel"
import { useAsyncAction } from "@/hooks/use-async-action"
import { adminUser, type Dispute } from "@/lib/data/admin"
import { merchantOrders } from "@/lib/data/orders"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { currentOpener, focusBack } from "../marketplace/focus"
import { disputeStage, orderIdOf } from "./derive"
import { daysUntil, dueLabel, formatDate, plural, relDays, usd } from "./format"
import { disputeMeta, type DisputeStage } from "./meta"
import { FocusCallout, refLinkClass, writeParams } from "./table"

type Row = { d: Dispute; stage: DisputeStage }

const EVIDENCE = ["Proof of delivery", "Carrier tracking history", "Messages with the customer", "Product listing and photos", "Return and refund policy"] as const
const MIN_SUMMARY = 30
const isOpen = (s: DisputeStage) => s === "needs_evidence" || s === "evidence_submitted" || s === "under_review"
const rank: Record<DisputeStage, number> = { needs_evidence: 0, evidence_submitted: 1, under_review: 1, won: 2, lost: 2 }

/** Disputes and chargebacks, soonest evidence deadline first. Evidence is saved here; the provider decides. */
export function DisputesTab({ focus, ready }: { focus?: string | null; ready: boolean }) {
  const router = useRouter()
  const audit = useAdmin((s) => s.audit)
  const disputes = useAdmin((s) => s.disputes)
  const [current, setCurrent] = useState<Dispute | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const rows: Row[] = disputes.map((d) => ({ d, stage: disputeStage(d, audit) })).sort((a, b) => rank[a.stage] - rank[b.stage] || a.d.dueBy.localeCompare(b.d.dueBy))
  const needs = rows.filter((r) => r.stage === "needs_evidence")
  const exposure = rows.filter((r) => isOpen(r.stage)).reduce((s, r) => s + r.d.amountUsd, 0)
  const focused = focus ? rows.find((r) => r.d.id === focus) : undefined
  // The dialog has no Radix trigger, so it returns focus itself: to the control that opened it
  // (a row menu's trigger, the callout's button), else this panel's heading.
  const opener = useRef<HTMLElement | null>(null)
  const openEvidence = (d: Dispute) => {
    opener.current = currentOpener()
    setCurrent(d)
    setDialogOpen(true)
  }

  const due = (r: Row) => {
    if (!isOpen(r.stage)) return <span className="whitespace-nowrap text-ink-3">Closed</span>
    const urgent = r.stage === "needs_evidence" && daysUntil(r.d.dueBy) <= 2
    return (
      <span className="block whitespace-nowrap">
        <span className={cn("block", r.stage === "needs_evidence" ? (urgent ? "text-danger" : "text-acid") : "text-ink-2")}>{r.stage === "needs_evidence" ? dueLabel(r.d.dueBy) : r.stage === "evidence_submitted" ? "Saved, not sent" : "With the provider"}</span>
        <span className="block text-[11px] text-ink-3">{formatDate(r.d.dueBy)}</span>
      </span>
    )
  }

  const columns: Column<Row>[] = [
    {
      key: "ref",
      header: "Order",
      sortValue: (r) => r.d.reference,
      cell: (r) => (
        <span className="block min-w-0">
          <Link href={`/admin/orders?order=${orderIdOf(r.d.id)}`} className={refLinkClass}>
            #{r.d.reference}
          </Link>
          <span className="block max-w-[36vw] truncate text-[11.5px] text-ink-3 md:hidden">
            {r.d.brandName}
            <span className="sm:hidden">, {disputeMeta[r.stage].label.toLowerCase()}</span>
          </span>
        </span>
      ),
    },
    { key: "brand", header: "Brand", hideBelow: "md", sortValue: (r) => r.d.brandName, cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.d.brandName}</span> },
    {
      key: "reason",
      header: "Type and reason",
      hideBelow: "lg",
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span className="block text-ink">{r.d.type === "chargeback" ? "Chargeback" : "Inquiry"}</span>
          <span className="block text-[11px] text-ink-3">{r.d.reason}</span>
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", sortValue: (r) => r.d.amountUsd, cell: (r) => <span className="whitespace-nowrap text-ink">{usd(r.d.amountUsd)}</span> },
    { key: "opened", header: "Opened", hideBelow: "lg", sortValue: (r) => r.d.openedAt, cell: (r) => <span className="whitespace-nowrap text-ink-2">{relDays(r.d.openedAt)}</span> },
    { key: "due", header: "Evidence due", hideBelow: "md", sortValue: (r) => r.d.dueBy, cell: due },
    { key: "stage", header: "Stage", hideBelow: "sm", sortValue: (r) => rank[r.stage], cell: (r) => <StatusBadge tone={disputeMeta[r.stage].tone}>{disputeMeta[r.stage].label}</StatusBadge> },
  ]

  const rowActions: RowAction<Row>[] = [
    { label: "Add evidence", icon: ClipboardTextIcon, disabled: (r) => r.stage !== "needs_evidence", onSelect: (r) => openEvidence(r.d) },
    { label: "Open the order", icon: ArrowSquareOutIcon, separatorBefore: true, onSelect: (r) => router.push(`/admin/orders?order=${orderIdOf(r.d.id)}`) },
  ]

  return (
    <div className="grid gap-3">
      {focused ? (
        <FocusCallout
          title={`${focused.d.type === "chargeback" ? "Chargeback" : "Inquiry"} on #${focused.d.reference}, ${usd(focused.d.amountUsd)}`}
          badge={<StatusBadge tone={disputeMeta[focused.stage].tone}>{disputeMeta[focused.stage].label}</StatusBadge>}
          meta={`${focused.d.brandName}: ${focused.d.reason.toLowerCase()}. ${isOpen(focused.stage) ? `Evidence ${focused.stage === "needs_evidence" ? dueLabel(focused.d.dueBy).toLowerCase() : "saved"}.` : "Closed."}`}
          actions={focused.stage === "needs_evidence" ? <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => openEvidence(focused.d)}>Add evidence</Button> : null}
          onDismiss={() => writeParams({ focus: null })}
        />
      ) : null}

      <Panel title="Disputes and chargebacks" description={`${plural(needs.length, "dispute")} need evidence, ${usd(exposure)} at stake (amounts in USD). A dispute with no evidence by its due date is accepted and lost.`} className="rounded-[20px]" bodyClassName="px-3 sm:px-4 md:px-5">
        <DataTable label="Disputes and chargebacks" rows={rows} columns={columns} getId={(r) => r.d.id} loading={!ready} search={{ placeholder: "Order, brand or reason", text: (r) => `${r.d.reference} ${r.d.brandName} ${r.d.reason}` }} rowActions={rowActions} empty={{ title: "No disputes", body: "Chargebacks and payment inquiries from the providers appear here with their deadlines." }} minWidth={300} />
        <p className="mt-3 text-[11.5px] text-ink-3">Evidence is saved here and in the audit log. Sending it to the provider needs the payments backend, which isn&apos;t connected in this build.</p>
      </Panel>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className="gap-5 sm:max-w-lg"
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            focusBack(opener.current, () => document.getElementById("panel-disputes-and-chargebacks"))
          }}
        >{current ? <EvidenceForm key={`${current.id}-${String(dialogOpen)}`} dispute={current} onDone={() => setDialogOpen(false)} /> : null}</DialogContent>
      </Dialog>
    </div>
  )
}

function EvidenceForm({ dispute, onDone }: { dispute: Dispute; onDone: () => void }) {
  const id = useId()
  const submitEvidence = useAdmin((s) => s.submitDisputeEvidence)
  const order = merchantOrders.find((o) => o.id === orderIdOf(dispute.id))
  const [items, setItems] = useState<string[]>(order?.tracking ? ["Proof of delivery", "Carrier tracking history"] : [])
  const [tracking, setTracking] = useState(order?.tracking ? `${order.tracking.carrier} ${order.tracking.number}` : "")
  const [summary, setSummary] = useState("")
  const [errors, setErrors] = useState<{ items?: string; summary?: string }>({})
  const save = useAsyncAction(
    (note: string) => {
      submitEvidence(dispute.id, note)
      onDone()
    },
    { success: `Evidence saved for #${dispute.reference}`, successDescription: "Recorded in the audit log. It reaches the provider once the payments backend is connected." },
  )

  function validate() {
    const e: typeof errors = {}
    if (!items.length) e.items = "Choose at least one piece of evidence."
    if (summary.trim().length < MIN_SUMMARY) e.summary = summary.trim() ? `Say a little more: at least ${MIN_SUMMARY} characters (${summary.trim().length} so far).` : "Summarise the case for the provider."
    return e
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (save.pending) return
    const e = validate()
    setErrors(e)
    if (e.items || e.summary) {
      document.getElementById(e.items ? `${id}-ev-0` : `${id}-summary`)?.focus()
      return
    }
    void save.run(`${items.join(", ")}${tracking.trim() ? ` (tracking ${tracking.trim()})` : ""}. ${summary.trim()}`)
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="font-label pr-6 text-base leading-snug">Evidence for #{dispute.reference}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">
          {dispute.type === "chargeback" ? "Chargeback" : "Inquiry"} for {usd(dispute.amountUsd)} from {dispute.brandName}: {dispute.reason.toLowerCase()}. {dueLabel(dispute.dueBy)}. Saved here and in the audit log; sending it to the provider needs the payments backend, which isn&apos;t connected in this build.
        </DialogDescription>
      </DialogHeader>

      <fieldset className="grid gap-2" aria-describedby={errors.items ? `${id}-items-error` : undefined}>
        <legend className="mb-2 text-[13px] font-medium">
          Evidence included <span className="text-danger" aria-hidden>*</span>
          <span className="sr-only"> (required)</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {EVIDENCE.map((label, i) => {
            const on = items.includes(label)
            return (
              <label key={label} htmlFor={`${id}-ev-${i}`} className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-[12.5px] transition-colors duration-150", on ? "border-violet/40 bg-purple/10 text-ink" : "border-line text-ink-2 hover:text-ink")}>
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
        {errors.items ? <p id={`${id}-items-error`} role="alert" className="text-xs text-danger">{errors.items}</p> : null}
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-tracking`} className="text-[13px]">Tracking reference</Label>
        <Input id={`${id}-tracking`} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Carrier and tracking number" aria-describedby={`${id}-tracking-hint`} className="h-10 rounded-md border-line bg-obsidian/40 text-[13px]" />
        <p id={`${id}-tracking-hint`} className="text-[11px] text-ink-3">{order?.tracking ? "Filled in from the brand's shipment." : "Optional. No shipment on file for this order."}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-summary`} className="text-[13px]">
          Summary for the provider <span className="text-danger" aria-hidden>*</span>
          <span className="sr-only"> (required)</span>
        </Label>
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
          <p id={`${id}-summary-hint`} className="text-[11px] text-ink-3">At least {MIN_SUMMARY} characters. Recorded in the audit log as {adminUser.name}.</p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={save.pending}>Cancel</Button>
        <Button type="submit" variant="primary" loading={save.pending}>Save evidence</Button>
      </DialogFooter>
    </form>
  )
}
