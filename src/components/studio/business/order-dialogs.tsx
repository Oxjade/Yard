"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Brand, MerchantOrder } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { useStudio } from "@/lib/stores/studio"
import { carriersFor, itemCount, payoutEstimate, plural, trackingError } from "./model"
import { Field, control, inputClass, selectClass } from "@/components/studio/catalog/fields"

type DialogProps = { open: boolean; onOpenChange: (open: boolean) => void; order: MerchantOrder }

/** Resets a dialog's form each time it opens, without an effect. */
function useResetOnOpen(open: boolean, reset: () => void) {
  const [prev, setPrev] = useState(open)
  if (open !== prev) {
    setPrev(open)
    if (open) reset()
  }
}

/* ---------- Add / edit tracking ---------- */

const OTHER = "__other"

export function TrackingDialog({ open, onOpenChange, order: o, brand }: DialogProps & { brand: Brand }) {
  const setTracking = useStudio((s) => s.setTracking)
  const carriers = carriersFor(brand.country)
  const initialCarrier = () => (o.tracking ? (carriers.includes(o.tracking.carrier) ? o.tracking.carrier : OTHER) : "")
  const [carrier, setCarrier] = useState(initialCarrier)
  const [otherName, setOtherName] = useState(o.tracking && !carriers.includes(o.tracking.carrier) ? o.tracking.carrier : "")
  const [number, setNumber] = useState(o.tracking?.number ?? "")
  const [submitted, setSubmitted] = useState(false)

  useResetOnOpen(open, () => {
    setCarrier(initialCarrier())
    setOtherName(o.tracking && !carriers.includes(o.tracking.carrier) ? o.tracking.carrier : "")
    setNumber(o.tracking?.number ?? "")
    setSubmitted(false)
  })

  const editing = o.status === "shipped" && !!o.tracking
  const carrierName = carrier === OTHER ? otherName.trim() : carrier
  const errors = {
    carrier: !carrier ? "Choose the carrier." : carrier === OTHER && otherName.trim().length < 2 ? "Enter the carrier's name." : undefined,
    number: trackingError(number),
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (errors.carrier || errors.number) {
      document.getElementById(errors.carrier ? (carrier === OTHER ? "tracking-other" : "tracking-carrier") : "tracking-number")?.focus()
      return
    }
    const clean = number.trim().toUpperCase()
    setTracking(o.id, carrierName, clean)
    onOpenChange(false)
    toast.success(editing ? "Tracking updated" : `#${o.reference} marked as shipped`, {
      description: `${carrierName}, ${clean}. It's on the order timeline.`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit tracking" : "Add tracking"}</DialogTitle>
            <DialogDescription>
              {editing ? "Correct the carrier or number. The change is logged on the timeline." : `Saving tracking marks #${o.reference} as shipped. ${plural(itemCount(o), "item")} to ${o.shippingAddress.city}.`}
            </DialogDescription>
          </DialogHeader>

          <Field id="tracking-carrier" label="Carrier" error={shown.carrier && carrier !== OTHER ? shown.carrier : undefined}>
            <Select value={carrier} onValueChange={setCarrier}>
              <SelectTrigger {...control("tracking-carrier", shown.carrier && carrier !== OTHER ? shown.carrier : undefined)} className={selectClass}>
                <SelectValue placeholder="Choose a carrier" />
              </SelectTrigger>
              <SelectContent position="popper">
                {carriers.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
                <SelectItem value={OTHER}>Another carrier</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {carrier === OTHER ? (
            <Field id="tracking-other" label="Carrier name" error={shown.carrier}>
              <Input {...control("tracking-other", shown.carrier)} value={otherName} onChange={(e) => setOtherName(e.target.value)} className={inputClass} autoComplete="off" />
            </Field>
          ) : null}

          <Field id="tracking-number" label="Tracking number" error={shown.number} hint="From the carrier's receipt or label.">
            <Input {...control("tracking-number", shown.number, true)} value={number} onChange={(e) => setNumber(e.target.value)} className={`${inputClass} tabular uppercase placeholder:normal-case`} placeholder="e.g. GIG4810027731" autoComplete="off" spellCheck={false} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary">{editing ? "Save tracking" : "Mark as shipped"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Cancel ---------- */

const CANCEL_REASONS = ["Out of stock", "Customer asked to cancel", "Can't deliver to this address", "Suspected fraud", "Other"] as const

export function CancelOrderDialog({ open, onOpenChange, order: o }: DialogProps) {
  const setOrderStatus = useStudio((s) => s.setOrderStatus)
  const adjustStock = useStudio((s) => s.adjustStock)
  const products = useStudio((s) => s.products)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [restock, setRestock] = useState(true)
  const [submitted, setSubmitted] = useState(false)

  useResetOnOpen(open, () => {
    setReason("")
    setNote("")
    setRestock(true)
    setSubmitted(false)
  })

  const restockable = o.lines.filter((l) => products.some((p) => p.id === l.productId && p.variants.some((v) => v.id === l.variantId)))
  const restockUnits = restockable.reduce((s, l) => s + l.quantity, 0)
  const errors = {
    reason: !reason ? "Choose a reason. The customer sees it with their refund." : undefined,
    note: reason === "Other" && note.trim().length < 10 ? "Explain in a sentence (10 characters or more)." : note.length > 280 ? "Keep it under 280 characters." : undefined,
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (errors.reason || errors.note) {
      document.getElementById(errors.reason ? "cancel-reason" : "cancel-note")?.focus()
      return
    }
    const detail = note.trim() ? `. ${note.trim().replace(/\.$/, "")}` : ""
    setOrderStatus(o.id, "cancelled", `Cancelled by brand: ${reason.toLowerCase()}${detail}. Full refund to the customer`)
    if (restock) for (const l of restockable) adjustStock(l.productId, l.variantId, l.quantity, "return", `Order #${o.reference} cancelled`)
    onOpenChange(false)
    toast.success(`#${o.reference} cancelled`, {
      description: `The customer is refunded ${formatMoney(o.total, o.currency)} in full.${restock && restockUnits ? ` ${plural(restockUnits, "item")} back in stock.` : ""}`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Cancel order #{o.reference}?</DialogTitle>
            <DialogDescription>The customer gets a full refund of {formatMoney(o.total, o.currency)} and there&apos;s no payout or commission on this order. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>

          <Field id="cancel-reason" label="Reason" error={shown.reason}>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger {...control("cancel-reason", shown.reason)} className={selectClass}>
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent position="popper">
                {CANCEL_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field id="cancel-note" label="Note to the customer" optional={reason !== "Other"} error={shown.note}>
            <Textarea {...control("cancel-note", shown.note)} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={320} placeholder="e.g. The last medium sold in the studio before your order came through." />
          </Field>

          {restockUnits ? (
            <div className="flex items-start gap-2.5">
              <Checkbox id="cancel-restock" checked={restock} onCheckedChange={(v) => setRestock(v === true)} className="mt-0.5" />
              <Label htmlFor="cancel-restock" className="grid gap-0.5 text-[13px] font-normal text-ink">
                Put {plural(restockUnits, "item")} back in stock
                <span className="text-xs text-ink-3">Leave this off if the order was cancelled because the items are missing or damaged.</span>
              </Label>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Keep order</Button>
            <Button type="submit" variant="destructive">Cancel order</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Refund: approve ---------- */

export function ApproveRefundDialog({ open, onOpenChange, order: o }: DialogProps) {
  const setOrderStatus = useStudio((s) => s.setOrderStatus)
  const p = payoutEstimate(o)

  function approve() {
    setOrderStatus(o.id, "refunded", `Refund of ${formatMoney(o.total, o.currency)} approved by brand`)
    onOpenChange(false)
    toast.success("Refund approved", { description: `The payment provider returns ${formatMoney(o.total, o.currency)} to the customer. It can take up to 10 business days to arrive.` })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Approve the refund?</DialogTitle>
          <DialogDescription>The customer is refunded in full through the payment provider. This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2 rounded-lg border border-white/10 p-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-ink-2">Customer receives</dt><dd className="text-ink tabular">{formatMoney(o.total, o.currency)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-2">Your payout changes by</dt><dd className="text-ink tabular">−{formatMoney(p.payout, o.currency)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-2">Commission returned to you</dt><dd className="text-ink tabular">{formatMoney(p.commission, o.currency)}</dd></div>
        </dl>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Not now</Button>
          <Button type="button" variant="primary" onClick={approve}>Approve refund</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Refund: decline ---------- */

export function DeclineRefundDialog({ open, onOpenChange, order: o }: DialogProps) {
  const setOrderStatus = useStudio((s) => s.setOrderStatus)
  const [reason, setReason] = useState("")
  const [submitted, setSubmitted] = useState(false)

  useResetOnOpen(open, () => {
    setReason("")
    setSubmitted(false)
  })

  const len = reason.trim().length
  const error = len < 15 ? "Give the customer a clear reason (15 characters or more)." : len > 500 ? "Keep it under 500 characters." : undefined
  const shown = submitted ? error : undefined

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (error) {
      document.getElementById("decline-reason")?.focus()
      return
    }
    setOrderStatus(o.id, "delivered", `Refund declined by brand: ${reason.trim().replace(/\.$/, "")}`)
    onOpenChange(false)
    toast.success("Refund declined", { description: "The customer sees your reason and can ask the platform to review it." })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Decline the refund?</DialogTitle>
            <DialogDescription>The order goes back to Delivered. Your reason is shared with the customer, who can ask the platform to review the decision.</DialogDescription>
          </DialogHeader>
          <Field id="decline-reason" label="Reason" error={shown} hint={`${len}/500`}>
            <Textarea {...control("decline-reason", shown, true)} value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={520} placeholder="e.g. The returns window for this order closed on 2 November." />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Back</Button>
            <Button type="submit" variant="destructive">Decline refund</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
