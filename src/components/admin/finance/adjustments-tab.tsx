"use client"

import { useEffect, useId, useState } from "react"
import { AnimatePresence, motion, useIsPresent } from "motion/react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { CheckIcon, ScalesIcon, UserCheckIcon, UsersIcon, XIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { DisabledReason } from "@/components/feedback/info-tip"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { useAsyncAction } from "@/hooks/use-async-action"
import { spring } from "@/lib/motion"
import { adminUser } from "@/lib/data/admin"
import { brands } from "@/lib/data/brands"
import { useAdmin, type AdjustmentRequest } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { useDecision } from "../marketplace/decision"
import { PLATFORM_ACCOUNT } from "./derive"
import { formatDateTime, plural, signedUsd, usd } from "./format"
import { adjustmentMeta } from "./meta"
import type { AdjustmentPrefill } from "./reconciliation-tab"
import { useSearchParam, writeParams } from "./table"

type Filter = "all" | AdjustmentRequest["status"]
const FILTERS: Filter[] = ["pending", "approved", "rejected", "all"]
const isFilter = (v: string | null): v is Filter => (FILTERS as (string | null)[]).includes(v)
const MIN_REASON = 15
const MAX_CENTS = 10_000_000

/**
 * Ledger adjustments are maker-checker: anyone in Finance can request one, a different admin
 * must approve it, and an approved adjustment posts as a new balanced entry. Nothing that is
 * already recorded is edited.
 */
