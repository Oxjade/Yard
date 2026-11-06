"use client"

import { useMemo, useRef, useState } from "react"
import { ArrowLineDownIcon as ArrowDownToLine, CheckIcon as Check, CopyIcon as Copy, BankIcon as Landmark, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { InfoTip } from "@/components/feedback/info-tip"
import { MetricRowSkeleton } from "@/components/feedback/skeletons"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useHydrated } from "@/hooks/use-hydrated"
import { brandById } from "@/lib/data/brands"
import { convert, formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useStudio } from "@/lib/stores/studio"
import { PAYOUT_HOLD_DAYS, payoutBalances } from "@/lib/payouts"
import type { Payout } from "@/lib/data/admin"

const HOLD_DAYS = PAYOUT_HOLD_DAYS

const payoutTone: Record<Payout["status"], { label: string; tone: "muted" | "info" | "attention" | "success" | "danger" }> = {
  awaiting_approval: { label: "Under review", tone: "attention" },
  scheduled: { label: "Scheduled", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  paid: { label: "Completed", tone: "success" },
  held: { label: "On hold", tone: "danger" },
}

function CopyRef({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        } catch {
          toast.error("Couldn't copy. Select the reference and copy it manually.")
        }
      }}
      className="group inline-flex items-center gap-1.5 rounded px-1 font-medium whitespace-nowrap text-ink tabular transition-colors hover:text-violet"
      aria-label={`Copy reference ${value}`}
    >
      {value}
      {copied ? <Check className="size-3.5 text-violet" /> : <Copy className="size-3.5 opacity-0 transition-opacity group-hover:opacity-70" />}
    </button>
  )
}

