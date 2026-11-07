"use client"

import { useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { COMPLAINT_KINDS } from "@/lib/api/contracts/enums"
import { complaintKindLabels, type ComplaintDto } from "@/lib/api/contracts/shipping"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { fileComplaint } from "@/lib/api/shipping"
import { cn } from "@/lib/utils"

const DETAILS_MAX = 1000
type Kind = (typeof COMPLAINT_KINDS)[number]

/**
 * "Problem with delivery?" (§6.5): a Sheet (bottom on phones) with what went wrong and optional
 * details. The complaint goes to the brand; Yard's support team steps in if it isn't sorted within
 * 2 business days. Nothing is sent until the server accepts it.
 */
export function ComplaintForm({ open, onOpenChange, orderId, brandName, onSent }: { open: boolean; onOpenChange: (open: boolean) => void; orderId: string; brandName: string; onSent: (c: ComplaintDto) => void }) {
  const uid = useId()
  const [kind, setKind] = useState<Kind | "">("")
  const [details, setDetails] = useState("")
  const [errors, setErrors] = useState<{ kind?: string; details?: string; form?: string }>({})
  const [pending, setPending] = useState(false)
  const [side, setSide] = useState<"right" | "bottom">("right")

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)")
    const apply = () => setSide(mq.matches ? "bottom" : "right")
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])

  function close(next: boolean) {
    if (!next) {
      setErrors({})
      if (!pending) {
        setKind("")
        setDetails("")
      }
    }
    onOpenChange(next)
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (pending) return
    const next: typeof errors = {}
    if (!kind) next.kind = "Choose what went wrong."
    if (details.length > DETAILS_MAX) next.details = "Keep it to 1,000 characters."
    if (kind === "other" && !details.trim()) next.details = "Tell the brand what happened."
    if (Object.keys(next).length) {
      setErrors(next)
      document.getElementById(next.kind ? `${uid}-kind-${COMPLAINT_KINDS[0]}` : `${uid}-details`)?.focus()
      return
    }
    setPending(true)
    try {
      const c = await fileComplaint(orderId, { kind: kind as Kind, details: details.trim() })
      setPending(false)
      setKind("")
      setDetails("")
      setErrors({})
      onSent(c)
      onOpenChange(false)
    } catch (err) {
      setPending(false)
      const f = fieldErrors(err)
      setErrors({ kind: f.kind, details: f.details, form: f.kind || f.details ? undefined : errorMessage(err, "Your message wasn't sent. Check your connection and try again.") })
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side={side} className={cn("gap-0 border-line-soft bg-surface p-0", side === "right" ? "data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]" : "max-h-[88dvh] rounded-t-2xl")}>
        <form onSubmit={send} noValidate className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="gap-1 border-b border-line-soft p-4 pr-12 md:p-5 md:pr-12">
            <SheetTitle className="text-[15px] text-ink">Problem with delivery?</SheetTitle>
            <SheetDescription className="text-xs text-ink-2">
              We&apos;ll tell {brandName}. Yard&apos;s support team steps in if it isn&apos;t sorted within 2 business days. Refunds and returns stay in Returns.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-5">
            <fieldset className="grid gap-2" aria-describedby={errors.kind ? `${uid}-kind-error` : undefined}>
              <legend className="mb-2 text-[13px] font-medium text-ink">What went wrong?</legend>
              <RadioGroup
                value={kind}
                onValueChange={(v) => {
                  setKind(v as Kind)
                  if (errors.kind) setErrors((x) => ({ ...x, kind: undefined }))
                }}
                aria-label="What went wrong"
                aria-invalid={!!errors.kind}
                className="gap-1.5"
              >
                {COMPLAINT_KINDS.map((k) => {
                  const id = `${uid}-kind-${k}`
                  return (
                    <label key={k} htmlFor={id} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-150", kind === k ? "border-purple bg-purple/10" : "border-line-soft bg-card hover:border-white/20")}>
                      <RadioGroupItem id={id} value={k} aria-invalid={!!errors.kind} />
                      <span className="text-sm text-ink">{complaintKindLabels[k]}</span>
                    </label>
                  )
                })}
              </RadioGroup>
              {errors.kind ? (
                <p id={`${uid}-kind-error`} role="alert" className="text-xs text-danger">
                  {errors.kind}
                </p>
              ) : null}
            </fieldset>
            <div className="mt-5 grid gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor={`${uid}-details`} className="text-[13px] text-ink">
                  Details {kind === "other" ? null : <span className="font-normal text-ink-3">(optional)</span>}
                </Label>
                {details.length > DETAILS_MAX - 200 ? <span className={cn("text-xs tabular", details.length > DETAILS_MAX ? "text-danger" : "text-ink-3")}>{details.length.toLocaleString("en-GB")} / 1,000</span> : null}
              </div>
              <Textarea
                id={`${uid}-details`}
                value={details}
                onChange={(e) => {
                  setDetails(e.target.value)
                  if (errors.details) setErrors((x) => ({ ...x, details: undefined }))
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
                  {brandName} and Yard&apos;s support team read this.
                </p>
              )}
            </div>
          </div>
          <SheetFooter className="gap-2 border-t border-line-soft p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:p-5">
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
                Send to {brandName}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