export function AdjustmentsTab({ prefill, prefillKey, onPrefillUsed, ready }: { prefill?: AdjustmentPrefill | null; prefillKey?: number; onPrefillUsed?: () => void; ready: boolean }) {
  const qid = useId()
  const adjustments = useAdmin((s) => s.adjustments)
  // The status lives in the URL (?status=…, Pending when absent), so a reload keeps it.
  const linked = useSearchParam("status")
  const filter: Filter = isFilter(linked) ? linked : "pending"
  const setFilter = (f: Filter) => writeParams({ status: f === "pending" ? null : f })
  // A decision removes its buttons (and, under Pending, the row), so focus lands on the selected status tab.
  const { ask, dialog } = useDecision(() => document.getElementById(segmentedTabId(qid, filter)))

  useEffect(() => {
    if (prefill) document.getElementById("adjustment-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [prefill, prefillKey])

  const count = (s: AdjustmentRequest["status"]) => adjustments.filter((a) => a.status === s).length
  const rows = adjustments.filter((a) => filter === "all" || a.status === filter)
  const waitingOnMe = adjustments.filter((a) => a.status === "pending" && a.requestedBy !== adminUser.name)

  function decide(a: AdjustmentRequest, to: "approved" | "rejected") {
    const mine = a.requestedBy === adminUser.name
    ask({
      title: to === "approved" ? `Approve the ${signedUsd(a.amountUsd)} adjustment to ${a.brandName}?` : mine ? `Withdraw your ${signedUsd(a.amountUsd)} adjustment request?` : `Reject the adjustment to ${a.brandName}?`,
      description: [
        `Requested by ${mine ? "you" : a.requestedBy}, ${formatDateTime(a.at)}. ${mine ? "Your" : "Their"} reason: ${a.reason}${/[.!?]$/.test(a.reason.trim()) ? "" : "."}`,
        to === "approved" ? "It posts as a new, balanced entry in the ledger with both your names on it. Nothing already recorded changes." : "Nothing is posted. The request is closed as rejected with your reason, and a corrected one can be raised.",
      ].join(" "),
      confirmLabel: to === "approved" ? "Approve adjustment" : mine ? "Withdraw request" : "Reject adjustment",
      destructive: to === "rejected",
      run: (reason) => {
        const ok = useAdmin.getState().decideAdjustment(a.id, to, reason)
        if (!ok) {
          // The store enforces the two-person rule (and refuses a request someone already decided).
          const now = useAdmin.getState().adjustments.find((x) => x.id === a.id)
          toast.error(now && now.status !== "pending" ? "Someone already decided this request" : "You can't approve your own request", { description: now && now.status !== "pending" ? `It's ${adjustmentMeta[now.status].label.toLowerCase()}. Nothing else was posted.` : "A different admin has to approve it. Nothing was posted." })
          return
        }
        toast.success(to === "approved" ? "Adjustment approved" : mine ? "Request withdrawn" : "Adjustment rejected", { description: to === "approved" ? `${signedUsd(a.amountUsd)} to ${a.brandName}, posted as a new ledger entry.` : "Nothing was posted. Recorded in the audit log." })
      },
    })
  }

  return (
    <div className="grid items-start gap-3 @5xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel title="Ledger adjustments" description={waitingOnMe.length ? `${plural(waitingOnMe.length, "request")} waiting for you as the second approver.` : "Corrections to a ledger balance, each approved by a second admin."} className="rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        <div className="rail overflow-x-auto px-4 pb-3 md:px-5">
          <Segmented
            label="Adjustment status"
            size="sm"
            value={filter}
            onChange={setFilter}
            loading={!ready}
            idBase={qid}
            panelId={`${qid}-panel`}
            options={[
              { value: "pending", label: "Pending", count: count("pending") },
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "all", label: "All" },
            ]}
          />
        </div>
        <div id={`${qid}-panel`} role="tabpanel" aria-labelledby={segmentedTabId(qid, filter)} className="border-t border-[var(--admin-hairline)]">
          {!ready ? (
            <ul aria-hidden className="admin-divide">
              {[0, 1].map((i) => (
                <li key={i} className="grid gap-2 px-4 py-4 md:px-5">
                  <span className="skeleton h-3.5 w-1/3 rounded" />
                  <span className="skeleton h-3 w-2/3 rounded" />
                </li>
              ))}
            </ul>
          ) : rows.length ? (
            <ul className="admin-divide">
              <AnimatePresence initial={false}>
                {rows.map((a) => {
                  const mine = a.requestedBy === adminUser.name
                  return (
                    <AdjustmentRow key={a.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-ink">{a.brandName}</p>
                          <p className="text-[11.5px] text-ink-3">
                            Requested by {mine ? "you" : a.requestedBy}, <time dateTime={a.at}>{formatDateTime(a.at)}</time>
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className={cn("font-metric text-[1.25rem]", a.amountUsd < 0 ? "text-ink-2" : "text-ink")}>{signedUsd(a.amountUsd)}</span>
                          <StatusBadge tone={adjustmentMeta[a.status].tone}>{adjustmentMeta[a.status].label}</StatusBadge>
                        </div>
                      </div>
                      <p className="text-[12.5px] text-ink-2">{a.reason}</p>
                      {a.status === "pending" ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {mine ? (
                            <p className="flex min-w-0 items-center gap-2 text-[11.5px] text-ink-2">
                              <UsersIcon className="size-3.5 shrink-0 text-violet" aria-hidden />
                              You requested this, so a different admin has to approve it.
                            </p>
                          ) : (
                            <span />
                          )}
                          <div className="flex gap-1.5">
                            <Button type="button" size="sm" variant="destructive" className="h-10 sm:h-8" onClick={() => decide(a, "rejected")}>
                              <XIcon /> {mine ? "Withdraw" : "Reject"}
                            </Button>
                            {mine ? (
                              <DisabledReason reason="Two-person rule: you requested this adjustment, so another admin in Finance has to approve it.">
                                <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" disabled>
                                  <CheckIcon /> Approve
                                </Button>
                              </DisabledReason>
                            ) : (
                              <Button type="button" size="sm" variant="secondary" className="h-10 sm:h-8" onClick={() => decide(a, "approved")}>
                                <CheckIcon /> Approve
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : a.decidedBy ? (
                        <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
                          <UserCheckIcon className="size-3.5" aria-hidden />
                          {a.status === "approved" ? "Approved" : "Rejected"} by {a.decidedBy === adminUser.name ? "you" : a.decidedBy}
                          {a.decidedAt ? `, ${formatDateTime(a.decidedAt)}` : ""}
                        </p>
                      ) : null}
                    </AdjustmentRow>
                  )
                })}
              </AnimatePresence>
            </ul>
          ) : (
            <EmptyState icon={ScalesIcon} className="m-4 md:m-5" title={filter === "pending" ? "Nothing waiting for approval" : `No ${filter === "all" ? "" : `${filter} `}adjustments`} body="Requests stay here until a second admin approves or rejects them." />
          )}
        </div>
      </Panel>

      <div className="grid gap-3">
        <Panel title="Two-person rule" className="rounded-[20px]">
          <ol className="grid gap-3">
            {[
              ["Request", "Anyone in Finance states the account, amount and reason."],
              ["Approve", "A different admin checks the evidence. Nobody approves their own request."],
              ["Post", "It's added as a new, balanced ledger entry. The original records stay as they were."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-2.5">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-violet/40 text-[11px] font-semibold text-violet tabular">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{t}</span>
                  <span className="block text-[11.5px] text-ink-3">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <RequestForm
          key={prefillKey ?? 0}
          prefill={prefill}
          onRequested={() => {
            setFilter("pending")
            onPrefillUsed?.()
          }}
        />
      </div>
      {dialog}
    </div>
  )
}

/** A list row that goes inert while it animates out, so focus never returns into a row that's leaving. */
function AdjustmentRow({ children }: { children: React.ReactNode }) {
  const present = useIsPresent()
  return (
    <motion.li layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.layout} inert={!present || undefined} className="grid gap-2.5 px-4 py-4 md:px-5">
      {children}
    </motion.li>
  )
}

type Errors = { account?: string; amount?: string; reason?: string }

function parseCents(raw: string) {
  const v = raw.replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
  return Math.round(Number(v) * 100)
}

function Required() {
  return (
    <>
      <span className="text-danger" aria-hidden>*</span>
      <span className="sr-only"> (required)</span>
    </>
  )
}

function RequestForm({ prefill, onRequested }: { prefill?: AdjustmentPrefill | null; onRequested: () => void }) {
  const id = useId()
  const requestAdjustment = useAdmin((s) => s.requestAdjustment)
  const [account, setAccount] = useState(prefill?.account ?? "")
  const [direction, setDirection] = useState<"credit" | "debit">(prefill?.direction ?? "credit")
  const [amount, setAmount] = useState(prefill?.amount ?? "")
  const [reason, setReason] = useState(prefill?.reason ?? "")
  const [errors, setErrors] = useState<Errors>({})
  const send = useAsyncAction(
    (cents: number) => {
      requestAdjustment(account, cents, reason.trim())
      return cents
    },
    {
      success: "Adjustment requested",
      successDescription: (cents) => `${signedUsd(cents)} to ${account}. It posts only after a different admin approves it.`,
      onSuccess: () => {
        setAccount("")
        setDirection("credit")
        setAmount("")
        setReason("")
        onRequested()
      },
    },
  )

  function validate(): Errors {
    const e: Errors = {}
    if (!account) e.account = "Choose the account to adjust."
    const cents = parseCents(amount)
    if (!amount.trim()) e.amount = "Enter the amount in USD."
    else if (cents === null) e.amount = "Use a number with up to two decimals, like 42.50."
    else if (cents <= 0) e.amount = "The amount must be more than zero. Use credit or debit for the direction."
    else if (cents > MAX_CENTS) e.amount = `That's over ${usd(MAX_CENTS)}. Check the amount, or split it with a note linking the parts.`
    if (!reason.trim()) e.reason = "Say why. The approver checks your reason against the evidence."
    else if (reason.trim().length < MIN_REASON) e.reason = `Say a little more: at least ${MIN_REASON} characters.`
    return e
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (send.pending) return
    const e = validate()
    setErrors(e)
    const first = (["account", "amount", "reason"] as const).find((k) => e[k])
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus()
      return
    }
    void send.run(parseCents(amount)! * (direction === "debit" ? -1 : 1))
  }

  const clear = (k: keyof Errors) => errors[k] && setErrors({ ...errors, [k]: undefined })

  return (
    <Panel id="adjustment-form" title="Request an adjustment" description={prefill ? "Filled in from the reconciliation mismatch. Check it before you send." : "For corrections a refund or payout can't express, such as a carrier credit."} className={cn("scroll-mt-24 rounded-[20px]", prefill && "border-violet/40")}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-account`} className="text-[13px]">
            Account <Required />
          </Label>
          <Select
            value={account}
            onValueChange={(v) => {
              setAccount(v)
              clear("account")
            }}
          >
            <SelectTrigger id={`${id}-account`} aria-invalid={!!errors.account} aria-describedby={errors.account ? `${id}-account-error` : undefined} className="h-10 w-full rounded-md border-line bg-obsidian/40 text-[13px] data-[size=default]:h-10 dark:bg-obsidian/40">
              <SelectValue placeholder="Choose a brand or platform account" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectLabel className="text-[11px] text-ink-3">Platform</SelectLabel>
                <SelectItem value={PLATFORM_ACCOUNT}>{PLATFORM_ACCOUNT}</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-[11px] text-ink-3">Brand balances</SelectLabel>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {errors.account ? <p id={`${id}-account-error`} role="alert" className="text-xs text-danger">{errors.account}</p> : null}
        </div>

        <fieldset className="grid gap-1.5">
          <legend id={`${id}-direction`} className="mb-1.5 text-[13px] font-medium">Direction</legend>
          {/* A real radio group: one tab stop, arrow keys move the choice. */}
          <RadioGroupPrimitive.Root value={direction} onValueChange={(v) => setDirection(v as "credit" | "debit")} aria-labelledby={`${id}-direction`} orientation="horizontal" className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["credit", "Credit", "Adds to the balance"],
                ["debit", "Debit", "Takes from the balance"],
              ] as const
            ).map(([v, t, d]) => (
              <RadioGroupPrimitive.Item
                key={v}
                value={v}
                className={cn("min-h-12 rounded-md border px-2.5 py-2 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-violet", direction === v ? "border-violet/50 bg-purple/15" : "border-line hover:bg-white/[0.03]")}
              >
                <span className="block text-[13px] text-ink">{t}</span>
                <span className="block text-[11px] text-ink-3">{d}</span>
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-amount`} className="text-[13px]">
            Amount in USD <Required />
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-ink-3" aria-hidden>
              {direction === "debit" ? "−$" : "+$"}
            </span>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                clear("amount")
              }}
              aria-invalid={!!errors.amount}
              aria-describedby={errors.amount ? `${id}-amount-error` : undefined}
              placeholder="0.00"
              className="h-10 rounded-md border-line bg-obsidian/40 pl-8 text-[13px] tabular"
            />
          </div>
          {errors.amount ? <p id={`${id}-amount-error`} role="alert" className="text-xs text-danger">{errors.amount}</p> : null}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-reason`} className="text-[13px]">
            Reason <Required />
          </Label>
          <Textarea
            id={`${id}-reason`}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              clear("reason")
            }}
            rows={3}
            aria-invalid={!!errors.reason}
            aria-describedby={errors.reason ? `${id}-reason-error` : `${id}-reason-hint`}
            placeholder="What happened, and where the evidence is"
            className="min-h-20 rounded-md border-line bg-obsidian/40 text-[13px]"
          />
          {errors.reason ? (
            <p id={`${id}-reason-error`} role="alert" className="text-xs text-danger">{errors.reason}</p>
          ) : (
            <p id={`${id}-reason-hint`} className="text-[11px] text-ink-3">Requested as {adminUser.name}. You won&apos;t be able to approve it yourself.</p>
          )}
        </div>

        <Button type="submit" variant="primary" loading={send.pending} success={send.succeeded} className="h-11 w-full">
          <ScalesIcon /> Request adjustment
        </Button>
      </form>
    </Panel>
  )
}
