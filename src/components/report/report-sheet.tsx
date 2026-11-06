"use client"

import { useEffect, useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { api, ApiError } from "@/lib/api/client"
import { REPORT_REASONS, reportReasonLabels, reportSubjectLabels, type ReportResult, type ReportSubject } from "@/lib/api/contracts/reports"
import { errorMessage, formatWait } from "@/lib/api/errors"
import { useServerSession } from "@/lib/session/use-server-session"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"

const DETAILS_MAX = 1000

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  subjectType: ReportSubject
  subjectId: string
  /** Which session reports: the marketplace shopper, or the Studio brand member (§1.10). */
  as: "shopper" | "brand"
  /** What's being reported, for the title ("Report this post"). Defaults to the subject type's word. */
  subjectLabel?: string
  /** Replaces the POST (the dev gallery uses it to show states). */
  submit?: (body: { subjectType: ReportSubject; subjectId: string; reason: string; details?: string }) => Promise<ReportResult>
  onReported?: (r: ReportResult) => void
}

/** What a failure says to the reporter. */
function failureCopy(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "conflict") return "You've already reported this. Yard's team is looking at it."
    if (e.code === "rate_limited") return `You've sent a lot of reports today. Try again in ${formatWait(e.retryAfter ?? 3600)}.`
    if (e.code === "unauthenticated") return "Your session ended. Sign in again to report."
    if (e.status === 404) return "Couldn't send your report: this may have been removed already."
  }
  return errorMessage(e, "Couldn't send your report. Check your connection and try again.")
}

/**
 * The one Report flow (§5.3): reason radios for the subject type, optional details (≤ 1000), a
 * sign-in prompt for guests, and the success toast. Opens as a sheet (right on desktop, bottom on
 * phones). S mounts it on posts, A on places and events, I in thread and message menus.
 */
export function ReportSheet({ open, onOpenChange, subjectType, subjectId, as, subjectLabel, submit, onReported }: Props) {
  const uid = useId()
  const reasons = REPORT_REASONS[subjectType]
  const word = subjectLabel ?? reportSubjectLabels[subjectType]
  const [reason, setReason] = useState("")
  const [details, setDetails] = useState("")
  const [errors, setErrors] = useState<{ reason?: string; details?: string; form?: string }>({})
  const [pending, setPending] = useState(false)
  const signedInShopper = useServerSession((s) => !!s.shopper)
  const requireAuth = useSession((s) => s.requireAuth)
  const [side, setSide] = useState<"right" | "bottom">("right")

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)")
    const apply = () => setSide(mq.matches ? "bottom" : "right")
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  function reset() {
    setReason("")
    setDetails("")
    setErrors({})
  }

  // A sheet kept mounted and reused for another post, place or message starts clean: a reason
  // chosen for one subject type may not exist for the next.
  const subjectKey = `${subjectType}:${subjectId}`
  const [shownFor, setShownFor] = useState(subjectKey)
  if (shownFor !== subjectKey) {
    setShownFor(subjectKey)
    reset()
  }

  /** Every way of closing (Cancel, the close button, Escape, the overlay) clears the errors. */
  function close(o: boolean) {
    onOpenChange(o)
    if (!o) setErrors({})
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!reason) next.reason = "Choose a reason."
    if (details.length > DETAILS_MAX) next.details = `Keep the details to ${DETAILS_MAX.toLocaleString("en-GB")} characters.`
    setErrors(next)
    if (next.reason || next.details) {
      window.requestAnimationFrame(() => document.getElementById(next.reason ? `${uid}-reason-${reasons[0]}` : `${uid}-details`)?.focus())
      return
    }
    if (as === "shopper" && !signedInShopper && !submit) {
      // Guests sign in first (§5.3); the sheet stays as they left it.
      requireAuth("report")
      return
    }
    setPending(true)
    try {
      const body = { subjectType, subjectId, reason, ...(details.trim() ? { details: details.trim() } : {}) }
      const r = submit ? await submit(body) : await api<ReportResult>("/api/reports", { query: { as }, body })
      toast.success("Thanks — Yard's trust and safety team will review it.")
      onReported?.(r)
      reset()
      close(false)
    } catch (err) {
      setErrors({ form: failureCopy(err) })
    } finally {
      setPending(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side={side} className={cn("gap-0 border-line-soft bg-surface p-0", side === "right" ? "data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]" : "max-h-[88dvh] rounded-t-2xl")}>
        <form onSubmit={send} noValidate className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="gap-1 border-b border-line-soft p-4 pr-12 md:p-5 md:pr-12">
            <SheetTitle className="text-[15px] text-ink">Report this {word}</SheetTitle>
            <SheetDescription className="text-xs text-ink-2">Reports go to Yard&apos;s trust and safety team. Tell us what&apos;s wrong so the right person looks at it.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-5">
            <fieldset className="grid gap-2" aria-describedby={errors.reason ? `${uid}-reason-error` : undefined}>
              <legend className="mb-2 text-[13px] font-medium text-ink">What&apos;s wrong?</legend>
              <RadioGroup value={reason} onValueChange={(v) => { setReason(v); if (errors.reason) setErrors((x) => ({ ...x, reason: undefined })) }} aria-label="Reason" aria-invalid={!!errors.reason} className="gap-1.5">
                {reasons.map((r) => {
                  const meta = reportReasonLabels[r] ?? { label: r }
                  const id = `${uid}-reason-${r}`
                  return (
                    <label key={r} htmlFor={id} className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150", reason === r ? "border-purple bg-purple/10" : "border-line-soft bg-card hover:border-white/20")}>
                      <RadioGroupItem id={id} value={r} className="mt-0.5" aria-invalid={!!errors.reason} />
                      <span className="min-w-0">
                        <span className="block text-sm text-ink">{meta.label}</span>
                        {meta.hint ? <span className="mt-0.5 block text-xs text-ink-2">{meta.hint}</span> : null}
                      </span>
                    </label>
                  )
                })}
              </RadioGroup>
              {errors.reason ? (
                <p id={`${uid}-reason-error`} role="alert" className="text-xs text-danger">
                  {errors.reason}
                </p>
              ) : null}
            </fieldset>
            <div className="mt-5 grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={`${uid}-details`} className="text-[13px] text-ink">
                  Details <span className="font-normal text-ink-3">(optional)</span>
                </Label>
                {details.length > DETAILS_MAX - 200 ? (
                  <span className={cn("text-xs tabular", details.length > DETAILS_MAX ? "text-danger" : "text-ink-3")}>
                    {details.length.toLocaleString("en-GB")} / {DETAILS_MAX.toLocaleString("en-GB")}
                  </span>
                ) : null}
              </div>
              <Textarea
                id={`${uid}-details`}
                value={details}
                onChange={(e) => {
                  setDetails(e.target.value)
                  if (errors.details && e.target.value.length <= DETAILS_MAX) setErrors((x) => ({ ...x, details: undefined }))
                }}
                rows={4}
                aria-invalid={!!errors.details}
                aria-describedby={errors.details ? `${uid}-details-error` : `${uid}-details-hint`}
                className="min-h-24 bg-card"
              />
              {errors.details ? (
                <p id={`${uid}-details-error`} role="alert" className="text-xs text-danger">
                  {errors.details}
                </p>
              ) : (
                <p id={`${uid}-details-hint`} className="text-xs text-ink-3">
                  Only Yard&apos;s team reads this.
                </p>
              )}
            </div>
          </div>
          <SheetFooter className="gap-2 border-t border-line-soft p-4 md:p-5">
            {errors.form ? (
              <p role="alert" className="text-xs text-danger">
                {errors.form}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={pending}>
                Send report
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
