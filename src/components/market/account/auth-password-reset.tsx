"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/lib/api/client"
import { fieldErrors } from "@/lib/api/errors"

export function AuthPasswordReset() {
  const params = useSearchParams()
  const token = params.get("token") ?? ""
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token) {
      setError("This reset link is incomplete. Request a new one.")
      return
    }
    if (password.length < 10) {
      setError("Use at least 10 characters for your new password.")
      return
    }
    if (password !== confirm) {
      setError("Those passwords don’t match.")
      return
    }
    setBusy(true)
    setError(null)
    setPasswordError(null)
    try {
      await api<{ ok: true }>("/api/auth/password/reset", { body: { token, password } })
      setComplete(true)
    } catch (cause) {
      const fields = fieldErrors(cause)
      if (fields.password) setPasswordError(fields.password)
      setError(fields.token ?? (fields.password ? null : cause instanceof ApiError ? cause.message : "This reset link could not be used. Request a new one and try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="font-display text-display-lg text-ink">Reset your password</h1>
      {complete ? (
        <div className="mt-6 max-w-lg">
          <p role="status" className="text-sm leading-relaxed text-ink-2">Your password has been updated. Sign in with the new password.</p>
          <Button asChild variant="primary" className="mt-6"><Link href="/sign-in">Sign in</Link></Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 grid max-w-md gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(event) => { setPassword(event.target.value); setPasswordError(null) }} aria-invalid={!!passwordError} aria-describedby={passwordError ? "new-password-error" : undefined} />
            {passwordError ? <p id="new-password-error" className="text-xs text-danger">{passwordError}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input id="confirm-password" type="password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </div>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" variant="primary" loading={busy} disabled={busy}>Update password</Button>
        </form>
      )}
    </>
  )
}