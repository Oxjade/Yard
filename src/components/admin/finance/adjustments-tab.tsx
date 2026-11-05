"use client"

import { useEffect, useId, useState } from "react"
import { CheckIcon as Check, CircleNotchIcon as Loader2, ScalesIcon as Scale, UserCheckIcon as UserCheck, UsersIcon as Users, XIcon as X } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/dashboard/empty-state"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { adminUser } from "@/lib/data/admin"
import { brands } from "@/lib/data/brands"
import { useAdmin, type AdjustmentRequest } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { ReasonDialog, type ReasonAction } from "../platform/reason-dialog"
import { FilterSelect } from "../platform/table"
import { PLATFORM_ACCOUNT } from "./derive"
import { formatDateTime, plural, signedUsd, usd } from "./format"
import { adjustmentMeta } from "./meta"
import type { AdjustmentPrefill } from "./reconciliation-tab"
import { TablePanel } from "./table"

type Filter = "all" | AdjustmentRequest["status"]

const ORDER: AdjustmentRequest["status"][] = ["pending", "approved", "rejected"]
const filterLabel: Record<AdjustmentRequest["status"], string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" }
type Decision = { adj: AdjustmentRequest; to: "approved" | "rejected"; action: ReasonAction }

const MIN_REASON = 15
const MAX_CENTS = 10_000_000

/**
 * Ledger adjustments are maker-checker: anyone in Finance can request one, a different admin
 * must approve it, and an approved adjustment posts as a new balanced entry. Nothing that is
 * already recorded is edited.
 */
