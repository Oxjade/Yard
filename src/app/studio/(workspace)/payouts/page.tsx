"use client"

import { useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLineDownIcon as ArrowDownToLine, CheckIcon as Check, ClockIcon as Clock, CopyIcon as Copy, BankIcon as Landmark, ShieldCheckIcon as ShieldCheck, XIcon as X } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { CountUp } from "@/components/dashboard/insight/count-up"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import { DisabledReason, InfoTip } from "@/components/feedback/info-tip"
import { Bone } from "@/components/feedback/skeletons"
import { ConfirmDialog } from "@/components/studio/catalog/fields"
import { providerLabel } from "@/components/studio/business/settings-model"
import { accountOnFile, useBrandSettings, useSettingsReady, type PayoutAccount } from "@/components/studio/business/settings-store"
import { useFocusReturn, useStudioReady } from "@/components/studio/business/shared"
import { PayoutTilesSkeleton, payoutTileGrid, payoutTilePrimary } from "@/components/studio/business/skeletons"
import { currencies, type CurrencyCode } from "@/config/markets"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useHydrated } from "@/hooks/use-hydrated"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import type { PayoutDto, PayoutSummaryDto } from "@/lib/api/contracts/payouts"
import { useApi } from "@/lib/api/use-api"
import { brandById } from "@/lib/data/brands"
import { hash } from "@/lib/data/seed"
import { payoutAmountIn, type Payout as AdminPayout } from "@/lib/data/admin"
import { formatMoney } from "@/lib/money"
import { useRealtimeEventName } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"
import { useAdmin } from "@/lib/stores/admin"
import { useNotifications } from "@/lib/stores/notifications"
import { useStudio } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { PAYOUT_HOLD_DAYS, payoutBalances, payoutBlockedReason } from "@/lib/payouts"

const HOLD_DAYS = PAYOUT_HOLD_DAYS

type Tone = "muted" | "info" | "attention" | "success" | "danger"

type PayoutItem = {
  id: string
  amountMinor: number
  currency: CurrencyCode
  status: string
  timestamp: string
  destination: string
  note: string
  cancellable: boolean
  meta: { label: string; tone: Tone }
}

/** "Paystack to GTBank •••• 4821" */
const accountText = (a: PayoutAccount) => `${providerLabel[a.provider]} to ${a.bankName} •••• ${a.last4}`

const liveAccountText = (a: NonNullable<PayoutSummaryDto["account"]>) =>
  `${a.recipientProvider === "paystack" ? "Paystack" : "Test provider"} to ${a.bankName} •••• ${a.accountLast4}`

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })

/**
 * Phones: the history's only column (no checkbox or row menu), so it takes the table's whole
 * width: the viewport minus the page gutters, the table border and the cell padding.
 */
const historyCell = "block w-[calc(100vw-5rem)] max-w-[24rem] md:w-auto md:max-w-none"

/**
 * A short reference that stays unique: a request's id ends in its own time code
 * (po_req_<brand>_<time>), so that tail is the reference. A server payout's id is a random
 * code, so its reference is a stable code made from the id, in the same shape: every row
 * reads like a transfer reference.
 */
function payoutRef(id: string) {
  const req = /^po_req_.+_([a-z0-9]+)$/.exec(id)
  return `PO-${(req ? req[1] : hash(id).toString(36).padStart(8, "0").slice(-8)).toUpperCase()}`
}

