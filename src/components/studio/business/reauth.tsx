"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Field, control, inputClass } from "@/components/studio/catalog/fields"
import { ApiError, api } from "@/lib/api/client"
import { fieldErrors } from "@/lib/api/errors"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/** 403 with fields.reauth = "required": the session must confirm it's them before a money action. */
export const needsBrandReauth = (e: unknown) => e instanceof ApiError && e.status === 403 && e.fields?.reauth === "required"

/**
 * Step-up for a Studio money action (refund, cancelling a paid order, receiving a return with its
 * refund). The action is tried first; on a 403 `reauth` the form shows a password field. On the
 * next submit `verify()` posts POST /api/auth/reauth?as=brand once, then the dialog retries the
 * action with the SAME Idempotency-Key it used the first time. Demo brand sessions confirm with
 * { demo: true } (the server only accepts that in development). A refused password shows the
 * server's own message under the field.
 */
export function useBrandReauth(fieldId: string) {
  const demo = useServerSession((s) => !!s.brand?.demo)
  const [required, setRequired] = useState(false)
  const [password, setPasswordValue] = useState("")
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setRequired(false)
    setPasswordValue("")
    setError(null)
  }
  function setPassword(value: string) {
    setPasswordValue(value)
    setError(null)
  }
  const focus = () => window.setTimeout(() => document.getElementById(fieldId)?.focus(), 0)

  /** True when the action may go ahead: nothing was asked for, or the confirmation was accepted. */
  async function verify(): Promise<boolean> {
    if (!required) return true
    if (!demo && !password) {
      setError("Enter your password to confirm.")
      focus()
      return false
    }
    try {
      await api("/api/auth/reauth", { query: { as: "brand" }, body: demo ? { demo: true } : { password } })
    } catch (cause) {
      const message = fieldErrors(cause).password
      if (message) {
        setError(message)
        focus()
        return false
      }
      throw cause
    }
    reset()
    return true
  }

  /** True when the error was the reauth ask: the password field appears and takes focus. */
  function catches(cause: unknown) {
    if (!needsBrandReauth(cause)) return false
    setRequired(true)
    setPasswordValue("")
    setError(null)
    if (!demo) focus()
    return true
  }

  /** The dialog's note after the server asked, e.g. prompt("refund again"). */
  const prompt = (again: string) => (demo ? `Confirm it's you: demo accounts confirm without a password in development. Press the button to ${again}.` : `Confirm it's you: enter your Studio password, then ${again}.`)

  return { fieldId, required, demo, password, setPassword, error, verify, catches, reset, prompt }
}

export type BrandReauth = ReturnType<typeof useBrandReauth>

/** The password input a Studio money dialog shows once the server asks for it (inline, in the same form). */
export function BrandReauthField({ reauth, className }: { reauth: BrandReauth; className?: string }) {
  if (!reauth.required || reauth.demo) return null
  const id = reauth.fieldId
  const error = reauth.error ?? undefined
  return (
    <Field id={id} label="Your password" error={error} hint="Money actions need your password again every few minutes." className={cn(className)}>
      <Input {...control(id, error)} type="password" value={reauth.password} onChange={(e) => reauth.setPassword(e.target.value)} className={inputClass} autoComplete="current-password" />
    </Field>
  )
}
