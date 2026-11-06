"use client"

import { useRef, useState } from "react"
import { hasErrors, type Errors } from "./validation"

export const STEP_FORM_ID = "onboarding-step-form"

export type StepProps = { onNext: () => void }

function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => {
    const el = form?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]')
    if (!el) return
    const focusable = el.matches("input, textarea, button, [tabindex]")
      ? el
      : (el.querySelector<HTMLElement>('[tabindex="0"], button:not([disabled]), input, textarea') ?? el)
    focusable.focus({ preventScroll: true })
    focusable.scrollIntoView({ block: "center", behavior: "smooth" })
  })
}

/**
 * Validate-on-submit for a wizard step: errors appear after the first Continue, then
 * update live as the merchant fixes them. The Continue button sits in the wizard footer
 * and submits this form through its `form` attribute, so Enter works in every field too.
 */
export function useStepForm(validate: () => Errors, onValid: () => void) {
  const [submitted, setSubmitted] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const errors: Errors = submitted ? validate() : {}

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (hasErrors(validate())) return focusFirstInvalid(formRef.current)
    onValid()
  }

  return { errors, submitted, formRef, onSubmit, fail: () => focusFirstInvalid(formRef.current) }
}

export function StepForm({ formRef, onSubmit, errors, children }: { formRef: React.RefObject<HTMLFormElement | null>; onSubmit: (e: React.FormEvent) => void; errors: Errors; children: React.ReactNode }) {
  const count = Object.values(errors).filter(Boolean).length
  return (
    <form id={STEP_FORM_ID} ref={formRef} noValidate onSubmit={onSubmit} className="grid grid-cols-1 gap-6">
      {children}
      <p role="status" className={count ? "text-xs text-danger" : "sr-only"}>
        {count ? (count === 1 ? "One thing needs fixing before you continue." : `${count} things need fixing before you continue.`) : ""}
      </p>
    </form>
  )
}