const payoutTone: Record<AdminPayout["status"], { label: string; tone: Tone }> = {
  awaiting_approval: { label: "Under review", tone: "attention" },
  scheduled: { label: "Scheduled", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  paid: { label: "Completed", tone: "success" },
  held: { label: "On hold", tone: "danger" },
}

function livePayoutMeta(status: string): { label: string; tone: Tone } {
  if (status === "requested" || status === "awaiting_second_approval") return { label: "Under review", tone: "attention" }
  if (status === "approved") return { label: "Approved", tone: "info" }
  if (status === "sending" || status === "processing") return { label: "Processing", tone: "info" }
  if (status === "paid") return { label: "Completed", tone: "success" }
  if (status === "failed") return { label: "Failed", tone: "danger" }
  if (status === "rejected") return { label: "Rejected", tone: "danger" }
  return { label: "Cancelled", tone: "muted" }
}

function livePayoutNote(p: PayoutDto) {
  if (p.status === "failed") return p.lastError ?? "The transfer failed. The amount returned to available."
  if (p.status === "rejected") return p.rejectReason ?? "The platform team rejected this request. The amount returned to available."
  if (p.status === "cancelled") return "Cancelled. The amount returned to available."
  if (p.status === "requested") return "Waiting for platform review."
  if (p.status === "awaiting_second_approval") return "Waiting for a second platform approval."
  if (p.status === "approved") return "Approved. Waiting to be included in a transfer batch."
  if (p.status === "sending" || p.status === "processing") return p.stubRecipient ? "Test transfer in progress; no money moves." : "Completes when the payment provider confirms the transfer."
  if (p.status === "paid") return p.stubRecipient ? "Test transfer completed; no money moved." : p.providerRef ? `Provider reference ${p.providerRef}.` : "Transfer confirmed by the payment provider."
  return p.stubRecipient ? "Test payout; no money moves." : ""
}

function payoutTimestamp(p: PayoutDto) {
  return p.paidAt ?? p.failedAt ?? p.closedAt ?? p.sentAt ?? p.approvedAt ?? p.requestedAt
}

function money(amountMinor: number, currency: string) {
  return formatMoney(amountMinor, (currency in currencies ? currency : "USD") as CurrencyCode)
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
  const session = useServerSession()
  const member = session.brand
  const live = !!member && !member.demo

  const summary = useApi<PayoutSummaryDto>(live && member ? `studio.payouts:${member.brand.id}` : null, () => api<PayoutSummaryDto>("/api/studio/payouts"), {
    revalidateOnFocus: true,
    keepPrevious: false,
  })
  useRealtimeEventName("payout.updated", () => {
    if (live) void summary.revalidate()
  })

  // The browser sample remains the demo brand's payouts; a real brand reads the ledger.
  const mounted = useHydrated()
  const studioReady = useStudioReady()
  const settingsReady = useSettingsReady()
  const demoHydrated = mounted && studioReady && settingsReady
  const saved = useBrandSettings((s) => s.payout.account)
  const demoBrandId = useStudio((s) => s.brandId)
  const demoOrders = useStudio((s) => s.orders)
  const demoPayouts = useAdmin((s) => s.payouts)
  const demoAudit = useAdmin((s) => s.audit)
  const demoBrand = brandById.get(demoBrandId)!

  const summaryCurrency = summary.data?.currency
  const cur: CurrencyCode = summaryCurrency && summaryCurrency in currencies ? (summaryCurrency as CurrencyCode) : demoBrand.currency
  const minor = 10 ** currencies[cur].minor

  const hydrated = live ? !!summary.data : demoHydrated
  /** The first read failed: the alert says so, and nothing below stays in a loading state. */
  const liveFailed = live && !summary.data && !!summary.error
  // Only the balance in the payout currency: another currency's row would be shown and validated under the wrong label.
  const liveBalance = summary.data?.balances.find((b) => b.currency === cur)
  const otherCurrencyEarnings = live && !liveBalance ? (summary.data?.balances.find((b) => b.availableMinor > 0 || b.pendingMinor > 0)?.currency ?? null) : null
  const liveAccount = summary.data?.account ?? null
  const rules = summary.data?.rules
  const demoBalances = useMemo(() => payoutBalances(demoOrders, demoPayouts, demoBrandId, demoBrand.currency), [demoOrders, demoPayouts, demoBrandId, demoBrand.currency])
  const availableMinor = live ? Math.max(0, liveBalance?.availableMinor ?? 0) : demoBalances.available
  const minPayoutMinor = live ? rules?.minPayoutMinor ?? 0 : 0
  const commissionPct = (rules ? rules.commissionBps / 100 : 5).toFixed(rules && rules.commissionBps % 100 ? 2 : 0)
  const error = live && summary.error ? errorMessage(summary.error, "Couldn't load your payouts.") : null

  // Demo payouts pay into the account on file; a change saved in Settings waits for the provider.
  const onFile = saved.status === "verified" ? saved : accountOnFile()
  const pendingChange = saved.status === "pending" ? saved : null
  const destination = live ? (liveAccount ? liveAccountText(liveAccount) : "No payout account yet") : accountText(onFile)

  // Request flow
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState("")
  const [step, setStep] = useState<"form" | "confirm">("form")
  const [touched, setTouched] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<PayoutItem | null>(null)
  const key = useRef<{ amountMinor: number; key: string } | null>(null)
  const amountMinor = Math.round(Number(amount.replace(/,/g, "")) * minor)
  const amountError = !amount
    ? "Enter an amount."
    : !Number.isFinite(amountMinor) || amountMinor <= 0
      ? "Enter an amount above zero."
      : live && minPayoutMinor && amountMinor < minPayoutMinor
        ? `The minimum payout is ${formatMoney(minPayoutMinor, cur)}.`
        : amountMinor > availableMinor
          ? `You can request up to ${formatMoney(availableMinor, cur)}.`
          : null

  const blockedReason = live
    ? payoutBlockedReason({
        hasSummary: !!summary.data,
        failed: !!summary.error,
        onHold: rules?.onHold ?? false,
        holdReason: rules?.holdReason ?? null,
        hasAccount: !!liveAccount,
        cooldownUntil: rules?.cooldownUntil ?? null,
        otherCurrency: otherCurrencyEarnings,
        availableMinor,
        minimumMinor: minPayoutMinor,
        currency: cur,
      })
    : availableMinor <= 0
      ? demoBalances.inReview + demoBalances.processing > 0
        ? `Your available balance is already requested. New earnings become available ${HOLD_DAYS} days after delivery.`
        : `Nothing is available yet. Delivered orders become available ${HOLD_DAYS} days after delivery, once the returns window closes.`
      : null

  const request = useAsyncAction(
    async () => {
      if (!key.current || key.current.amountMinor !== amountMinor) {
        key.current = { amountMinor, key: live ? `payout_${crypto.randomUUID()}` : `po_req_${demoBrand.handle}_${Date.now().toString(36)}` }
      }
      if (live) {
        const result = await api<{ payout: PayoutDto }>("/api/studio/payouts", {
          method: "POST",
          body: { amountMinor, currency: cur, idempotencyKey: key.current.key },
        })
        await summary.revalidate()
        return result.payout
      }
      const id = key.current.key
      const label = providerLabel[onFile.provider]
      const method = /transfer$/i.test(label) ? label : `${label} transfer`
      if (!useAdmin.getState().requestPayout({ id, brandId: demoBrandId, brandName: demoBrand.name, amount: amountMinor, currency: cur, method, orders: demoBalances.eligibleOrders })) return id
      useNotifications.getState().push({
        eventKey: `a:payout:${id}:requested`,
        audience: "admin",
        category: "payout_status",
        title: `Payout requested: ${demoBrand.name}`,
        body: `${formatMoney(amountMinor, cur)} to ${destination}, ${payoutRef(id)}. Waiting for platform review.`,
        href: "/admin/finance?tab=payouts",
        at: new Date().toISOString(),
      })
      return id
    },
    {
      success: "Payout requested",
      successDescription: live && liveAccount?.recipientProvider === "stub" ? "It's under review. This test account moves no money." : "It's under review by the platform team. Nothing moves until the provider confirms the transfer.",
      // The server's reason (balance changed, cooldown, hold, minimum, rate limit) replaces the generic message.
      errorToast: false,
      onError: (cause) => {
        toast.error("Your payout wasn't requested", { description: errorMessage(cause) })
        if (live) void summary.revalidate()
      },
      onSuccess: () => {
        setOpen(false)
        setStep("form")
        setAmount("")
        setTouched(false)
        key.current = null
      },
    },
  )

  const cancel = useAsyncAction(
    async () => {
      if (!cancelTarget || !live) return
      await api(`/api/studio/payouts/${encodeURIComponent(cancelTarget.id)}/cancel`, { method: "POST" })
      await summary.revalidate()
      setCancelTarget(null)
    },
    {
      success: "Payout request cancelled",
      successDescription: "The amount is back in your available balance.",
      errorToast: false,
      onError: (cause) => {
        toast.error("This request wasn't cancelled", { description: errorMessage(cause) })
        void summary.revalidate()
      },
    },
  )

  // After a request the opener is replaced by its disabled twin, so focus lands on the history.
  const focus = useFocusReturn(() => document.getElementById("history-title"))

  const liveItems: PayoutItem[] = useMemo(() => {
    if (!summary.data) return []
    return summary.data.payouts.map((p) => ({
      id: p.id,
      amountMinor: p.amountMinor,
      currency: (p.currency in currencies ? p.currency : cur) as CurrencyCode,
      status: p.status,
      timestamp: payoutTimestamp(p),
      // A payout doesn't carry its recipient's bank details, and the account on file may have changed since.
      destination: "",
      note: livePayoutNote(p),
      cancellable: p.status === "requested" || p.status === "awaiting_second_approval",
      meta: livePayoutMeta(p.status),
    }))
  }, [summary.data, cur])

  const demoItems: PayoutItem[] = useMemo(
    () =>
      demoPayouts
        .filter((p) => p.brandId === demoBrandId)
        .map((p) => {
          const approvedHere = p.status === "processing" && demoAudit.some((a) => a.subjectId === p.id && a.action === "Approved payout")
          return {
            id: p.id,
            amountMinor: payoutAmountIn(p, cur),
            currency: cur,
            status: p.status,
            timestamp: p.scheduledFor,
            destination: p.method,
            note: p.holdReason ?? (approvedHere ? "Approval recorded. Sent once a payment provider is connected" : p.status === "processing" ? "Completes when the provider confirms the transfer" : p.status === "awaiting_approval" ? "Waiting for platform review" : ""),
            cancellable: false,
            meta: approvedHere ? { label: "Approved", tone: "info" as const } : payoutTone[p.status],
          }
        }),
    [demoPayouts, demoBrandId, demoAudit, cur],
  )

  const items = live ? liveItems : demoItems

  const columns: Column<PayoutItem>[] = [
    {
      key: "ref",
      header: "Reference",
      cell: (p) => (
        <div className={historyCell}>
          <div className="flex items-baseline justify-between gap-3">
            <CopyRef value={payoutRef(p.id)} />
            <span className="text-sm whitespace-nowrap text-ink tabular md:hidden">{money(p.amountMinor, p.currency)}</span>
          </div>
          {/* Phones: amount, status and date fold into the first cell. */}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 md:hidden">
            <StatusBadge tone={p.meta.tone}>{p.meta.label}</StatusBadge>
            <span className="text-xs text-ink-2 tabular">{dateFmt.format(new Date(p.timestamp))}</span>
          </span>
          {p.note ? <span className="mt-1 block truncate text-xs text-ink-3 md:hidden">{p.note}</span> : null}
        </div>
      ),
    },
    { key: "amount", header: "Amount", align: "right", sortValue: (p) => p.amountMinor, hideBelow: "md", cell: (p) => <span className="whitespace-nowrap text-ink">{money(p.amountMinor, p.currency)}</span> },
    { key: "status", header: "Status", sortValue: (p) => p.meta.label, hideBelow: "md", cell: (p) => <StatusBadge tone={p.meta.tone}>{p.meta.label}</StatusBadge> },
    ...(live ? [] : [{ key: "method", header: "Destination", hideBelow: "lg" as const, cell: (p: PayoutItem) => <span className="text-ink-2">{p.destination}</span> }]),
    { key: "date", header: "Date", sortValue: (p) => p.timestamp, hideBelow: "md", cell: (p) => <span className="whitespace-nowrap text-ink-2 tabular">{dateFmt.format(new Date(p.timestamp))}</span> },
    { key: "note", header: "Note", hideBelow: "lg", cell: (p) => <span className="text-ink-3">{p.note}</span> },
  ]

  const paidRecently = (summary.data?.payouts ?? []).filter((p) => p.status === "paid").reduce((sum, p) => sum + p.amountMinor, 0)
  const tiles = live
    ? [
        { label: "Available to pay out", value: Math.max(0, liveBalance?.availableMinor ?? 0), tip: `Withdrawable now, after the ${commissionPct}% commission and any refunds.`, primary: true },
        { label: "Pending", value: liveBalance?.pendingMinor ?? 0, tip: "Captured sales still in the order lifecycle or returns window." },
        { label: "Reserve", value: liveBalance?.reserveMinor ?? 0, tip: rules ? `A rolling ${rules.reserveDays}-day reserve of ${rules.reserveBps / 100}% held by your tier.` : "Rolling reserve held by your tier." },
        { label: "In payouts", value: liveBalance?.inPayoutMinor ?? 0, tip: "Requested payouts under review or in flight." },
        { label: "Paid out", value: paidRecently, tip: "Confirmed transfers in the recent payout history below." },
      ]
    : [
        { label: "Available to pay out", value: demoBalances.available, tip: `Delivered orders older than ${HOLD_DAYS} days, after the 5% commission and any partial refunds, minus payouts already requested.`, primary: true },
        { label: "Pending", value: demoBalances.pending, tip: `Orders not yet delivered, delivered less than ${HOLD_DAYS} days ago (the returns window), and orders with a return being decided.` },
        { label: "Under review", value: demoBalances.inReview, tip: "Requested payouts waiting for the platform team, or on hold with a reason." },
        { label: "Approved", value: demoBalances.processing, tip: "Approved or scheduled by the platform team. Nothing is sent until a payment provider is connected, and it's marked completed only when the provider confirms." },
        { label: "Paid out", value: demoBalances.paid, tip: "Transfers the provider has confirmed." },
      ]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Payouts"
        description={live ? `Your earnings in ${cur}, after the ${commissionPct}% commission. Payouts go to your payout account.` : `Your earnings in ${cur}, after the 5% commission. Payouts go to your verified account.`}
        actions={
          blockedReason ? (
            <DisabledReason reason={blockedReason}>
              <Button variant="primary" size="sm" disabled>
                <ArrowDownToLine /> Request payout
              </Button>
            </DisabledReason>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={!hydrated || !!error}>
              <ArrowDownToLine /> Request payout
            </Button>
          )
        }
      >
        {!live ? <SampleDataNote className="mt-3" /> : null}
      </PageHeader>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void summary.revalidate()}>Try again</Button>
        </div>
      ) : null}

      {liveFailed ? null : !hydrated ? (
        <PayoutTilesSkeleton />
      ) : (
        <section aria-label="Balances" className={payoutTileGrid}>
          {/* Balances count up once per page load, the first time they are shown; after a payout request they change instantly, so a balance never looks like money moving. */}
          {tiles.map((t) => (
            <div key={t.label} className={cn(surfaceClass, "flex min-w-0 flex-col p-4 md:p-5", t.primary && payoutTilePrimary)}>
              <h3 className="font-label flex min-w-0 items-center gap-1 text-[11px] tracking-[0.07em] text-ink-3 uppercase sm:tracking-[0.1em]">
                <span className="truncate">{t.label}</span>
                <InfoTip label={`About ${t.label.toLowerCase()}`} className="shrink-0 normal-case">{t.tip}</InfoTip>
              </h3>
              <p className={cn("mt-4 min-w-0 overflow-hidden font-metric leading-none text-ink tabular", t.primary ? "text-[2.25rem] md:text-[2.5rem] xl:text-[3rem]" : "text-[1.75rem] md:text-[2rem]")}>
                <CountUp value={t.value} format={(n) => formatMoney(Math.round(n), cur)} updates="instant" once={`payout-tile:${t.label}`} />
              </p>
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
                {live ? (
                  liveAccount ? (
                    <>
                      <p className="mt-1 text-xs text-ink-3">{liveAccount.accountName}</p>
                      {liveAccount.recipientProvider === "stub" ? (
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3"><Clock className="size-3.5 text-ink-3" /> Test recipient: payouts move no money.</p>
                      ) : liveAccount.verified ? (
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3"><ShieldCheck className="size-3.5 text-violet" /> Verified</p>
                      ) : (
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3"><Clock className="size-3.5 text-ink-3" /> Provider verification is still pending.</p>
                      )}
                      {rules?.cooldownUntil ? (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-2">
                          <Clock className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                          <span>Payout requests reopen after {new Date(rules.cooldownUntil).toLocaleString("en-GB")} because the account changed recently.</span>
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-1.5 text-xs text-ink-3">Add where your earnings should go in Settings. Requests stay off until an account is saved.</p>
                  )
                ) : (
                  <>
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
                )}
              </>
            ) : liveFailed ? (
              <p className="mt-0.5 text-sm text-ink-2">Couldn&apos;t load your payout account.</p>
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
            <Link href="/studio/settings#payouts">{live && summary.data && !liveAccount ? "Add in Settings" : "Change in Settings"}</Link>
          </Button>
          <p className="max-w-sm text-xs text-ink-3 md:text-right">Requests are reviewed by Yard, then sent to your bank. They&apos;re marked completed once the payment provider confirms the transfer.</p>
        </div>
      </section>

      <section aria-labelledby="history-title" className="grid gap-3">
        <h2 id="history-title" tabIndex={-1} className="text-sm font-medium text-ink outline-none">Payout history</h2>
        <DataTable
          label="Payout history"
          rows={hydrated ? items : []}
          loading={!hydrated && !liveFailed}
          columns={columns}
          getId={(p) => p.id}
          initialSort={{ key: "date", dir: "desc" }}
          minWidth={300}
          rowActions={live ? [{
            label: "Cancel request",
            icon: X,
            destructive: true,
            onSelect: (p) => setCancelTarget(p),
            disabled: (p) => !p.cancellable,
            disabledReason: (p) => (p.cancellable ? undefined : "This payout can no longer be cancelled."),
          }] : undefined}
          empty={liveFailed ? { title: "Payout history couldn't load", body: "Try again from the message above." } : { title: "No payouts yet", body: "When delivered orders clear the returns window, you can request your first payout." }}
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
                <DialogDescription>Available now: {formatMoney(availableMinor, cur)}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-1.5">
                <Label htmlFor="payout-amount">Amount ({cur})</Label>
                <div className="flex gap-2">
                  <Input id="payout-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && !!amountError} aria-describedby="payout-amount-msg" />
                  <Button type="button" variant="secondary" onClick={() => setAmount(String(availableMinor / minor))}>Max</Button>
                </div>
                <p id="payout-amount-msg" className={touched && amountError ? "text-xs text-danger" : "text-xs text-ink-3"}>
                  {touched && amountError ? amountError : live && minPayoutMinor ? `Minimum ${formatMoney(minPayoutMinor, cur)}. Payouts have no fee from us; your bank may charge to receive.` : "Payouts have no fee from us. Your bank may charge to receive."}
                </p>
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
                <div className="flex justify-between gap-4"><dt className="text-ink-2">Fee</dt><dd className="tabular text-ink">{formatMoney(0, cur)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-ink-2">You receive</dt><dd className="tabular font-medium text-ink">{formatMoney(amountMinor, cur)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-ink-2">To</dt><dd className="text-right text-ink">{destination}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-ink-2">Next step</dt><dd className="text-right text-ink-2">Platform review, then the provider transfers it</dd></div>
              </dl>
              {live && liveAccount?.recipientProvider === "stub" ? <p className="text-xs text-ink-3">This brand pays through the test recipient. The request is recorded, but no money moves.</p> : null}
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setStep("form")} disabled={request.pending}>Back</Button>
                <Button type="button" variant="primary" onClick={() => void request.run()} loading={request.pending} success={request.succeeded}>Submit request</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => {
          if (cancel.pending) return
          if (!o) setCancelTarget(null)
        }}
        title="Cancel this payout request?"
        body={cancelTarget ? <>The {money(cancelTarget.amountMinor, cancelTarget.currency)} request {payoutRef(cancelTarget.id)} returns to your available balance. This can&apos;t be undone.</> : null}
        confirmLabel="Cancel request"
        onConfirm={() => void cancel.run()}
      />
    </div>
  )
}
