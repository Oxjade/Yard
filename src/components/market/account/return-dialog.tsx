"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAsyncAction } from "@/hooks/use-async-action"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { Brand, MerchantOrder } from "@/lib/data/types"

export const returnReasons = [
  { value: "too-small", label: "Too small" },
  { value: "too-large", label: "Too large" },
  { value: "not-as-described", label: "Not as described" },
  { value: "wrong-item", label: "Wrong item sent" },
  { value: "damaged", label: "Arrived damaged or faulty" },
  { value: "unwanted", label: "Changed my mind" },
  { value: "other", label: "Something else" },
] as const

export type ReturnRequest = { reason: string; reasonLabel: string; variantIds: string[]; note: string }

const NOTE_MAX = 500

/**
 * Request a return for one brand order. useOrders().requestReturn stores it on the order,
 * mirrors it to the brand's Studio order and the admin refund queue, and the notification
 * events tell the shopper, the brand and the admins. The order page shows the result in
 * place, so there is no toast; after sending, focus moves to that status (onSent).
 */
export function ReturnDialog({
  order,
  brand,
  open,
  onOpenChange,
  onRequested,
  onSent,
  onCancelled,
}: {
  order: MerchantOrder
  brand: Brand
  open: boolean
  onOpenChange: (open: boolean) => void
  onRequested: (r: ReturnRequest) => boolean
  /** Called once the dialog has closed after a request was recorded. */
  onSent?: () => void
  /** Called once the dialog has closed without sending: return focus to whatever opened it. */
  onCancelled?: () => void
}) {
  const [selected, setSelected] = useState<string[]>(order.lines.map((l) => l.variantId))
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [errors, setErrors] = useState<{ items?: string; reason?: string; note?: string }>({})
  const sent = useRef(false)

  const send = useAsyncAction(
    (r: ReturnRequest) => {
      if (!onRequested(r)) throw new Error("not-returnable")
      return true
    },
    {
      error: "This order can't take a return right now. It may already have a request, or it isn't marked delivered yet.",
      onSuccess: () => {
        sent.current = true
        onOpenChange(false)
      },
    },
  )

  function submit(e: React.FormEvent) {
    e.preventDefault()
    // The action is synchronous, so its in-flight guard has already cleared by a second
    // click; while the dialog animates closed after a recorded request, ignore repeats.
    if (send.pending || send.succeeded || sent.current) return
    const next: typeof errors = {}
    if (selected.length === 0) next.items = "Choose at least one item to return."
    if (!reason) next.reason = "Choose a reason so the brand can help."
    if (reason === "other" && note.trim().length < 5) next.note = "Tell the brand a little about what went wrong."
    if (note.length > NOTE_MAX) next.note = `Keep the note under ${NOTE_MAX} characters.`
    setErrors(next)
    if (Object.keys(next).length) {
      const firstId = next.items ? `ret-${order.lines[0]?.variantId}` : next.reason ? `reason-${returnReasons[0].value}` : "ret-note"
      window.requestAnimationFrame(() => document.getElementById(firstId)?.focus())
      return
    }
    void send.run({ reason, reasonLabel: returnReasons.find((r) => r.value === reason)?.label ?? "Other", variantIds: selected, note: note.trim() })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setErrors({})
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[480px]"
        onCloseAutoFocus={(e) => {
          // Opened without a DialogTrigger, so focus is placed here: on the recorded status
          // once sent (the opening button is gone by then), or back on the opener.
          e.preventDefault()
          if (sent.current) {
            sent.current = false
            onSent?.()
          } else onCancelled?.()
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-display-sm">Request a return</DialogTitle>
          <DialogDescription className="text-ink-2">
            {brand.name} accepts returns within {brand.returnsDays} days of delivery. Your refund goes back to the way you paid once the brand receives the items.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-6">
          {order.lines.length > 1 ? (
            <fieldset className="grid gap-2" aria-describedby={errors.items ? "ret-items-error" : undefined}>
              <legend className="mb-2 text-sm font-medium text-ink">Items to return</legend>
              {order.lines.map((l) => {
                const id = `ret-${l.variantId}`
                const checked = selected.includes(l.variantId)
                return (
                  <div key={l.variantId} className="flex items-center gap-3 rounded-md border border-line-soft p-2">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(c) => setSelected((s) => (c ? [...s, l.variantId] : s.filter((x) => x !== l.variantId)))}
                      aria-invalid={!!errors.items}
                      aria-describedby={errors.items ? "ret-items-error" : undefined}
                    />
                    <span className="relative h-12 w-10 shrink-0 overflow-hidden rounded-md bg-surface">
                      <Image src={l.image.src} alt="" fill sizes="40px" className="object-cover" />
                    </span>
                    <Label htmlFor={id} className="min-w-0 flex-1 font-normal">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">{l.name}</span>
                        <span className="block truncate text-xs text-ink-2">{l.variantLabel}, qty {l.quantity}</span>
                      </span>
                    </Label>
                  </div>
                )
              })}
              {errors.items ? (
                <p id="ret-items-error" role="alert" className="text-xs text-danger">
                  {errors.items}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium text-ink">Reason</legend>
            <RadioGroup
              value={reason}
              onValueChange={setReason}
              aria-label="Reason"
              aria-invalid={!!errors.reason}
              aria-describedby={errors.reason ? "ret-reason-error" : undefined}
              className="gap-1"
            >
              {returnReasons.map((r) => (
                <div key={r.value} className="flex items-center gap-3 rounded-md px-1 py-1.5">
                  <RadioGroupItem id={`reason-${r.value}`} value={r.value} aria-invalid={!!errors.reason} aria-describedby={errors.reason ? "ret-reason-error" : undefined} />
                  <Label htmlFor={`reason-${r.value}`} className="font-normal text-ink">{r.label}</Label>
                </div>
              ))}
            </RadioGroup>
            {errors.reason ? (
              <p id="ret-reason-error" role="alert" className="text-xs text-danger">
                {errors.reason}
              </p>
            ) : null}
          </fieldset>

          <div className="grid gap-1.5">
            <Label htmlFor="ret-note">Note for {brand.name} {reason === "other" ? "" : <span className="font-normal text-ink-3">(optional)</span>}</Label>
            <Textarea
              id="ret-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              aria-invalid={!!errors.note}
              aria-describedby={errors.note ? "ret-note-error ret-note-count" : "ret-note-count"}
              placeholder="Sizing, condition or anything else that helps."
            />
            <div className="flex justify-between gap-3 text-xs">
              {errors.note ? (
                <p id="ret-note-error" role="alert" className="text-danger">
                  {errors.note}
                </p>
              ) : (
                <span />
              )}
              <span id="ret-note-count" className={note.length > NOTE_MAX ? "text-danger tabular" : "text-ink-3 tabular"}>
                {note.length}/{NOTE_MAX}
              </span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={send.pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={send.pending} success={send.succeeded} aria-disabled={send.succeeded || undefined}>
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
