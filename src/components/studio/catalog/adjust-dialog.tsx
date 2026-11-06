"use client"

import { useState } from "react"
import { Minus, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { availableStock, variantLabel } from "@/lib/data/products"
import type { Product, Variant } from "@/lib/data/types"
import { useStudio, type InventoryEvent } from "@/lib/stores/studio"
import { cn } from "@/lib/utils"
import { control, FieldMessage, Segmented } from "./fields"
import { useCatalog } from "./store"
import { formatDateTime } from "./utils"

export type AdjustReason = Extract<InventoryEvent["reason"], "received" | "adjustment" | "damaged" | "return">

export const reasonLabel: Record<InventoryEvent["reason"], string> = {
  received: "Received",
  adjustment: "Adjustment",
  damaged: "Damaged",
  return: "Return",
  sale: "Sale",
  reservation: "Reservation",
}

const reasonHint: Record<AdjustReason, string> = {
  received: "New stock arrived from production or a supplier.",
  adjustment: "A correction after a count. Say what changed in the note.",
  damaged: "Units that can't be sold any more.",
  return: "A customer return that's back on the shelf.",
}

const NOTE_MAX = 200

/** Which way each reason moves stock. Adjustments can go either way. */
const direction: Record<AdjustReason, 1 | -1 | 0> = { received: 1, return: 1, damaged: -1, adjustment: 0 }

export function AdjustStockDialog({ target, onOpenChange }: { target: { product: Product; variant: Variant } | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[460px]">
        {target ? <AdjustForm key={target.variant.id} product={target.product} variant={target.variant} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function AdjustForm({ product, variant, onDone }: { product: Product; variant: Variant; onDone: () => void }) {
  const adjustStock = useStudio((s) => s.adjustStock)
  const log = useStudio((s) => s.inventoryLog)
  const [reason, setReason] = useState<AdjustReason>("received")
  const [delta, setDelta] = useState("+1")
  const [note, setNote] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const label = variantLabel(variant.options) || "Default variant"
  const n = /^[+-]?\d+$/.test(delta.trim()) ? Number(delta.trim()) : null
  const available = availableStock(variant)
  const nextStock = n === null ? null : variant.stock + n
  const nextAvailable = nextStock === null ? null : Math.max(0, nextStock - variant.reserved)
  const recent = log.filter((e) => e.variantId === variant.id).slice(0, 3)

  function changeReason(r: AdjustReason) {
    setReason(r)
    const d = direction[r]
    if (n !== null && n !== 0 && d !== 0 && Math.sign(n) !== d) setDelta(d > 0 ? `+${-n}` : String(-n))
  }

  function step(by: number) {
    const base = n ?? 0
    let next = base + by
    if (next === 0) next += by
    setDelta(next > 0 ? `+${next}` : String(next))
  }

  function check() {
    const errs: { delta?: string; note?: string } = {}
    if (n === null) errs.delta = "Enter a whole number, like 5 or -2."
    else if (n === 0) errs.delta = "Enter a change other than 0."
    else if (Math.abs(n) > 9999) errs.delta = "That's more than 9,999 units in one go. Check the number."
    else if (direction[reason] === 1 && n < 0) errs.delta = `${reasonLabel[reason]} adds units. Use a positive number.`
    else if (direction[reason] === -1 && n > 0) errs.delta = "Damaged stock removes units. Use a negative number."
    else if (variant.stock + n < variant.reserved) {
      const removable = Math.max(0, variant.stock - variant.reserved)
      errs.delta = variant.reserved ? `You can remove at most ${removable}: ${variant.reserved} of the ${variant.stock} on hand are reserved for open orders.` : `You can remove at most ${variant.stock}.`
    }
    if (reason === "adjustment" && note.trim().length < 3) errs.note = "Say why, for example \"Recount after stocktake\"."
    if (note.length > NOTE_MAX) errs.note = `Keep the note to ${NOTE_MAX} characters or fewer.`
    return errs
  }
  // Validate on submit, then keep messages in step with the fields.
  const errors = submitted ? check() : {}

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = check()
    setSubmitted(true)
    if (Object.values(errs).some(Boolean) || n === null) {
      document.getElementById(errs.delta ? "adj-delta" : "adj-note")?.focus()
      return
    }

    adjustStock(product.id, variant.id, n, reason, note.trim() || undefined)
    useCatalog.getState().touchProducts([product.id])
    toast.success("Stock updated", { description: `${product.name}, ${label}: ${Math.max(0, variant.stock + n - variant.reserved)} available now.` })
    onDone()
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Adjust stock</DialogTitle>
        <DialogDescription className="text-ink-2">
          {product.name}, {label}. <span className="text-xs whitespace-nowrap tabular">{variant.sku}</span>
        </DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-3 gap-2 rounded-lg border border-white/8 bg-white/[0.02] p-3 text-center">
        {[
          { k: "On hand", v: variant.stock },
          { k: "Reserved", v: variant.reserved },
          { k: "Available", v: available },
        ].map((s) => (
          <div key={s.k}>
            <dt className="text-[11px] text-ink-3">{s.k}</dt>
            <dd className="mt-0.5 text-lg font-medium text-ink tabular">{s.v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-1.5">
        <Label htmlFor="adj-reason" className="text-[13px] text-ink">Reason</Label>
        <Segmented
          id="adj-reason"
          label="Reason"
          value={reason}
          onChange={changeReason}
          className="grid grid-cols-2 sm:flex"
          options={[
            { value: "received", label: "Received" },
            { value: "adjustment", label: "Adjustment" },
            { value: "damaged", label: "Damaged" },
            { value: "return", label: "Return" },
          ]}
        />
        <p className="text-xs text-ink-3">{reasonHint[reason]}</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="adj-delta" className="text-[13px] text-ink">Change</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="icon" className="size-11 md:size-10" aria-label="One fewer" onClick={() => step(-1)} disabled={direction[reason] === 1 && (n ?? 0) <= 1}>
            <Minus />
          </Button>
          <Input {...control("adj-delta", errors.delta, true)} value={delta} onChange={(e) => setDelta(e.target.value.replace(/[^\d+-]/g, "").slice(0, 6))} inputMode="numeric" className="h-11 w-24 text-center text-base tabular md:h-10" />
          <Button type="button" variant="secondary" size="icon" className="size-11 md:size-10" aria-label="One more" onClick={() => step(1)} disabled={direction[reason] === -1 && (n ?? 0) >= -1}>
            <Plus />
          </Button>
          {/* Under the stepper on phones, beside it from sm up; a value never breaks across lines. */}
          <p aria-live="polite" className={cn("flex basis-full flex-wrap gap-x-3 text-xs text-ink-2 tabular sm:ml-auto sm:basis-auto sm:flex-col sm:text-right", nextStock !== null && nextStock < variant.reserved && "text-danger")}>
            {nextStock === null ? (
              <span className="whitespace-nowrap">On hand stays the same</span>
            ) : (
              <>
                <span className="whitespace-nowrap">On hand {variant.stock} → {Math.max(0, nextStock)}</span>
                <span className="whitespace-nowrap">Available {available} → {nextAvailable}</span>
              </>
            )}
          </p>
        </div>
        <FieldMessage id="adj-delta" error={errors.delta} hint="Positive adds units, negative removes them." />
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="adj-note" className="text-[13px] text-ink">Note</Label>
          <span className="flex items-baseline gap-2 text-xs text-ink-3">
            {reason === "adjustment" ? "Required" : "Optional"}
            <span className="tabular">{note.length}/{NOTE_MAX}</span>
          </span>
        </div>
        <Textarea {...control("adj-note", errors.note)} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={NOTE_MAX} placeholder={reason === "received" ? "Batch 3 from the Yaba workshop" : reason === "damaged" ? "Print misaligned on the back" : reason === "return" ? "Order 1042, unworn" : "Recount after stocktake"} className="min-h-16" />
        <FieldMessage id="adj-note" error={errors.note} />
      </div>

      {recent.length ? (
        <div className="grid gap-1.5">
          <p className="text-xs text-ink-3">Recent changes</p>
          <ul className="grid gap-1 text-xs">
            {recent.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 text-ink-2">
                <span className="truncate">{reasonLabel[e.reason]}{e.note ? `: ${e.note}` : ""}</span>
                <span className="shrink-0 tabular">
                  <span className={e.delta > 0 ? "text-ink" : "text-ink-2"}>{e.delta > 0 ? `+${e.delta}` : e.delta}</span>
                  <span className="ml-2 text-ink-3">{formatDateTime(e.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary">Update stock</Button>
      </DialogFooter>
    </form>
  )
}