export default function StudioPayoutsPage() {
  const hydrated = useHydrated()
  const brandId = useStudio((s) => s.brandId)
  const orders = useStudio((s) => s.orders)
  const payouts = useAdmin((s) => s.payouts)
  const brand = brandById.get(brandId)!
  const cur = brand.currency
  const mine = payouts.filter((p) => p.brandId === brandId)

  // Shared with the Studio sidebar card, so the two figures can never disagree.
  const balances = useMemo(() => payoutBalances(orders, payouts, brandId, cur), [orders, payouts, brandId, cur])

  // Request flow
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [step, setStep] = useState<"form" | "confirm">("form")
  const [touched, setTouched] = useState(false)
  const key = useRef<string | null>(null)
  const minor = 100
  const amountMinor = Math.round(Number(amount.replace(/,/g, "")) * minor)
  const fee = 0
  const amountError = !amount ? "Enter an amount." : !Number.isFinite(amountMinor) || amountMinor <= 0 ? "Enter an amount above zero." : amountMinor > balances.available ? `You can request up to ${formatMoney(balances.available, cur)}.` : null
  const destination = brand.country === "NG" ? "Paystack transfer to GTBank •••• 4821" : "Bank transfer •••• 4821"

  const request = useAsyncAction(
    () => {
      if (!key.current) key.current = `po_req_${brand.handle}_${Date.now().toString(36)}`
      const id = key.current
      const state = useAdmin.getState()
      if (state.payouts.some((p) => p.id === id)) return id // idempotent: a repeat submit returns the same request
      useAdmin.setState({
        payouts: [{ id, brandName: brand.name, brandId, amountUsd: convert(amountMinor, cur, "USD"), currency: cur, scheduledFor: new Date().toISOString(), status: "awaiting_approval", method: destination.split(" to ")[0], orders: 0 }, ...state.payouts],
      })
      state.log("Payout requested by brand", `${brand.name}, ${formatMoney(amountMinor, cur)}`, "Requested from Brand Studio")
      return id
    },
    {
      success: "Payout requested",
      successDescription: "It's under review by the platform team. Nothing moves until the provider confirms the transfer.",
      onSuccess: () => {
        setOpen(false)
        setStep("form")
        setAmount("")
        setTouched(false)
        key.current = null
      },
    },
  )

  const columns: Column<Payout>[] = [
    { key: "ref", header: "Reference", cell: (p) => <CopyRef value={p.id.replace(/^po_/, "PO-").toUpperCase().slice(0, 22)} /> },
    { key: "amount", header: "Amount", align: "right", sortValue: (p) => p.amountUsd, cell: (p) => formatMoney(convert(p.amountUsd, "USD", cur), cur) },
    { key: "status", header: "Status", sortValue: (p) => p.status, cell: (p) => <StatusBadge tone={payoutTone[p.status].tone}>{payoutTone[p.status].label}</StatusBadge> },
    { key: "method", header: "Destination", hideBelow: "md", cell: (p) => <span className="text-ink-2">{p.method}</span> },
    { key: "date", header: "Date", sortValue: (p) => p.scheduledFor, hideBelow: "sm", cell: (p) => <span className="whitespace-nowrap text-ink-2 tabular">{new Date(p.scheduledFor).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span> },
    { key: "note", header: "Note", hideBelow: "lg", cell: (p) => <span className="text-ink-3">{p.holdReason ?? (p.status === "processing" ? "Completes when the provider confirms the transfer" : p.status === "awaiting_approval" ? "Waiting for platform review" : "")}</span> },
  ]

  const tiles = [
    { label: "Available to pay out", value: balances.available, tip: `Delivered orders older than ${HOLD_DAYS} days, after the 5% commission, minus payouts already requested.`, primary: true },
    { label: "Pending", value: balances.pending, tip: `Orders not yet delivered, or delivered less than ${HOLD_DAYS} days ago (the returns window).` },
    { label: "Under review", value: balances.inReview, tip: "Requested payouts waiting for the platform team, or on hold with a reason." },
    { label: "Processing", value: balances.processing, tip: "Approved and sent to the payment provider. Marked completed only when the provider confirms." },
    { label: "Paid out", value: balances.paid, tip: "Transfers the provider has confirmed." },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Payouts"
        description={`Your earnings in ${cur}, after the 5% commission. Payouts go to your verified account.`}
        actions={
          <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={!hydrated || balances.available <= 0}>
            <ArrowDownToLine /> Request payout
          </Button>
        }
      >
        <SampleDataNote className="mt-3" />
      </PageHeader>

      {!hydrated ? (
        <MetricRowSkeleton count={5} />
      ) : (
        <section aria-label="Balances" className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {tiles.map((t) => (
            <div key={t.label} className={`rounded-lg border bg-card p-4 ${t.primary ? "border-acid/30 md:col-span-1" : "border-line-soft"}`}>
              <p className="flex items-center gap-1 text-xs text-ink-2">
                {t.label}
                <InfoTip>{t.tip}</InfoTip>
              </p>
              <p className={`mt-2 font-medium tracking-tight tabular ${t.primary ? "text-2xl text-ink" : "text-xl text-ink"}`}>{formatMoney(t.value, cur)}</p>
            </div>
          ))}
        </section>
      )}

      <section className="grid gap-3 rounded-lg border border-line-soft bg-card p-4 md:grid-cols-[1fr_auto] md:items-center md:p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line"><Landmark className="size-4 text-ink-2" /></span>
          <div>
            <h2 className="text-sm font-medium text-ink">Payout destination</h2>
            <p className="mt-0.5 text-sm text-ink-2">{destination}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-3"><ShieldCheck className="size-3.5 text-violet" /> Verified. Changing it requires re-authentication and a 48-hour cooldown.</p>
          </div>
        </div>
        <p className="max-w-sm text-xs text-ink-3 md:text-right">Backend phase: requests are sent through the payment provider&apos;s transfer API and confirmed by its webhook. In this build they stop at review.</p>
      </section>

      <section aria-labelledby="history-title" className="grid gap-3">
        <h2 id="history-title" className="text-sm font-medium text-ink">Payout history</h2>
        <DataTable
          label="Payout history"
          rows={hydrated ? mine : []}
          loading={!hydrated}
          columns={columns}
          getId={(p) => p.id}
          initialSort={{ key: "date", dir: "desc" }}
          minWidth={640}
          empty={{ title: "No payouts yet", body: "When delivered orders clear the returns window, you can request your first payout." }}
        />
      </section>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (request.pending) return
          setOpen(o)
          if (!o) {
            setStep("form")
            setTouched(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          {step === "form" ? (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                setTouched(true)
                if (!amountError) setStep("confirm")
              }}
              className="grid gap-4"
            >
              <DialogHeader>
                <DialogTitle>Request a payout</DialogTitle>
                <DialogDescription>Available now: {formatMoney(balances.available, cur)}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor="payout-amount">Amount ({cur})</Label>
                <div className="flex gap-2">
                  <Input id="payout-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && !!amountError} aria-describedby="payout-amount-msg" autoFocus />
                  <Button type="button" variant="secondary" onClick={() => setAmount(String(balances.available / minor))}>Max</Button>
                </div>
                <p id="payout-amount-msg" className={touched && amountError ? "text-xs text-danger" : "text-xs text-ink-3"}>{touched && amountError ? amountError : "Payouts have no fee from us. Your bank may charge to receive."}</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Review</Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Confirm payout request</DialogTitle>
                <DialogDescription>Check the details. A request can&apos;t be edited once submitted.</DialogDescription>
              </DialogHeader>
              <dl className="grid gap-2 rounded-lg border border-white/10 p-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-ink-2">Amount</dt><dd className="tabular text-ink">{formatMoney(amountMinor, cur)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-ink-2">Fee</dt><dd className="tabular text-ink">{formatMoney(fee, cur)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-ink-2">You receive</dt><dd className="tabular font-medium text-ink">{formatMoney(amountMinor - fee, cur)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-ink-2">To</dt><dd className="text-right text-ink">{destination}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-ink-2">Next step</dt><dd className="text-right text-ink-2">Platform review, then the provider transfers it</dd></div>
              </dl>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setStep("form")} disabled={request.pending}>Back</Button>
                <Button type="button" variant="primary" onClick={() => request.run()} loading={request.pending} success={request.succeeded}>Submit request</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
