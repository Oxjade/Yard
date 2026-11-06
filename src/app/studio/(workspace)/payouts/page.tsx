"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLineDownIcon as ArrowDownToLine, CheckIcon as Check, ClockIcon as Clock, CopyIcon as Copy, BankIcon as Landmark, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import { DisabledReason, InfoTip } from "@/components/feedback/info-tip"
import { Bone } from "@/components/feedback/skeletons"
import { providerLabel } from "@/components/studio/business/settings-model"
import { accountOnFile, useBrandSettings, useSettingsReady, type PayoutAccount } from "@/components/studio/business/settings-store"
import { useFocusReturn, useStudioReady } from "@/components/studio/business/shared"
import { PayoutTilesSkeleton, payoutTileGrid, payoutTilePrimary } from "@/components/studio/business/skeletons"
import { currencies } from "@/config/markets"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useHydrated } from "@/hooks/use-hydrated"
import { brandById } from "@/lib/data/brands"
import { formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useNotifications } from "@/lib/stores/notifications"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { PAYOUT_HOLD_DAYS, payoutBalances } from "@/lib/payouts"
import { payoutAmountIn, type Payout } from "@/lib/data/admin"

const HOLD_DAYS = PAYOUT_HOLD_DAYS

/** "Paystack to GTBank •••• 4821" */
const accountText = (a: PayoutAccount) => `${providerLabel[a.provider]} to ${a.bankName} •••• ${a.last4}`

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })

/**
 * Phones: the history's only column (no checkbox or row menu), so it takes the table's whole
 * width: the viewport minus the page gutters, the table border and the cell padding.
 */
const historyCell = "block w-[calc(100vw-5rem)] max-w-[24rem] md:w-auto md:max-w-none"

/**
 * A short reference that stays unique: a request's id ends in its own time code
 * (po_req_<brand>_<time>), so that tail is the reference; seeded payouts keep their name.
 */
