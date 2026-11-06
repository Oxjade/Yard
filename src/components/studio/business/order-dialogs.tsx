"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Brand, MerchantOrder } from "@/lib/data/types"
import { useAsyncAction } from "@/hooks/use-async-action"
import { formatMoney } from "@/lib/money"
import { returnRefund } from "@/lib/payouts"
import { useOrders } from "@/lib/stores/orders"
import { useStudio } from "@/lib/stores/studio"
import { cancellable, carriersFor, itemCount, payoutEstimate, plural, trackingError } from "./model"
import { syncMessage, syncShipment } from "@/components/studio/shipping/shipment-sync"
import { getServerSessionState } from "@/lib/session/use-server-session"
import { toast } from "sonner"
import { useFocusReturn } from "./shared"
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

/** The order as it is now. A dialog's `order` prop is the one it opened with; a second click reads this. */
const current = (id: string) => useStudio.getState().orders.find((x) => x.id === id)

/**
 * Where focus lands when the control that opened a dialog is gone: deciding a return or cancelling
 * replaces the header's buttons, so focus moves to the heading of the panel that shows the result.
 */
function resultHeading(panelId: string) {
  const h = document.getElementById(`${panelId}-title`)
  if (!h) return null
  h.tabIndex = -1
  h.classList.add("outline-none")
  return h
}

/** Orders the shopper has in this browser have a shopper's copy that follows the brand's changes. */
const shopperSees = (id: string) => useOrders.getState().orders.some((x) => x.id === id)

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

  // Wording is settled before the change: once tracking is saved the order is "shipped", which
  // would make a first save read as an edit.
  const save = useAsyncAction(
    async (carrierName: string, clean: string) => {
      const title = editing ? "Tracking updated" : `#${o.reference} marked as shipped`
      setTracking(o.id, carrierName, clean)
      // Then Yard's server, so the shopper's estimate and notification follow (§6.5).
      const signedIn = !!getServerSessionState().brand
      const r = await syncShipment(o.id, { status: editing ? "in_transit" : "shipped", carrier: carrierName, trackingNumber: clean, note: editing ? "Tracking updated" : undefined }, signedIn)
      const seen = r === "sent" ? syncMessage(r) : r === "not_on_server" ? (shopperSees(o.id) ? "The customer's order in this browser shows it too." : syncMessage(r)) : syncMessage(r)
      return { title, description: `${carrierName}, ${clean}. ${seen}`, warn: r === "signed_out" || r === "queued" }
    },
    {
      onSuccess: (r) => {
        if (r.warn) toast.warning(r.title, { description: r.description })
        else toast.success(r.title, { description: r.description })
        onOpenChange(false)
      },
    },
  )
  // Opened from a row menu on Orders, focus goes back to the order's link in that row, or to the list
  // once the order has moved to another tab; on the order's own page, to the fulfilment panel.
  const focus = useFocusReturn(() => document.querySelector<HTMLElement>(`a[href="/studio/orders/${o.id}"]`) ?? document.getElementById("order-list") ?? resultHeading("fulfilment"))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // A second click while the dialog animates closed, or after the save, does nothing.
    if (!open || save.pending || save.succeeded) return
    setSubmitted(true)
    if (errors.carrier || errors.number) {
      document.getElementById(errors.carrier ? (carrier === OTHER ? "tracking-other" : "tracking-carrier") : "tracking-number")?.focus()
      return
    }
    const clean = number.trim().toUpperCase()
    const now = current(o.id)?.tracking
    // Nothing changed: no timeline entry, the dialog just closes.
    if (now && now.carrier === carrierName && now.number === clean) {
      onOpenChange(false)
      return
    }
    void save.run(carrierName, clean)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]" {...focus}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit tracking" : "Add tracking"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Correct the carrier or number. The change is logged on the timeline and sent to the shopper's order."
                : `Saving tracking marks the order shipped and updates the shopper's estimate: ${plural(itemCount(o), "item")} to ${o.shippingAddress.city}. Contacting the carrier isn't connected in this build, so enter the number from your label.`}
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
            <Button type="submit" variant="primary" loading={save.pending} disabled={save.succeeded}>{editing ? "Save tracking" : "Mark as shipped"}</Button>
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

  const paid = o.paymentStatus === "captured" || o.paymentStatus === "authorized" || o.paymentStatus === "partially_refunded"
  // Wording is settled before the change: cancelling marks the payment refunded.
  const cancel = useAsyncAction(
    () => {
      // Read the order as it is now: a repeat click must never cancel (or restock) twice.
      const before = current(o.id)
      if (!before || !cancellable(before.status)) return null
      const wasPaid = before.paymentStatus === "captured" || before.paymentStatus === "authorized" || before.paymentStatus === "partially_refunded"
      const clean = note.trim().replace(/\.$/, "")
      const detail = clean ? `. ${clean}` : ""
      // The reason travels with the order, so the customer's copy can say why.
      const cancelReason = reason === "Other" ? clean : `${reason}${detail}`
      setOrderStatus(o.id, "cancelled", `Cancelled by brand: ${reason === "Other" ? clean.charAt(0).toLowerCase() + clean.slice(1) : `${reason.toLowerCase()}${detail}`}${wasPaid ? ". Full refund to the customer recorded; not sent, as no payment provider is connected" : ""}`, { cancelReason })
      // Stock goes back only when this call is the one that cancelled the order.
      const restocked = restock && current(o.id)?.status === "cancelled" ? restockUnits : 0
      if (restocked) for (const l of restockable) adjustStock(l.productId, l.variantId, l.quantity, "return", `Order #${o.reference} cancelled`)
      return `${wasPaid ? `A full refund of ${formatMoney(o.total, o.currency)} is recorded. It's sent through the payment provider once one is connected.` : "It was never paid, so there's nothing to refund."}${restocked ? ` ${plural(restocked, "item")} back in stock.` : ""}`
    },
    {
      success: `#${o.reference} cancelled`,
      successDescription: (text) => text ?? undefined,
      onSuccess: () => onOpenChange(false),
    },
  )
  const focus = useFocusReturn(() => resultHeading("fulfilment"))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // A second click while the dialog animates closed does nothing; so does an order that's already cancelled.
    if (!open || cancel.pending || cancel.succeeded) return
    const now = current(o.id)
    if (!now || !cancellable(now.status)) {
      onOpenChange(false)
      return
    }
    setSubmitted(true)
    if (errors.reason || errors.note) {
      document.getElementById(errors.reason ? "cancel-reason" : "cancel-note")?.focus()
      return
    }
    void cancel.run()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" {...focus}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Cancel order #{o.reference}?</DialogTitle>
            <DialogDescription>
              {paid ? `The customer is owed a full refund of ${formatMoney(o.total, o.currency)}, and there's no payout or commission on this order.` : "The order was never paid, so nothing is refunded."} This can&apos;t be undone.
            </DialogDescription>
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
            <Button type="submit" variant="destructive-solid" loading={cancel.pending} disabled={cancel.succeeded}>Cancel order</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Refund: approve ---------- */

