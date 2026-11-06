"use client"

import { useState } from "react"
import { CircleNotchIcon as Loader2 } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Every sensitive action in the Control Center goes through this: a stated reason
 * (recorded in the audit log), then confirm. The confirm button stays disabled until the
 * reason is specific enough, and shows a pending state while the action runs.
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
}) {
  const [reason, setReason] = useState("")
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const valid = reason.trim().length >= 8

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!valid || pending) return
    setPending(true)
    try {
      await onConfirm(reason.trim())
      setReason("")
      setTouched(false)
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[440px]" onCloseAutoFocus={onCloseAutoFocus}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="font-label text-base">{title}</DialogTitle>
            <DialogDescription className="text-ink-2">{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="reason">Reason, for the audit log</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              rows={3}
              aria-invalid={touched && !valid}
              aria-describedby="reason-help"
              placeholder="What you checked and why you're doing this"
            />
            <p id="reason-help" className={touched && !valid ? "text-xs text-danger" : "text-xs text-ink-3"}>
              {touched && !valid ? "Write at least 8 characters so the next person understands the decision." : "Recorded with your name and the time. It can't be edited later."}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
            <Button type="submit" variant={destructive ? "destructive" : "primary"} disabled={!valid || pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
