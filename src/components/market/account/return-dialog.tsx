"use client"

import { useState } from "react"
import Image from "next/image"
import { ArrowCounterClockwiseIcon as RotateCcw } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
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
 * Request a return for one brand order. In the frontend phase the request lives in the
 * page; the backend turns it into a return record the brand approves or declines.
 */
export function ReturnDialog({ order, brand, onRequested }: { order: MerchantOrder; brand: Brand; onRequested: (r: ReturnRequest) => boolean }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>(order.lines.map((l) => l.variantId))
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [errors, setErrors] = useState<{ items?: string; reason?: string; note?: string }>({})

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (selected.length === 0) next.items = "Choose at least one item to return."
    if (!reason) next.reason = "Choose a reason so the brand can help."
    if (reason === "other" && note.trim().length < 5) next.note = "Tell the brand a little about what went wrong."
    if (note.length > NOTE_MAX) next.note = `Keep the note under ${NOTE_MAX} characters.`
    setErrors(next)
    if (Object.keys(next).length) return
    const ok = onRequested({ reason, reasonLabel: returnReasons.find((r) => r.value === reason)?.label ?? "Other", variantIds: selected, note: note.trim() })
    setOpen(false)
    if (ok) toast("Return requested", { description: `${brand.name} sees it in their Studio now. You'll get a notification here when they reply.` })
    else toast.error("This order can't take a return", { description: "It may already have a request, or it isn't delivered yet." })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setErrors({})
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" className="w-full">
          <RotateCcw /> Request a return
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[480px]">
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
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Send request</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
