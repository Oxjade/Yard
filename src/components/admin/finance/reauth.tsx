"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/lib/api/client"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/** A 403 that asks for a fresh authenticator code before the action can go through. */
export const needsReauth = (error: unknown) => error instanceof ApiError && error.status === 403 && error.fields?.reauth === "required"

/**
 * Step-up for a sensitive admin action (rule 3): the action is tried first; on a 403 `reauth` the
 * form asks for the authenticator code. `verify()` posts the code once, then clears it, so a retry
 * after a failed action doesn't resend a code that was already used. A refused code shows the
 * server's own field message under the input.
 */
export function useReauth() {
  // A demo admin has no authenticator: development confirms it with { demo: true } (the server refuses that in production).
  const demo = useServerSession((s) => !!s.admin?.demo)
  const [required, setRequired] = useState(false)
  const [code, setCodeValue] = useState("")
  const [codeError, setCodeError] = useState<string | null>(null)
  function reset() {
    setRequired(false); setCodeValue(""); setCodeError(null)
  }
  function setCode(value: string) {
    setCodeValue(value); setCodeError(null)
  }
  /** True when the action may go ahead: no code was asked for, or the code was accepted. */
  async function verify(): Promise<boolean> {
    if (!required) return true
    try {
      await api("/api/auth/reauth", { method: "POST", query: { as: "admin" }, body: demo ? { demo: true } : { code: code.trim() } })
    } catch (cause) {
      const fields = fieldErrors(cause)
      const message = fields.code ?? fields.recoveryCode
      if (message) { setCodeError(message); return false }
      throw cause
    }
    reset()
    return true
  }
  /** True when the error was the reauth ask; the code field then appears. */
  function catches(cause: unknown) {
    if (!needsReauth(cause)) return false
    setRequired(true); setCodeValue(""); setCodeError(null)
    return true
  }
  return { required, demo, code, setCode, codeError, verify, catches, reset, waiting: required && !demo && !code.trim() }
}

export type Reauth = ReturnType<typeof useReauth>

/** The authenticator code input a sensitive form shows once the server asks for it. */
export function ReauthCodeField({ reauth, id, className }: { reauth: Reauth; id: string; className?: string }) {
  if (!reauth.required) return null
  if (reauth.demo)
    return (
      <p className={cn("text-xs text-ink-2", className)} role="status">
        {reauth.codeError ?? "Yard asks you to confirm this action. Demo admin accounts confirm without a code in development: press the button again."}
      </p>
    )
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>Authenticator code</Label>
      <Input id={id} autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" value={reauth.code} onChange={(event) => reauth.setCode(event.target.value)} aria-invalid={!!reauth.codeError} aria-describedby={`${id}-note`} required />
      {reauth.codeError ? <p id={`${id}-note`} role="alert" className="text-xs text-danger">{reauth.codeError}</p> : <p id={`${id}-note`} className="text-xs text-ink-3">Enter the newest 6-digit code from your authenticator app.</p>}
    </div>
  )
}

/** An action's failure: the server's copy, and whether it was a 409 (the record changed), which offers Reload. */
export type ActionError = { message: string; conflict: boolean }
export const actionError = (cause: unknown, fallback: string): ActionError => ({ message: errorMessage(cause, fallback), conflict: cause instanceof ApiError && cause.status === 409 })

export function ActionErrorNote({ error, onReload, className }: { error: ActionError | null; onReload: () => void; className?: string }) {
  if (!error) return null
  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-2 text-sm text-danger", className)}>
      <span className="min-w-0">{error.message}</span>
      {error.conflict ? <Button type="button" size="xs" variant="secondary" onClick={onReload}>Reload</Button> : null}
    </div>
  )
}
