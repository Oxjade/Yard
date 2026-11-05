"use client"

import { useId, useState } from "react"
import { WarningIcon as AlertTriangle, CircleNotchIcon as Loader2 } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { adminRoles, adminUser } from "@/lib/data/admin"
import { cn } from "@/lib/utils"

export type ReasonAction = {
  title: string
  /** What happens when this is confirmed, in one or two sentences. */
  body: string
  confirmLabel: string
  tone: "primary" | "destructive"
  /** Common reasons, offered as one-tap starting points. */
  presets?: string[]
  /** Something the admin should know before confirming (e.g. KYC still in review). */
  warning?: string
}

const MIN_REASON = 10


/**
 * Every sensitive Admin decision goes through this: it states the consequence, requires a
 * reason (which is written to the audit log with the actor) and only then runs the action.
 * While the action runs the confirm button shows a spinner and the dialog can't be closed;
 * the dialog closes itself once the action has finished.
 */
export function ReasonDialog({ action, open, onOpenChange, onConfirm }: { action: ReasonAction | null; open: boolean; onOpenChange: (open: boolean) => void; onConfirm: (reason: string) => void | Promise<void> }) {
  const [pending, setPending] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="gap-5 sm:max-w-md">
        {/* Keyed so every opening starts with an empty, untouched form. */}
        {action ? (
          <ReasonForm
            key={`${action.title}-${String(open)}`}
            action={action}
            pending={pending}
            onCancel={() => onOpenChange(false)}
            onConfirm={async (reason) => {
              setPending(true)
              try {
                await onConfirm(reason)
                onOpenChange(false)
              } finally {
                setPending(false)
              }
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ReasonForm({ action, pending, onCancel, onConfirm }: { action: ReasonAction; pending: boolean; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const id = useId()
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  function validate(value: string) {
    const v = value.trim()
    if (!v) return "Add a reason. It's recorded in the audit log with your name."
    if (v.length < MIN_REASON) return `Say a little more: at least ${MIN_REASON} characters.`
    return null
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    const problem = validate(reason)
    setError(problem)
    if (problem) {
      document.getElementById(`${id}-reason`)?.focus()
      return
    }
    onConfirm(reason.trim())
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="pr-6 text-[15px] leading-snug">{action.title}</DialogTitle>
        <DialogDescription className="text-[13px] text-ink-2">{action.body}</DialogDescription>
      </DialogHeader>

      {action.warning ? (
        <p className="flex items-start gap-2 rounded-md border border-acid/25 bg-acid/5 p-2.5 text-[12px] text-ink">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-acid" aria-hidden />
          {action.warning}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={`${id}-reason`} className="text-[13px]">Reason</Label>
        {action.presets?.length ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common reasons">
            {action.presets.map((p) => {
              const on = reason.trim() === p
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setReason(p)
                    if (error) setError(validate(p))
                  }}
                  className={cn("h-7 rounded-full border px-2.5 text-[11px] transition-colors", on ? "border-violet/40 bg-purple/16 text-ink" : "border-line text-ink-2 hover:bg-elevated hover:text-ink")}
                >
                  {p}
                </button>
              )
            })}
          </div>
        ) : null}
        <Textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            if (error) setError(validate(e.target.value))
          }}
          rows={3}
          placeholder="What did you check, and why this decision?"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
          className="min-h-20 rounded-md border-line bg-obsidian/40 text-[13px]"
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-xs text-danger">{error}</p>
        ) : (
          <p id={`${id}-hint`} className="text-[11px] text-ink-3">Saved to the audit log as {adminUser.name} ({adminRoles[adminUser.role].name.toLowerCase()}). It can&apos;t be edited later.</p>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" variant={action.tone} size="sm" disabled={pending} aria-busy={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {action.confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