export function AdjustmentsTab({ prefill, prefillKey, onPrefillUsed }: { prefill?: AdjustmentPrefill | null; prefillKey?: number; onPrefillUsed?: () => void }) {
  const adjustments = useAdmin((s) => s.adjustments)
  const decideAdjustment = useAdmin((s) => s.decideAdjustment)
  const [filter, setFilter] = useState<Filter>("pending")
  const [decision, setDecision] = useState<Decision | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (prefill) document.getElementById("adjustment-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [prefill, prefillKey])

  const count = (s: AdjustmentRequest["status"]) => adjustments.filter((a) => a.status === s).length
  const rows = adjustments.filter((a) => filter === "all" || a.status === filter)
  const waitingOnMe = adjustments.filter((a) => a.status === "pending" && a.requestedBy !== adminUser.name)

  function decide(a: AdjustmentRequest, to: Decision["to"]) {
    const facts = [
      { label: "Account", value: a.brandName },
      { label: "Amount", value: signedUsd(a.amountUsd) },
      { label: "Requested by", value: a.requestedBy },
      { label: "Requested", value: formatDateTime(a.at) },
    ]
    setDecision(
      to === "approved"
        ? {
            adj: a,
            to,
            action: {
              title: `Approve the ${signedUsd(a.amountUsd)} adjustment to ${a.brandName}?`,
              body: "It posts as a new, balanced ledger entry with both your names on it. Nothing already recorded changes.",
              confirmLabel: "Approve",
              tone: "primary",
              facts,
              warning: `Their reason: ${a.reason}`,
              presets: ["Checked against the carrier invoice", "Matches the provider's settlement report", "Supporting document attached to the ticket"],
            },
          }
        : {
            adj: a,
            to,
            action: {
              title: `Reject the adjustment to ${a.brandName}?`,
              body: "Nothing is posted. The requester sees your reason and can raise a corrected request.",
              confirmLabel: "Reject adjustment",
              tone: "destructive",
              facts,
              warning: `Their reason: ${a.reason}`,
              presets: ["Amount doesn't match the evidence", "Belongs in a refund, not an adjustment", "Duplicate of an earlier request"],
            },
          },
    )
    setOpen(true)
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <TablePanel
        id="adjustments-title"
        title="Ledger adjustments"
        description={waitingOnMe.length ? `${plural(waitingOnMe.length, "request")} waiting for a second approver.` : "Corrections to a ledger balance, each approved by a second admin."}
        toolbar={
          <FilterSelect
            label="Filter by status"
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            className="md:w-[180px]"
            options={[{ value: "all", label: `All statuses (${adjustments.length})` }, ...ORDER.filter((s) => count(s) || s === filter).map((s) => ({ value: s, label: `${filterLabel[s]} (${count(s)})` }))]}
          />
        }
      >
        {rows.length ? (
          <ul className="divide-y divide-line-soft">
            {rows.map((a) => {
              const mine = a.requestedBy === adminUser.name
              return (
                <li key={a.id} className="grid gap-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] text-ink">{a.brandName}</p>
                      <p className="text-[11px] text-ink-3">
                        Requested by {mine ? "you" : a.requestedBy}, <time dateTime={a.at}>{formatDateTime(a.at)}</time>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className={cn("text-[13px] font-medium tabular", a.amountUsd < 0 ? "text-ink-2" : "text-ink")}>{signedUsd(a.amountUsd)}</span>
                      <StatusBadge tone={adjustmentMeta[a.status].tone}>{adjustmentMeta[a.status].label}</StatusBadge>
                    </div>
                  </div>
                  <p className="text-[12px] text-ink-2">{a.reason}</p>
                  {a.status === "pending" ? (
                    mine ? (
                      <p className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-[11px] text-ink-2">
                        <Users className="size-3.5 shrink-0 text-violet" aria-hidden />
                        You requested this, so a different admin has to approve or reject it.
                      </p>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button type="button" size="xs" variant="ghost" onClick={() => decide(a, "rejected")}>
                          <X /> Reject
                        </Button>
                        <Button type="button" size="xs" variant="secondary" onClick={() => decide(a, "approved")}>
                          <Check /> Approve
                        </Button>
                      </div>
                    )
                  ) : a.decidedBy ? (
                    <p className="flex items-center gap-1.5 text-[11px] text-ink-3">
                      <UserCheck className="size-3.5" aria-hidden />
                      {a.status === "approved" ? "Approved" : "Rejected"} by {a.decidedBy === adminUser.name ? "you" : a.decidedBy}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState icon={Scale} className="m-4" title={filter === "pending" ? "Nothing waiting for approval" : `No ${filter === "all" ? "" : `${filter} `}adjustments`} body="Requests appear here until a second admin approves or rejects them." />
        )}
      </TablePanel>

      <div className="grid gap-5">
        <section aria-labelledby="rule-title" className="rounded-lg border border-line-soft bg-card p-4">
          <h2 id="rule-title" className="text-[13px] font-medium text-ink">Two-person rule</h2>
          <ol className="mt-3 grid gap-2.5">
            {[
              ["Request", "Anyone in Finance states the account, amount and reason."],
              ["Approve", "A different admin checks the evidence. You can't approve your own request."],
              ["Post", "It's added as a new, balanced ledger entry. The original records stay as they were."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-2.5">
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-violet/40 text-[10px] font-semibold text-violet tabular">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] text-ink">{t}</span>
                  <span className="block text-[11px] text-ink-3">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <RequestForm
          key={prefillKey ?? 0}
          prefill={prefill}
          onRequested={() => {
            setFilter("pending")
            onPrefillUsed?.()
          }}
        />
      </div>

      <ReasonDialog
        action={decision?.action ?? null}
        open={open}
        onOpenChange={setOpen}
        onConfirm={async (reason) => {
          if (!decision) return
          const ok = decideAdjustment(decision.adj.id, decision.to, reason)
          if (!ok) {
            toast.error("You can't approve your own request", { description: "A different admin has to approve this adjustment. Nothing was posted." })
            return
          }
          toast(decision.to === "approved" ? "Adjustment approved" : "Adjustment rejected", {
            description: decision.to === "approved" ? `${signedUsd(decision.adj.amountUsd)} to ${decision.adj.brandName}. The approval is in the audit log; it posts to the ledger once the finance backend is connected.` : "Nothing was posted. The requester can see your reason.",
          })
        }}
      />
    </div>
  )
}

type Errors = { account?: string; amount?: string; reason?: string }

function parseCents(raw: string) {
  const v = raw.replace(/[$,\s]/g, "")
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
  return Math.round(Number(v) * 100)
}

function RequestForm({ prefill, onRequested }: { prefill?: AdjustmentPrefill | null; onRequested: () => void }) {
  const id = useId()
  const requestAdjustment = useAdmin((s) => s.requestAdjustment)
  const [account, setAccount] = useState(prefill?.account ?? "")
  const [direction, setDirection] = useState<"credit" | "debit">(prefill?.direction ?? "credit")
  const [amount, setAmount] = useState(prefill?.amount ?? "")
  const [reason, setReason] = useState(prefill?.reason ?? "")
  const [errors, setErrors] = useState<Errors>({})
  const [pending, setPending] = useState(false)

  function validate(): Errors {
    const e: Errors = {}
    if (!account) e.account = "Choose the account to adjust."
    const cents = parseCents(amount)
    if (!amount.trim()) e.amount = "Enter the amount in USD."
    else if (cents === null) e.amount = "Use a number with up to two decimals, like 42.50."
    else if (cents <= 0) e.amount = "The amount must be more than zero. Use debit or credit for the direction."
    else if (cents > MAX_CENTS) e.amount = `That's over ${usd(MAX_CENTS)}. Check the amount, or split it with a note linking the parts.`
    if (!reason.trim()) e.reason = "Say why. The approver checks your reason against the evidence."
    else if (reason.trim().length < MIN_REASON) e.reason = `Say a little more: at least ${MIN_REASON} characters.`
    return e
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (pending) return
    const e = validate()
    setErrors(e)
    const first = (["account", "amount", "reason"] as const).find((k) => e[k])
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus()
      return
    }
    setPending(true)
    const cents = parseCents(amount)! * (direction === "debit" ? -1 : 1)
    requestAdjustment(account, cents, reason.trim())
    toast("Adjustment requested", { description: `${signedUsd(cents)} to ${account}. It posts only after a different admin approves it.` })
    setPending(false)
    setAccount("")
    setDirection("credit")
    setAmount("")
    setReason("")
    onRequested()
  }

  const clear = (k: keyof Errors) => errors[k] && setErrors({ ...errors, [k]: undefined })

  return (
    <section id="adjustment-form" aria-labelledby={`${id}-title`} className={cn("scroll-mt-20 rounded-lg border bg-card p-4", prefill ? "border-violet/40" : "border-line-soft")}>
      <h2 id={`${id}-title`} className="text-[13px] font-medium text-ink">Request an adjustment</h2>
      <p className="mt-0.5 text-[11px] text-ink-2">{prefill ? "Filled in from the reconciliation mismatch. Check it before you send." : "For corrections a refund or payout can't express, such as a carrier credit."}</p>

      <form onSubmit={submit} noValidate className="mt-4 grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-account`} className="text-[13px]">Account</Label>
          <Select
            value={account}
            onValueChange={(v) => {
              setAccount(v)
              clear("account")
            }}
          >
            <SelectTrigger id={`${id}-account`} aria-invalid={!!errors.account} aria-describedby={errors.account ? `${id}-account-error` : undefined} className="h-9 w-full rounded-md border-line bg-obsidian/40 text-[13px] data-[size=default]:h-9 dark:bg-obsidian/40">
              <SelectValue placeholder="Choose a brand or platform account" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectLabel className="text-[11px] text-ink-3">Platform</SelectLabel>
                <SelectItem value={PLATFORM_ACCOUNT}>{PLATFORM_ACCOUNT}</SelectItem>
              </SelectGroup>
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
          <legend className="mb-1.5 text-[13px] font-medium">Direction</legend>
          <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-1.5">
            {(
              [
                ["credit", "Credit", "Adds to the balance"],
                ["debit", "Debit", "Takes from the balance"],
              ] as const
            ).map(([v, t, d]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={direction === v}
                onClick={() => setDirection(v)}
                className={cn("rounded-md border px-2.5 py-2 text-left transition-colors", direction === v ? "border-violet/50 bg-purple/15" : "border-line hover:bg-elevated")}
              >
                <span className="block text-[13px] text-ink">{t}</span>
                <span className="block text-[11px] text-ink-3">{d}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-amount`} className="text-[13px]">Amount in USD</Label>
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
              className="h-9 rounded-md border-line bg-obsidian/40 pl-8 text-[13px] tabular"
            />
          </div>
          {errors.amount ? <p id={`${id}-amount-error`} role="alert" className="text-xs text-danger">{errors.amount}</p> : null}
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-reason`} className="text-[13px]">Reason</Label>
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

        <Button type="submit" variant="primary" size="sm" disabled={pending} className="w-full">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Scale />}
          Request adjustment
        </Button>
      </form>
    </section>
  )
}
