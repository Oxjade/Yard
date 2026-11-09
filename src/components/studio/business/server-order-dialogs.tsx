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
import { Field, control, inputClass, selectClass } from "@/components/studio/catalog/fields"
import { currencies, type CurrencyCode } from "@/config/markets"
import { ApiError, api } from "@/lib/api/client"
import type { OrderDetailDto } from "@/lib/api/contracts/orders"
import { formatMoney, toMajor } from "@/lib/money"
import { plural } from "./model"
import { useFocusReturn } from "./shared"

/**
 * The order actions a real brand takes on Yard's server record (§ORDERS v3): cancel, refund and
 * the return decisions. The same dialogs as the sample orders' (order-dialogs.tsx), but each one
 * posts to /api/studio/orders/{id}/… and hands the server's updated order back.
 */

type ServerOrder = OrderDetailDto
type Done = (order: ServerOrder | null) => void

const idemKey = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
const orderPath = (o: ServerOrder, rest: string) => `/api/studio/orders/${encodeURIComponent(o.id)}/${rest}`
const cur = (o: ServerOrder) => o.currency as CurrencyCode
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)
/** 403 with fields.reauth = "required": the session must confirm the password before a money action. */
const needsReauth = (e: unknown) => e instanceof ApiError && e.status === 403 && e.fields?.reauth === "required"

/** Resets a dialog's form each time it opens, without an effect. */
function useResetOnOpen(open: boolean, reset: () => void) {
  const [prev, setPrev] = useState(open)
  if (open !== prev) {
    setPrev(open)
    if (open) reset()
  }
}

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  )
}

type Props = { open: boolean; onOpenChange: (open: boolean) => void; order: ServerOrder; onDone: Done }

/* ---------- Cancel ---------- */

const CANCEL_REASONS = ["Out of stock", "Customer asked to cancel", "Can't deliver to this address", "Suspected fraud", "Other"] as const