export function ApproveRefundDialog({ open, onOpenChange, order: o }: DialogProps) {
  const decideReturn = useStudio((s) => s.decideReturn)
  const p = payoutEstimate(o)
  // The same refund the store records: the returned items, or what was paid for the whole order.
  const refund = returnRefund(o, o.returnRequest?.variantIds)
  const partial = refund.partial
  const commissionBack = refund.commissionBack
  const payoutChange = partial ? refund.itemsSubtotal - commissionBack : p.payout

  const approve = useAsyncAction(
    () => {
      // A partial refund keeps the order delivered: the rest of it still counts towards the payout.
      if (current(o.id)?.status !== "refund_requested") return
      decideReturn(o.id, "approved")
    },
    {
      success: partial ? "Partial refund approved" : "Refund approved",
      successDescription: `${formatMoney(refund.amount, o.currency)} is recorded for the customer. No payment provider is connected in this build, so nothing is sent yet.`,
      onSuccess: () => onOpenChange(false),
    },
  )
  const focus = useFocusReturn(() => resultHeading("return-outcome"))

  function confirm() {
    // A second click while the dialog animates closed, or on a request already decided, does nothing.
    if (!open || approve.pending || approve.succeeded) return
    if (current(o.id)?.status !== "refund_requested") {
      onOpenChange(false)
      return
    }
    void approve.run()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !approve.pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[440px]" {...focus}>
        <DialogHeader>
          <DialogTitle>{partial ? "Approve a partial refund?" : "Approve the refund?"}</DialogTitle>
          <DialogDescription>
            {partial ? `The customer is returning ${plural(refund.units, "item")} of ${itemCount(o)}. The rest of the order stays delivered and still counts towards your payout.` : "The customer is returning the whole order."} The approval is recorded now; the refund goes back through the payment provider once one is connected. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2 rounded-lg border border-white/10 p-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-ink-2">Customer receives</dt><dd className="text-ink tabular">{formatMoney(refund.amount, o.currency)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-2">Your payout changes by</dt><dd className="text-ink tabular">−{formatMoney(payoutChange, o.currency)}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-ink-2">Commission returned to you</dt><dd className="text-ink tabular">{formatMoney(commissionBack, o.currency)}</dd></div>
        </dl>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={approve.pending}>Not now</Button>
          <Button type="button" variant="primary" onClick={confirm} loading={approve.pending} disabled={approve.succeeded}>Approve refund</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Refund: decline ---------- */

export function DeclineRefundDialog({ open, onOpenChange, order: o }: DialogProps) {
  const decideReturn = useStudio((s) => s.decideReturn)
  const [reason, setReason] = useState("")
  const [submitted, setSubmitted] = useState(false)

  useResetOnOpen(open, () => {
    setReason("")
    setSubmitted(false)
  })

  const len = reason.trim().length
  const error = len < 15 ? "Give the customer a clear reason (15 characters or more)." : len > 500 ? "Keep it under 500 characters." : undefined
  const shown = submitted ? error : undefined

  const decline = useAsyncAction(
    () => {
      if (current(o.id)?.status !== "refund_requested") return
      decideReturn(o.id, "declined", reason)
    },
    {
      success: "Return declined",
      successDescription: () => (shopperSees(o.id) ? "The customer's order shows your reason." : "Saved on the order. The customer sees it once orders are connected."),
      onSuccess: () => onOpenChange(false),
    },
  )
  const focus = useFocusReturn(() => resultHeading("return-outcome"))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // A second click while the dialog animates closed, or on a request already decided, does nothing.
    if (!open || decline.pending || decline.succeeded) return
    if (current(o.id)?.status !== "refund_requested") {
      onOpenChange(false)
      return
    }
    setSubmitted(true)
    if (error) {
      document.getElementById("decline-reason")?.focus()
      return
    }
    void decline.run()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" {...focus}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Decline the return?</DialogTitle>
            <DialogDescription>The order goes back to Delivered. Your reason is shown to the customer on their order.</DialogDescription>
          </DialogHeader>
          <Field id="decline-reason" label="Reason" error={shown} hint={`${len}/500`}>
            <Textarea {...control("decline-reason", shown, true)} value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={520} placeholder="e.g. The returns window for this order closed on 2 November." />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Back</Button>
            <Button type="submit" variant="destructive" loading={decline.pending} disabled={decline.succeeded}>Decline return</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Report a delay ---------- */

const DELAY_REASONS = ["Waiting for stock or materials", "Carrier collection delayed", "Held up in transit", "Weather or a public holiday", "Address needs confirming", "Other"] as const

/**
 * Report a delay (§6.5): records an `exception` shipment event on Yard's server, which pushes the
 * shopper's estimate out and tells them it's running late. Needs a brand session (the button says
 * so when there isn't one); the order's timeline in this browser notes it too.
 */
export function ReportDelayDialog({ open, onOpenChange, order: o }: DialogProps) {
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useResetOnOpen(open, () => {
    setReason("")
    setNote("")
    setSubmitted(false)
    setError(null)
  })

  const errors = {
    reason: !reason ? "Choose what's holding it up." : undefined,
    note: reason === "Other" && note.trim().length < 5 ? "Say what's holding it up." : note.length > 200 ? "Keep it under 200 characters." : undefined,
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}

  const report = useAsyncAction(
    async () => {
      const text = reason === "Other" ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason
      const r = await syncShipment(o.id, { status: "exception", note: text.slice(0, 280) }, !!getServerSessionState().brand)
      if (r !== "sent") throw new Error(r)
      const st = useStudio.getState()
      useStudio.setState({ orders: st.orders.map((x) => (x.id === o.id ? { ...x, timeline: [...x.timeline, { at: new Date().toISOString(), label: `Delay reported: ${text}` }] } : x)) })
      return text
    },
    {
      errorToast: false,
      onError: (e) => setError(e instanceof Error && e.message === "not_on_server" ? "Yard's server doesn't hold this order for your brand, so the shopper can't be told from here." : "The delay wasn't recorded. Check your connection and try again."),
      success: "Delay reported",
      successDescription: "The shopper sees that it's running late, with a new estimate.",
      onSuccess: () => onOpenChange(false),
    },
  )
  const focus = useFocusReturn(() => resultHeading("delivery"))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!open || report.pending || report.succeeded) return
    setSubmitted(true)
    if (errors.reason || errors.note) {
      document.getElementById(errors.reason ? "delay-reason" : "delay-note")?.focus()
      return
    }
    setError(null)
    void report.run()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]" {...focus}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Report a delay</DialogTitle>
            <DialogDescription>
              The shopper&apos;s estimate moves out by a few business days and they&apos;re told #{o.reference} is running late. Use it when you know it won&apos;t make the current estimate.
            </DialogDescription>
          </DialogHeader>
          <Field id="delay-reason" label="What's holding it up?" error={shown.reason}>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger {...control("delay-reason", shown.reason)} className={selectClass}>
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent position="popper">
                {DELAY_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="delay-note" label={reason === "Other" ? "Details" : "Details (optional)"} error={shown.note} hint="The shopper sees this on their order.">
            <Textarea {...control("delay-note", shown.note, true)} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={220} placeholder="e.g. The fabric arrives on Monday; it ships the same day." />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={report.pending} disabled={report.succeeded}>Report delay</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
