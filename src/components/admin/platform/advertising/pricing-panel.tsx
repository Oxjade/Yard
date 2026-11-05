"use client"

import { useId, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import { ClockCounterClockwiseIcon as History, CircleNotchIcon as Loader2, PencilSimpleIcon as Pencil } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { EmptyState } from "@/components/dashboard/empty-state"
import { adminRoles } from "@/lib/data/admin"
import { campaignTypes, type CampaignType } from "@/lib/data/ads"
import { useAdmin } from "@/lib/stores/admin"
import { cn } from "@/lib/utils"
import { recordTime, usd } from "../format"
import { Facts, ReasonField, validateReason, Warning } from "../reason-dialog"
import { PlatformTable, type Column } from "../table"
import { placementRules } from "./placements"

const types = Object.keys(campaignTypes) as CampaignType[]
const PRICE_ACTION = "Changed ad pricing"
const MAX_PRICE_USD = 100_000

function lastChange(audit: { action: string; target: string; at: string; actor: string }[], t: CampaignType) {
  return audit.find((a) => a.action === PRICE_ACTION && a.target.startsWith(`${campaignTypes[t].name}:`))
}

/** Fixed prices per campaign type, edited only through a confirmed, reasoned change. */
export function PricingPanel() {
  const pricing = useAdmin((s) => s.pricing)
  const audit = useAdmin((s) => s.audit)
  const campaigns = useAdmin((s) => s.campaigns)
  const [editing, setEditing] = useState<CampaignType | null>(null)
  const [open, setOpen] = useState(false)
  const history = useMemo(() => audit.filter((a) => a.action === PRICE_ACTION), [audit])

  const columns: Column<CampaignType>[] = [
    {
      key: "type",
      header: "Campaign type",
      cell: (t) => (
        <span className="block min-w-0 max-w-[320px]">
          <span className="block font-medium text-ink">{campaignTypes[t].name}</span>
          <span className="block truncate text-[11px] text-ink-3" title={campaignTypes[t].description}>{campaignTypes[t].description}</span>
        </span>
      ),
    },
    {
      key: "placements",
      header: "Placements",
      cell: (t) => <span className="block max-w-[220px] truncate text-ink-2">{campaignTypes[t].placements.map((p) => placementRules[p].name).join(", ")}</span>,
    },
    {
      key: "changed",
      header: "Last change",
      cell: (t) => {
        const a = lastChange(audit, t)
        return a ? (
          <span className="whitespace-nowrap text-ink-2" title={recordTime(a.at).title}>
            {recordTime(a.at).label}, {a.actor}
          </span>
        ) : (
          <span className="text-ink-3">Launch price</span>
        )
      },
    },
    {
      key: "price",
      header: "Price",
      align: "right",
      cell: (t) => (
        <span className="whitespace-nowrap">
          <span className="text-ink">{usd(pricing[t])}</span>
          <span className="text-ink-3"> per {campaignTypes[t].unit}</span>
        </span>
      ),
    },
    {
      key: "edit",
      header: "",
      align: "right",
      className: "w-[1%]",
      cell: (t) => (
        <Button size="xs" variant="secondary" onClick={() => edit(t)} aria-label={`Change price of ${campaignTypes[t].name}`}>
          <Pencil aria-hidden /> Change
        </Button>
      ),
    },
  ]

  function edit(t: CampaignType) {
    setEditing(t)
    setOpen(true)
  }

  return (
    <div>
      <p className="px-4 pt-3 pb-3 text-[12px] text-ink-2">
        Fixed prices, published before booking. A change applies to new bookings only: campaigns already booked keep the price they paid.
      </p>
      <PlatformTable
        rows={types}
        columns={columns}
        rowKey={(t) => t}
        caption="Ad prices by campaign type"
        minWidth={820}
        mobileRow={(t) => ({
          title: campaignTypes[t].name,
          meta: `${usd(pricing[t])} per ${campaignTypes[t].unit}`,
          trail: (
            <Button size="xs" variant="secondary" onClick={() => edit(t)} aria-label={`Change price of ${campaignTypes[t].name}`}>
              Change
            </Button>
          ),
        })}
      />

      <div className="border-t border-line-soft px-4 pt-4 pb-4">
        <h3 className="text-[13px] font-medium text-ink">Change history</h3>
        <p className="mt-0.5 text-[11px] text-ink-2">From the audit log. Every change keeps who made it and why.</p>
        {history.length ? (
          <ol className="mt-2 divide-y divide-line-soft">
            <AnimatePresence initial={false}>
              {history.map((a) => (
                <motion.li key={a.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="grid gap-x-4 gap-y-0.5 py-2.5 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)]">
                  <time dateTime={a.at} title={recordTime(a.at).title} className="text-[11px] text-ink-3 md:text-[12px] md:text-ink-2">{recordTime(a.at).label}</time>
                  <span className="min-w-0">
                    <span className="block text-[13px] text-ink tabular">{a.target}</span>
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

      <PriceDialog
        type={editing}
        open={open}
        onOpenChange={setOpen}
        current={editing ? pricing[editing] : 0}
        activeCount={editing ? campaigns.filter((c) => c.type === editing && c.status === "active").length : 0}
        inReview={editing ? campaigns.filter((c) => c.type === editing && c.status === "in_review").length : 0}
      />
    </div>
  )
}

function PriceDialog({ type, open, onOpenChange, current, activeCount, inReview }: { type: CampaignType | null; open: boolean; onOpenChange: (o: boolean) => void; current: number; activeCount: number; inReview: number }) {
  const [pending, setPending] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-md">
        {type ? <PriceForm key={`${type}-${String(open)}`} type={type} current={current} activeCount={activeCount} inReview={inReview} pending={pending} setPending={setPending} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
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

function PriceForm({ type, current, activeCount, inReview, pending, setPending, onDone }: { type: CampaignType; current: number; activeCount: number; inReview: number; pending: boolean; setPending: (p: boolean) => void; onDone: () => void }) {
  const id = useId()
  const setPrice = useAdmin((s) => s.setPrice)
  const t = campaignTypes[type]
  const [price, setPriceText] = useState((current / 100).toString())
  const [reason, setReason] = useState("")
  const [errors, setErrors] = useState<{ price?: string | null; reason?: string | null }>({})

  const parsed = parsePrice(price)
  const next = "cents" in parsed && parsed.cents !== undefined ? parsed.cents : null
  const change = next !== null && current ? (next - current) / current : null

  function validatePrice() {
    if ("error" in parsed) return parsed.error
    if (parsed.cents === current) return "That's the current price. Enter a different amount."
    return null
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    const pErr = validatePrice()
    const rErr = validateReason(reason)
    setErrors({ price: pErr, reason: rErr })
    if (pErr) return document.getElementById(`${id}-price`)?.focus()
    if (rErr) return document.getElementById(`${id}-reason`)?.focus()
    setPending(true)
    try {
      setPrice(type, next!, reason.trim())
      toast.success("Price updated", { description: `${t.name} is now ${usd(next!)} per ${t.unit} for new bookings. Recorded in the audit log.` })
      onDone()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="pr-6 text-[15px] leading-snug">Change the price of {t.name.toLowerCase()}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">New bookings pay the new price from now on. Campaigns already booked keep the price they paid, and brands see the new price before they book.</DialogDescription>
      </DialogHeader>

      <Facts
        facts={[
          { label: "Current price", value: `${usd(current)} per ${t.unit}` },
          { label: "Live and in review", value: `${activeCount} live, ${inReview} in review` },
        ]}
      />

      <div className="grid gap-2">
        <Label htmlFor={`${id}-price`} className="text-[13px]">New price</Label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[13px] text-ink-3" aria-hidden>$</span>
          <Input
            id={`${id}-price`}
            inputMode="decimal"
            autoComplete="off"
            value={price}
            onChange={(e) => {
              setPriceText(e.target.value)
              if (errors.price) setErrors((x) => ({ ...x, price: null }))
            }}
            aria-invalid={!!errors.price}
            aria-describedby={`${id}-price-note`}
            placeholder="0.00"
            className="h-9 rounded-md border-line bg-obsidian/40 pr-24 pl-7 text-[13px] tabular"
          />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12px] text-ink-3">per {t.unit}</span>
        </div>
        {errors.price ? (
          <p id={`${id}-price-note`} role="alert" className="text-xs text-danger">{errors.price}</p>
        ) : (
          <p id={`${id}-price-note`} className="text-[11px] text-ink-3 tabular">
            {next !== null && next !== current && change !== null
              ? `From ${usd(current)} to ${usd(next)}, ${change > 0 ? "up" : "down"} ${Math.abs(change * 100).toFixed(change * 100 % 1 ? 1 : 0)}%.`
              : "In US dollars. Local prices are converted at booking."}
          </p>
        )}
      </div>

      {change !== null && Math.abs(change) >= 0.5 ? <Warning>That&apos;s a change of {Math.round(Math.abs(change) * 100)}%. Check it with ads operations before you confirm; brands planning a booking will notice.</Warning> : null}

      <ReasonField
        id={`${id}-reason`}
        value={reason}
        error={errors.reason ?? null}
        presets={["Demand is above available slots", "Aligning with the published rate card", "Promotional price for new brands"]}
        onChange={(v) => {
          setReason(v)
          if (errors.reason) setErrors((x) => ({ ...x, reason: validateReason(v) }))
        }}
      />

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={pending}>Cancel</Button>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Change price
        </Button>
      </DialogFooter>
    </form>
  )
}