function payoutRef(id: string) {
  const req = /^po_req_.+_([a-z0-9]+)$/.exec(id)
  return req ? `PO-${req[1].toUpperCase()}` : id.replace(/^po_/, "PO-").toUpperCase()
}

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
  // Balances come from saved orders and the destination from saved settings: wait for both.
  const mounted = useHydrated()
  const studioReady = useStudioReady()
  const settingsReady = useSettingsReady()
  const hydrated = mounted && studioReady && settingsReady
  const saved = useBrandSettings((s) => s.payout.account)
  const brandId = useStudio((s) => s.brandId)
  const orders = useStudio((s) => s.orders)
  const payouts = useAdmin((s) => s.payouts)
  const audit = useAdmin((s) => s.audit)
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
  const minor = 10 ** currencies[cur].minor
  const amountMinor = Math.round(Number(amount.replace(/,/g, "")) * minor)
  const fee = 0
  const amountError = !amount ? "Enter an amount." : !Number.isFinite(amountMinor) || amountMinor <= 0 ? "Enter an amount above zero." : amountMinor > balances.available ? `You can request up to ${formatMoney(balances.available, cur)}.` : null
  // Payouts go to the verified account. A change saved in Settings stays pending until the
  // provider verifies it (backend phase), and until then payouts keep going to the account on file.
  const onFile = saved.status === "verified" ? saved : accountOnFile()
  const pendingChange = saved.status === "pending" ? saved : null
  const destination = accountText(onFile)

  const request = useAsyncAction(
    () => {
      if (!key.current) key.current = `po_req_${brand.handle}_${Date.now().toString(36)}`
      const id = key.current
      // The exact amount the brand confirmed, in its own currency; idempotent, so a repeat submit
      // returns the same request.
      // The method reads as the platform's other payouts do ("Paystack transfer").
      const label = providerLabel[onFile.provider]
      const method = /transfer$/i.test(label) ? label : `${label} transfer`
      if (!useAdmin.getState().requestPayout({ id, brandId, brandName: brand.name, amount: amountMinor, currency: cur, method, orders: balances.eligibleOrders })) return id
      const at = new Date().toISOString()
      // The platform team hears about it; the key is the request, so a repeat never notifies twice.
      useNotifications.getState().push({
        eventKey: `a:payout:${id}:requested`,
        audience: "admin",
        category: "payout_status",
        title: `Payout requested: ${brand.name}`,
        body: `${formatMoney(amountMinor, cur)} to ${destination}, ${payoutRef(id)}. Waiting for platform review.`,
        href: "/admin/finance?tab=payouts",
        at,
      })
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

  // After a request the opener is replaced by its disabled twin, so focus lands on the history.
  const focus = useFocusReturn(() => document.getElementById("history-title"))

  // The exact amount in the brand's currency (what it requested), converted only for older records.
  const amountOf = (p: Payout) => payoutAmountIn(p, cur)
  // Approved in this browser: the decision is recorded, but nothing is sent (no provider connected).
  const approvedHere = (p: Payout) => p.status === "processing" && audit.some((a) => a.subjectId === p.id && a.action === "Approved payout")
  const statusOf = (p: Payout) => (approvedHere(p) ? { label: "Approved", tone: "info" as const } : payoutTone[p.status])
  const noteOf = (p: Payout) =>
    p.holdReason ?? (approvedHere(p) ? "Approval recorded. Sent once a payment provider is connected" : p.status === "processing" ? "Completes when the provider confirms the transfer" : p.status === "awaiting_approval" ? "Waiting for platform review" : "")
  const columns: Column<Payout>[] = [
    {
      key: "ref",
      header: "Reference",
      cell: (p) => (
        <div className={historyCell}>
          <div className="flex items-baseline justify-between gap-3">
            <CopyRef value={payoutRef(p.id)} />
            <span className="text-sm whitespace-nowrap text-ink tabular md:hidden">{formatMoney(amountOf(p), cur)}</span>
          </div>
          {/* Phones: amount, status and date fold into the first cell. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
            <StatusBadge tone={statusOf(p).tone}>{statusOf(p).label}</StatusBadge>
            <span className="text-xs text-ink-2 tabular">{dateFmt.format(new Date(p.scheduledFor))}</span>
          </span>
          {noteOf(p) ? <span className="mt-1 block truncate text-xs text-ink-3 md:hidden">{noteOf(p)}</span> : null}
        </div>
      ),
    },
    { key: "amount", header: "Amount", align: "right", sortValue: (p) => amountOf(p), hideBelow: "md", cell: (p) => <span className="whitespace-nowrap text-ink">{formatMoney(amountOf(p), cur)}</span> },
    { key: "status", header: "Status", sortValue: (p) => statusOf(p).label, hideBelow: "md", cell: (p) => <StatusBadge tone={statusOf(p).tone}>{statusOf(p).label}</StatusBadge> },
    { key: "method", header: "Destination", hideBelow: "lg", cell: (p) => <span className="text-ink-2">{p.method}</span> },
    { key: "date", header: "Date", sortValue: (p) => p.scheduledFor, hideBelow: "md", cell: (p) => <span className="whitespace-nowrap text-ink-2 tabular">{dateFmt.format(new Date(p.scheduledFor))}</span> },
    { key: "note", header: "Note", hideBelow: "lg", cell: (p) => <span className="text-ink-3">{noteOf(p)}</span> },
  ]

  const tiles = [
    { label: "Available to pay out", value: balances.available, tip: `Delivered orders older than ${HOLD_DAYS} days, after the 5% commission and any partial refunds, minus payouts already requested.`, primary: true },
    { label: "Pending", value: balances.pending, tip: `Orders not yet delivered, delivered less than ${HOLD_DAYS} days ago (the returns window), and orders with a return being decided.` },
    { label: "Under review", value: balances.inReview, tip: "Requested payouts waiting for the platform team, or on hold with a reason." },
    { label: "Approved", value: balances.processing, tip: "Approved or scheduled by the platform team. Nothing is sent until a payment provider is connected, and it's marked completed only when the provider confirms." },
    { label: "Paid out", value: balances.paid, tip: "Transfers the provider has confirmed." },
  ]

  // Why Request payout is off: everything may already be requested, or nothing has cleared yet.
  const disabledReason =
    balances.inReview + balances.processing > 0
      ? `Your available balance is already requested. New earnings become available ${HOLD_DAYS} days after delivery.`
      : `Nothing is available yet. Delivered orders become available ${HOLD_DAYS} days after delivery, once the returns window closes.`

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Payouts"
        description={`Your earnings in ${cur}, after the 5% commission. Payouts go to your verified account.`}
        actions={
          hydrated && balances.available <= 0 ? (
            <DisabledReason reason={disabledReason}>
              <Button variant="primary" size="sm" disabled>
                <ArrowDownToLine /> Request payout
              </Button>
            </DisabledReason>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={!hydrated}>
              <ArrowDownToLine /> Request payout
            </Button>
          )
        }
      >
        <SampleDataNote className="mt-3" />
      </PageHeader>

      {!hydrated ? (
        <PayoutTilesSkeleton />
      ) : (
        <section aria-label="Balances" className={payoutTileGrid}>
          {/* Money is shown as it stands: no count-up, so nothing looks like it's moving. */}
          {tiles.map((t) => (
            <div key={t.label} className={cn(surfaceClass, "flex min-w-0 flex-col p-4 md:p-5", t.primary && payoutTilePrimary)}>
              <h3 className="font-label flex min-w-0 items-center gap-1 text-[11px] tracking-[0.07em] text-ink-3 uppercase sm:tracking-[0.1em]">
                <span className="truncate">{t.label}</span>
                <InfoTip label={`About ${t.label.toLowerCase()}`} className="relative shrink-0 normal-case after:absolute after:-inset-2.5">{t.tip}</InfoTip>
              </h3>
              <p className={cn("mt-4 truncate font-metric leading-none text-ink tabular", t.primary ? "text-[2.25rem] md:text-[2.5rem] xl:text-[3rem]" : "text-[1.75rem] md:text-[2rem]")}>{formatMoney(t.value, cur)}</p>
              {t.primary ? <p className="mt-auto hidden pt-4 text-xs text-ink-3 xl:block">{t.tip}</p> : null}
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="destination-title" className="grid gap-3 rounded-lg border border-line-soft bg-card p-4 md:grid-cols-[1fr_auto] md:items-center md:p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line"><Landmark className="size-4 text-ink-2" /></span>
          <div className="min-w-0">
            <h2 id="destination-title" className="text-sm font-medium text-ink">Payout destination</h2>
            {hydrated ? (
              <>
                <p className="mt-0.5 text-sm text-ink-2">{destination}</p>
                <p className="mt-1 text-xs text-ink-3">{onFile.accountName}</p>
                {pendingChange ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-2">
                    <Clock className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                    <span>
                      A change to {accountText(pendingChange)} is saved in Settings and waits for the provider to verify it, which needs the backend. Until then payouts keep going here.
                    </span>
                  </p>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3"><ShieldCheck className="size-3.5 text-violet" /> Verified</p>
                )}
              </>
            ) : (
              <span aria-hidden className="mt-1.5 grid gap-1.5">
                <Bone className="h-3.5 w-56" />
                <Bone className="h-3 w-40" />
              </span>
            )}
          </div>
        </div>
        <div className="grid gap-2 md:justify-items-end">
          <Button asChild variant="secondary" size="sm" className="w-fit">
            <Link href="/studio/settings#payouts">Change in Settings</Link>
          </Button>
          <p className="max-w-sm text-xs text-ink-3 md:text-right">Requests stop at platform review in this build. With the backend connected they go through the provider&apos;s transfer API and complete when its webhook confirms.</p>
        </div>
      </section>

      <section aria-labelledby="history-title" className="grid gap-3">
        <h2 id="history-title" tabIndex={-1} className="text-sm font-medium text-ink outline-none">Payout history</h2>
        <DataTable
          label="Payout history"
          rows={hydrated ? mine : []}
          loading={!hydrated}
          columns={columns}
          getId={(p) => p.id}
          initialSort={{ key: "date", dir: "desc" }}
          minWidth={300}
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
        <DialogContent className="sm:max-w-[440px]" {...focus}>
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
                  <Input id="payout-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && !!amountError} aria-describedby="payout-amount-msg" />
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