export function ServerCancelDialog({ open, onOpenChange, order: o, onDone }: Props) {
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [restock, setRestock] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key per opening: a retry after a network error never cancels (or refunds) twice.
  const [key, setKey] = useState(() => idemKey("cancel"))
  useResetOnOpen(open, () => {
    setReason("")
    setNote("")
    setRestock(true)
    setSubmitted(false)
    setError(null)
    setKey(idemKey("cancel"))
  })
  const errors = {
    reason: !reason ? "Choose a reason. The customer sees it with their refund." : undefined,
    note: reason === "Other" && note.trim().length < 10 ? "Explain in a sentence (10 characters or more)." : note.length > 180 ? "Keep it under 180 characters." : undefined,
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}
  const paid = o.states.payment === "paid" || o.states.payment === "partially_refunded"
  const units = o.lines.reduce((n, l) => n + l.qty, 0)
  const focus = useFocusReturn()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!open || busy) return
    setSubmitted(true)
    if (errors.reason || errors.note) {
      document.getElementById(errors.reason ? "s-cancel-reason" : "s-cancel-note")?.focus()
      return
    }
    const clean = note.trim().replace(/\.$/, "")
    const text = reason === "Other" ? clean : clean ? `${reason}. ${clean}` : reason
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ order: ServerOrder }>(orderPath(o, "cancel"), { body: { reason: text.slice(0, 200), restock, idempotencyKey: key } })
      toast.success(`#${o.reference} cancelled`, { description: paid ? `A full refund of ${formatMoney(o.totalMinor, cur(o))} goes back to the customer.` : "It was never paid, so there's nothing to refund." })
      onDone(r.order)
      onOpenChange(false)
    } catch (cause) {
      setError(errorText(cause, "The order wasn't cancelled. Check your connection and try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[460px]" {...focus}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Cancel order #{o.reference}?</DialogTitle>
            <DialogDescription>
              {paid ? `The customer is refunded ${formatMoney(o.totalMinor, cur(o))} in full, and there's no payout or commission on this order.` : "The order was never paid, so nothing is refunded."} This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <Field id="s-cancel-reason" label="Reason" error={shown.reason}>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger {...control("s-cancel-reason", shown.reason)} className={selectClass}>
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent position="popper">
                {CANCEL_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="s-cancel-note" label="Note to the customer" optional={reason !== "Other"} error={shown.note}>
            <Textarea {...control("s-cancel-note", shown.note)} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={200} placeholder="e.g. The last medium sold in the studio before your order came through." />
          </Field>
          {units ? (
            <div className="flex items-start gap-2.5">
              <Checkbox id="s-cancel-restock" checked={restock} onCheckedChange={(v) => setRestock(v === true)} className="mt-0.5" />
              <Label htmlFor="s-cancel-restock" className="grid gap-0.5 text-[13px] font-normal text-ink">
                Put {plural(units, "item")} back in stock
                <span className="text-xs text-ink-3">Leave this off if the order was cancelled because the items are missing or damaged.</span>
              </Label>
            </div>
          ) : null}
          {error ? <FormError>{error}</FormError> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Keep order</Button>
            <Button type="submit" variant="destructive-solid" loading={busy}>Cancel order</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Refund (owner / admin) ---------- */

export function ServerRefundDialog({ open, onOpenChange, order: o, onDone }: Props) {
  const max = o.refundableMinor
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [reauth, setReauth] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(() => idemKey("refund"))
  useResetOnOpen(open, () => {
    setAmount("")
    setReason("")
    setPassword("")
    setReauth(false)
    setSubmitted(false)
    setError(null)
    setKey(idemKey("refund"))
  })
  const majorMax = toMajor(max, cur(o))
  const value = Number(amount.replace(/,/g, ""))
  const minor = Number.isFinite(value) ? Math.round(value * 10 ** (currencies[cur(o)]?.minor ?? 2)) : NaN
  const errors = {
    amount: !amount.trim() || !Number.isFinite(minor) || minor <= 0 ? "Enter the amount to refund." : minor > max ? `You can refund up to ${formatMoney(max, cur(o))}.` : undefined,
    reason: reason.trim().length < 3 ? "Say what the refund is for. The customer sees it." : undefined,
    password: reauth && !password ? "Enter your password to confirm." : undefined,
  }
  const shown: Partial<typeof errors> = submitted ? errors : {}
  const focus = useFocusReturn()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!open || busy) return
    setSubmitted(true)
    const first = errors.amount ? "s-refund-amount" : errors.reason ? "s-refund-reason" : errors.password ? "s-refund-password" : null
    if (first) {
      document.getElementById(first)?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (reauth) await api("/api/auth/reauth", { query: { as: "brand" }, body: { password } })
      const r = await api<{ order: ServerOrder; status: string; duplicate: boolean }>(orderPath(o, "refunds"), { body: { amountMinor: minor, reason: reason.trim(), idempotencyKey: key } })
      toast.success(r.status === "succeeded" ? `Refunded ${formatMoney(minor, cur(o))}` : `Refund of ${formatMoney(minor, cur(o))} requested`, { description: r.status === "succeeded" ? "It's on its way back to the customer." : "The payment provider is processing it. The order updates when it lands." })
      onDone(r.order)
      onOpenChange(false)
    } catch (cause) {
      if (needsReauth(cause)) {
        setReauth(true)
        setError("Confirm it's you: enter your Studio password, then refund again.")
        window.setTimeout(() => document.getElementById("s-refund-password")?.focus(), 0)
      } else setError(errorText(cause, "The refund wasn't sent. Check your connection and try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[440px]" {...focus}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Refund the customer</DialogTitle>
            <DialogDescription>
              A goodwill or partial refund on #{o.reference}, sent through the payment provider. Up to {formatMoney(max, cur(o))} is left to refund. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <Field id="s-refund-amount" label={`Amount (${o.currency})`} error={shown.amount}>
            <Input {...control("s-refund-amount", shown.amount)} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${inputClass} tabular`} placeholder={String(majorMax)} autoComplete="off" />
          </Field>
          <Field id="s-refund-reason" label="Reason" error={shown.reason} hint="The customer sees this with the refund.">
            <Input {...control("s-refund-reason", shown.reason, true)} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={inputClass} placeholder="e.g. A button came loose; sorry about that." autoComplete="off" />
          </Field>
          {reauth ? (
            <Field id="s-refund-password" label="Your password" error={shown.password}>
              <Input {...control("s-refund-password", shown.password)} type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoComplete="current-password" />
            </Field>
          ) : null}
          {error ? <FormError>{error}</FormError> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Not now</Button>
            <Button type="submit" variant="primary" loading={busy}>Refund</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Returns: approve, decline, receive ---------- */

export type ReturnMode = "approve" | "decline" | "receive"

export function ServerReturnDialog({ open, onOpenChange, order: o, returnId, mode, onDone }: Props & { returnId: string; mode: ReturnMode }) {
  const ret = o.returns.find((r) => r.id === returnId)
  const [reason, setReason] = useState("")
  const [restock, setRestock] = useState(true)
  const [refund, setRefund] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [key, setKey] = useState(() => idemKey("receive"))
  useResetOnOpen(open, () => {
    setReason("")
    setRestock(true)
    setRefund(true)
    setSubmitted(false)
    setError(null)
    setKey(idemKey("receive"))
  })
  const len = reason.trim().length
  const reasonError = mode === "decline" ? (len < 15 ? "Give the customer a clear reason (15 characters or more)." : len > 300 ? "Keep it under 300 characters." : undefined) : undefined
  const shown = submitted ? reasonError : undefined
  const units = ret?.lines.reduce((n, l) => n + l.qty, 0) ?? 0
  const focus = useFocusReturn()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!open || busy || !ret) return
    setSubmitted(true)
    if (reasonError) {
      document.getElementById("s-return-reason")?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r =
        mode === "receive"
          ? await api<{ order: ServerOrder }>(orderPath(o, `returns/${encodeURIComponent(ret.id)}/receive`), { body: { restock, refund, idempotencyKey: key } })
          : await api<{ order: ServerOrder }>(orderPath(o, `returns/${encodeURIComponent(ret.id)}/decision`), { body: mode === "approve" ? { decision: "approve" } : { decision: "reject", reason: reason.trim() } })
      toast.success(mode === "approve" ? "Return approved" : mode === "decline" ? "Return declined" : "Return received", {
        description: mode === "approve" ? "The customer is told to send the items back. Mark them received when they arrive." : mode === "decline" ? "The customer's order shows your reason." : refund ? "The refund for the returned items goes back to the customer." : "Recorded without a refund.",
      })
      onDone(r.order)
      onOpenChange(false)
    } catch (cause) {
      setError(errorText(cause, "That didn't go through. Check your connection and try again."))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === "approve" ? "Approve the return?" : mode === "decline" ? "Decline the return?" : "Mark the return received?"
  const description =
    mode === "approve"
      ? `The customer is asked to send back ${plural(units, "item")}. The refund goes out when you mark them received.`
      : mode === "decline"
        ? "The order goes back to Delivered. Your reason is shown to the customer on their order."
        : `${plural(units, "item")} came back to the studio.`

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[460px]" {...focus}>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {mode === "decline" ? (
            <Field id="s-return-reason" label="Reason" error={shown} hint={`${len}/300`}>
              <Textarea {...control("s-return-reason", shown, true)} value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={300} placeholder="e.g. The returns window for this order closed on 2 November." />
            </Field>
          ) : null}
          {mode === "receive" ? (
            <div className="grid gap-3">
              <div className="flex items-start gap-2.5">
                <Checkbox id="s-return-restock" checked={restock} onCheckedChange={(v) => setRestock(v === true)} className="mt-0.5" />
                <Label htmlFor="s-return-restock" className="grid gap-0.5 text-[13px] font-normal text-ink">
                  Put {plural(units, "item")} back in stock
                  <span className="text-xs text-ink-3">Leave this off if they came back damaged.</span>
                </Label>
              </div>
              <div className="flex items-start gap-2.5">
                <Checkbox id="s-return-refund" checked={refund} onCheckedChange={(v) => setRefund(v === true)} className="mt-0.5" />
                <Label htmlFor="s-return-refund" className="grid gap-0.5 text-[13px] font-normal text-ink">
                  Refund the returned items now
                  <span className="text-xs text-ink-3">Sent through the payment provider.</span>
                </Label>
              </div>
            </div>
          ) : null}
          {error ? <FormError>{error}</FormError> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>Back</Button>
            <Button type="submit" variant={mode === "decline" ? "destructive" : "primary"} loading={busy}>
              {mode === "approve" ? "Approve return" : mode === "decline" ? "Decline return" : "Mark received"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
