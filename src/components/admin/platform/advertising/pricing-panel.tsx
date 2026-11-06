"use client"

import { useId, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { WarningIcon as AlertTriangle, ClockCounterClockwiseIcon as History, PencilSimpleIcon as Pencil } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/dashboard/empty-state"
import { Bone } from "@/components/feedback/skeletons"
import { useAsyncAction } from "@/hooks/use-async-action"
import { adminRoles, adminUser } from "@/lib/data/admin"
import { campaignTypes, type Campaign, type CampaignType } from "@/lib/data/ads"
import { spring } from "@/lib/motion"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { recordTime, usd } from "../format"
import { useDialogReturn } from "../ready"
import { placementRules } from "./placements"

const types = Object.keys(campaignTypes) as CampaignType[]
const PRICE_ACTION = "Changed ad pricing"
const MAX_PRICE_USD = 100_000
const MIN_REASON = 8
const PRESETS = ["Demand is above available slots", "Aligning with the published rate card", "Promotional price for new brands"]

type AuditLike = { action: string; target: string; at: string; actor: string; subjectId?: string }
const lastChange = (audit: AuditLike[], t: CampaignType) => audit.find((a) => a.action === PRICE_ACTION && (a.subjectId === t || a.target.startsWith(`${campaignTypes[t].name}:`)))

/**
 * Fixed prices per campaign type, changed only through a confirmed, reasoned edit.
 * `campaigns` is every campaign the queue lists (the review store's and the Studio brand's),
 * so the dialog counts everything a change affects.
 */
export function PricingPanel({ campaigns, ready }: { campaigns: Campaign[]; ready: boolean }) {
  const pricing = useAdmin((s) => s.pricing)
  const audit = useAdmin((s) => s.audit)
  const [editing, setEditing] = useState<CampaignType | null>(null)
  const [open, setOpen] = useState(false)
  const history = useMemo(() => audit.filter((a) => a.action === PRICE_ACTION), [audit])
  const focus = useDialogReturn()

  return (
    <div>
      <p className="px-4 pt-1 pb-3 text-[12px] text-ink-2 md:px-5">
        Fixed prices, published to brands before they book. A change applies to new bookings only: campaigns already booked keep the price they paid. Studio&apos;s campaign builder reads these prices.
      </p>
      <ul className="admin-divide border-y border-[var(--admin-hairline)]" aria-label="Ad prices by campaign type">
        {types.map((t) => {
          const ct = campaignTypes[t]
          const a = ready ? lastChange(audit, t) : undefined
          return (
            <li key={t} className="grid gap-3 px-4 py-3.5 md:px-5 @3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_232px] @3xl:items-center @3xl:gap-6">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">{ct.name}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{ct.description}</p>
              </div>
              <p className="min-w-0 text-[12px] text-ink-2">
                <span className="text-ink-3 @3xl:hidden">Sold into </span>
                {ct.placements.map((p) => placementRules[p].name).join(", ")}
              </p>
              <p className="text-[12px] text-ink-3">
                {!ready ? <Bone className="h-3 w-28" /> : a ? <span title={recordTime(a.at).title}>Changed {recordTime(a.at).label.toLowerCase()} by {a.actor}</span> : "Launch price"}
              </p>
              <div className="flex items-center justify-between gap-4 @3xl:justify-end">
                <p className="whitespace-nowrap">
                  {ready ? <span className="font-metric text-[1.375rem] text-ink">{usd(pricing[t])}</span> : <Bone className="inline-block h-5 w-16 align-middle" />}
                  <span className="ml-1 text-[12px] text-ink-3">per {ct.unit}</span>
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-10 sm:h-8"
                  disabled={!ready}
                  onClick={() => {
                    setEditing(t)
                    focus.openFrom(() => setOpen(true))
                  }}
                  aria-label={`Change the price of ${ct.name.toLowerCase()}`}
                >
                  <Pencil aria-hidden /> Change
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="px-4 pt-4 pb-5 md:px-5">
        <h3 className="font-label text-[13px] text-ink">Change history</h3>
        <p className="mt-1 text-[12px] text-ink-2">From the audit log. Every change keeps who made it and why.</p>
        {!ready ? (
          <div aria-hidden className="mt-3 grid gap-3">
            <Bone className="h-10 w-full" />
            <Bone className="h-10 w-full" />
          </div>
        ) : history.length ? (
          <ol className="admin-divide mt-2">
            <AnimatePresence initial={false}>
              {history.map((a) => (
                <motion.li key={a.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={spring.layout} className="grid gap-x-4 gap-y-0.5 py-2.5 @3xl:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]">
                  <time dateTime={a.at} title={recordTime(a.at).title} className="text-[11px] text-ink-3 @3xl:text-[12px] @3xl:text-ink-2">{recordTime(a.at).label}</time>
                  <span className="min-w-0">
                    <span className="block text-[13px] text-ink tabular">{a.target.replace(" → ", " to ")}</span>
                    <span className="block text-[11px] text-ink-3">
                      {a.actor}, {adminRoles[a.role]?.name.toLowerCase() ?? a.role}
                    </span>
                  </span>
                  <span className={cn("text-[12px]", a.reason ? "text-ink-2" : "text-ink-3")}>{a.reason ?? "No reason recorded"}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        ) : (
          <EmptyState icon={History} title="No price changes yet" body="Every type is still at its launch price." className="mt-3 py-8" />
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-5 sm:max-w-md" onCloseAutoFocus={focus.onCloseAutoFocus}>
          {editing ? (
            <PriceForm
              key={`${editing}-${String(open)}`}
              type={editing}
              current={pricing[editing]}
              live={campaigns.filter((c) => c.type === editing && (c.status === "active" || c.status === "scheduled")).length}
              inReview={campaigns.filter((c) => c.type === editing && c.status === "in_review").length}
              onDone={() => setOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function parsePrice(raw: string): { cents: number } | { error: string } {
  const v = raw.replace(/[$,\s]/g, "")
  if (!v) return { error: "Enter the new price." }
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { error: "Use a number with up to two decimals, like 18 or 18.50." }
  const n = Number(v)
  if (n <= 0) return { error: "The price has to be more than $0." }
  if (n > MAX_PRICE_USD) return { error: `Prices are capped at ${usd(MAX_PRICE_USD * 100)}.` }
  return { cents: Math.round(n * 100) }
}

function reasonProblem(v: string) {
  const r = v.trim()
  if (!r) return "Add a reason. It's recorded in the audit log with your name."
  if (r.length < MIN_REASON) return `Say a little more: at least ${MIN_REASON} characters.`
  return null
}

/** The price edit: the new price with its change from today's, a required reason, then confirm. */
function PriceForm({ type, current, live, inReview, onDone }: { type: CampaignType; current: number; live: number; inReview: number; onDone: () => void }) {
  const id = useId()
  const setPrice = useAdmin((s) => s.setPrice)
  const t = campaignTypes[type]
  const [price, setPriceText] = useState((current / 100).toString())
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<{ price?: string | null; reason?: string | null }>({})

  const parsed = parsePrice(price)
  const next = "cents" in parsed ? parsed.cents : null
  const change = next !== null && current ? (next - current) / current : null

  const save = useAsyncAction(
    (cents: number, why: string) => {
      setPrice(type, cents, why)
      return cents
    },
    { success: "Price changed", successDescription: (cents) => `${t.name} is ${usd(cents)} per ${t.unit} for new bookings. Recorded in the audit log.`, onSuccess: onDone },
  )

  function priceProblem() {
    if ("error" in parsed) return parsed.error
    if (parsed.cents === current) return "That's the current price. Enter a different amount."
    return null
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (save.pending) return
    const pErr = priceProblem()
    const rErr = reasonProblem(reason)
    setErrors({ price: pErr, reason: rErr })
    if (pErr) return document.getElementById(`${id}-price`)?.focus()
    if (rErr) return document.getElementById(`${id}-reason`)?.focus()
    void save.run(next!, reason.trim())
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="font-label pr-6 text-base leading-snug">Change the price of {t.name.toLowerCase()}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">New bookings pay the new price from now on. Campaigns already booked keep the price they paid, and brands see the new price before they book.</DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-2">
        <div className="admin-inset min-w-0 px-3 py-2">
          <dt className="text-[11px] text-ink-3">Today&apos;s price</dt>
          <dd className="mt-0.5 text-[13px] text-ink tabular">{usd(current)} per {t.unit}</dd>
        </div>
        <div className="admin-inset min-w-0 px-3 py-2">
          <dt className="text-[11px] text-ink-3">Booked at today&apos;s price</dt>
          <dd className="mt-0.5 text-[13px] text-ink tabular">
            {live} live or scheduled, {inReview} in review
          </dd>
        </div>
      </dl>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-price`}>
          New price <span className="text-danger" aria-hidden>*</span>
        </Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-ink-3" aria-hidden>$</span>
          <Input
            id={`${id}-price`}
            inputMode="decimal"
            autoComplete="off"
            required
            value={price}
            onChange={(e) => {
              setPriceText(e.target.value)
              if (errors.price) setErrors((x) => ({ ...x, price: null }))
            }}
            aria-invalid={!!errors.price}
            aria-describedby={`${id}-price-note`}
            placeholder="0.00"
            className="h-10 rounded-md border-line bg-obsidian/40 pr-24 pl-7 text-[13px] tabular"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-ink-3">per {t.unit}</span>
        </div>
        {errors.price ? (
          <p id={`${id}-price-note`} role="alert" className="text-xs text-danger">{errors.price}</p>
        ) : (
          <p id={`${id}-price-note`} className="text-xs text-ink-3 tabular">
            {next !== null && next !== current && change !== null
              ? `From ${usd(current)} to ${usd(next)}, ${change > 0 ? "up" : "down"} ${Math.abs(change * 100).toFixed((change * 100) % 1 ? 1 : 0)}%.`
              : "In US dollars. Local prices are converted at booking."}
          </p>
        )}
      </div>

      {change !== null && Math.abs(change) >= 0.5 ? (
        <p className="flex items-start gap-2 rounded-[10px] border border-acid/25 bg-acid/5 p-2.5 text-[12px] text-ink">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-acid" aria-hidden />
          <span>That&apos;s a change of {Math.round(Math.abs(change) * 100)}%. Check it with ads operations before you confirm; brands planning a booking will notice.</span>
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-reason`}>
          Reason, for the audit log <span className="text-danger" aria-hidden>*</span>
        </Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common reasons">
          {PRESETS.map((p) => {
            const on = reason.trim() === p
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setReason(p)
                  if (errors.reason) setErrors((x) => ({ ...x, reason: null }))
                }}
                className={cn("h-8 rounded-full border px-3 text-[11.5px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-violet", on ? "border-purple bg-purple/20 text-ink" : "border-[var(--admin-hairline-strong)] text-ink-2 hover:text-ink")}
              >
                {p}
              </button>
            )
          })}
        </div>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          required
          onChange={(e) => {
            setReason(e.target.value)
            if (errors.reason) setErrors((x) => ({ ...x, reason: reasonProblem(e.target.value) }))
          }}
          rows={3}
          placeholder="Why this price, and what you checked"
          aria-invalid={!!errors.reason}
          aria-describedby={`${id}-reason-note`}
        />
        {errors.reason ? (
          <p id={`${id}-reason-note`} role="alert" className="text-xs text-danger">{errors.reason}</p>
        ) : (
          <p id={`${id}-reason-note`} className="text-xs text-ink-3">Recorded as {adminUser.name} with the time. It can&apos;t be edited later.</p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={save.pending}>Cancel</Button>
        <Button type="submit" variant="primary" loading={save.pending}>Change price</Button>
      </DialogFooter>
    </form>
  )
}
