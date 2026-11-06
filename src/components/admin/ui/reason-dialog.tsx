"use client"

import { useId, useRef, useState } from "react"
import { WarningIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAsyncAction } from "@/hooks/use-async-action"
import { cn } from "@/lib/utils"

const MIN_REASON = 8
const FAILED = "That didn't go through, so nothing was recorded."

export type ReasonFact = { label: string; value: React.ReactNode }

/**
 * Who reads the reason outside the Control Center, from a decision's description, or null
 * when it stays in the audit log. It reads the sentences the decision dialogs write:
 * "Lagos Static is notified in Studio and sees your reason." (audienceLine),
 * "Maya Chen and Lagos Static are notified and see your reason." (Finance refunds) and
 * "Lagos Static sees your reason in Studio." (Advertising). A description that says someone
 * sees the reason without naming them reads as "the people notified".
 */
export function reasonReader(description: string): string | null {
  const who =
    /(?:^|[.!?]\s+)([^.!?]+?) (?:is|are) notified\b[^.!?]*? and sees? your reason\b/.exec(description)?.[1] ??
    /(?:^|[.!?]\s+)([^.!?]+?) sees? your reason\b/.exec(description)?.[1]
  if (who && who.length <= 60) return who.replace(/^The /, "the ")
  return /\bsees? your reason\b/.test(description) ? "the people notified" : null
}

/**
 * Every sensitive action in the Control Center goes through this: a stated reason
 * (recorded in the audit log), then confirm. The length check runs when confirm is
 * pressed, not while typing or on leaving the field; after a failed attempt the message
 * follows the text and clears once it's long enough. Confirming runs through useAsyncAction:
 * the button shows a spinner while it runs, repeat presses are ignored, the dialog can't be
 * closed, and a failure keeps the dialog and the reason so it can be tried again.
 *
 * The field is labelled for whoever reads the reason: `fieldLabel` when given, else
 * "Reason, shown to …" when the description says someone outside the Control Center sees it
 * (reasonReader), else "Reason, for the audit log". The reason field takes focus on open,
 * ahead of any preset chips.
 *
 * Each opening starts with an empty, untouched field, so a reason typed for one record and
 * then cancelled never carries over to the next.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCloseAutoFocus,
  fieldLabel,
  presets,
  facts,
  warning,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: (reason: string) => void | Promise<void>
  /** Where focus goes when the dialog closes, for when the control that opened it is gone (call preventDefault to take over). */
  onCloseAutoFocus?: (e: Event) => void
  /** The field's label, when the description doesn't say who reads the reason (see reasonReader). */
  fieldLabel?: string
  /** Common reasons offered as chips. A chip fills an empty field, or adds itself after text already typed. */
  presets?: string[]
  /** A short line of facts to check before confirming (amount, account, status). */
  facts?: ReasonFact[]
  /** Something to know before confirming, such as KYC still in review. */
  warning?: React.ReactNode
}) {
  const id = useId()
  const [reason, setReason] = useState("")
  const [attempted, setAttempted] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const action = useAsyncAction((r: string) => onConfirm(r), { error: FAILED, onSuccess: () => onOpenChange(false) })
  const { pending } = action
  const failed = !!action.error

  // A fresh opening starts clean (callers that don't remount the dialog per record included).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setReason("")
      setAttempted(false)
      action.reset()
    }
  }

  const reader = fieldLabel ? null : reasonReader(description)
  const label = fieldLabel ?? (reader ? `Reason, shown to ${reader}` : "Reason, for the audit log")

  const text = reason.trim()
  const isPreset = !!presets?.includes(text)
  const problem = !text ? "Add a reason. It's recorded with your name in the audit log." : text.length < MIN_REASON && !isPreset ? `Write at least ${MIN_REASON} characters so the next person understands the decision.` : null
  const error = attempted ? problem : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    setAttempted(true)
    if (problem) {
      field.current?.focus()
      return
    }
    // Closes on success; on failure nothing was recorded, and the dialog keeps the reason.
    void action.run(text)
  }

  function choose(preset: string) {
    setReason((current) => {
      const typed = current.trim()
      if (!typed || presets?.includes(typed)) return preset
      return `${typed}${/[.!?]$/.test(typed) ? "" : "."} ${preset}`
    })
  }

  const describedBy = [error ? `${id}-error` : `${id}-help`, failed ? `${id}-failed` : null].filter(Boolean).join(" ")

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent
        className="sm:max-w-[440px]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          field.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="font-label pr-6 text-base">{title}</DialogTitle>
            <DialogDescription className="text-ink-2">{description}</DialogDescription>
          </DialogHeader>
          {facts?.length ? (
            <dl className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-[var(--admin-hairline)] bg-white/[0.02] px-3 py-2 text-[12px]">
              {facts.map((f) => (
                <div key={f.label} className="flex min-w-0 items-baseline gap-1.5">
                  <dt className="text-ink-3">{f.label}</dt>
                  <dd className="min-w-0 text-ink tabular">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {warning ? (
            <p className="flex items-start gap-2 rounded-md border border-acid/25 bg-acid/5 px-3 py-2.5 text-[12px] leading-snug text-ink">
              <WarningIcon aria-hidden className="mt-px size-3.5 shrink-0 text-acid" />
              <span>{warning}</span>
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-reason`} className="gap-1">
              {label}
              <span aria-hidden className="text-danger">*</span>
            </Label>
            {presets?.length ? (
              <div role="group" aria-label="Common reasons" className="flex flex-wrap gap-1.5 pt-1">
                {presets.map((p) => {
                  const on = text === p
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => choose(p)}
                      disabled={pending}
                      className={cn(
                        "inline-flex h-10 items-center rounded-full border px-3 text-[12px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet disabled:opacity-40 sm:h-7 sm:px-2.5 sm:text-[11.5px]",
                        on ? "border-violet/50 bg-purple/20 text-ink" : "border-line text-ink-2 hover:bg-elevated hover:text-ink",
                      )}
                    >
                      {p}
                    </button>
                  )
                })}
              </div>
            ) : null}
            <Textarea
              ref={field}
              id={`${id}-reason`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
              aria-required
              aria-invalid={!!error}
              aria-describedby={describedBy}
              readOnly={pending}
              placeholder="What you checked and why you're doing this"
            />
            {error ? (
              <p id={`${id}-error`} className="text-xs text-danger">{error}</p>
            ) : (
              <p id={`${id}-help`} className="text-xs text-ink-3">Recorded with your name and the time. It can&apos;t be edited later.</p>
            )}
            {failed ? (
              <p id={`${id}-failed`} role="alert" className="text-xs text-danger">{FAILED} Your reason is still here: try again.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" variant={destructive ? "destructive" : "primary"} loading={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
