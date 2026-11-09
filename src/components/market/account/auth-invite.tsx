"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/lib/api/client"
import { fieldErrors } from "@/lib/api/errors"
import { afterIdentityChange } from "@/lib/session/identity"
import { useServerSession } from "@/lib/session/use-server-session"

type InvitePreview = { brand: { id: string; name: string }; role: string; roleLabel: string; email: string; hasAccount: boolean; expiresAt: string }
type InviteState = { token: string; preview?: InvitePreview; error?: string }

export function AuthInvite() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get("token") ?? ""
  const shopper = useServerSession((state) => state.shopper)
  const [invite, setInvite] = useState<InviteState | null>(null)
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ name?: string; password?: string }>({})
  const current = invite?.token === token ? invite : null

  useEffect(() => {
    let active = true
    if (!token) return () => { active = false }
    void api<InvitePreview>("/api/auth/invites/preview", { body: { token } })
      .then((preview) => { if (active) setInvite({ token, preview }) })
      .catch((cause: unknown) => { if (active) setInvite({ token, error: fieldErrors(cause).token ?? (cause instanceof ApiError ? cause.message : "This invitation could not be loaded.") }) })
    return () => { active = false }
  }, [token])

  async function accept(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || !current?.preview) return
    if (!current.preview.hasAccount && password.length < 10) {
      setFailure(null)
      setErrors({ password: "Use at least 10 characters for your password." })
      return
    }
    setBusy(true)
    setFailure(null)
    setErrors({})
    try {
      await api("/api/auth/invites/accept", {
        body: { token, ...(!current.preview.hasAccount ? { name: name.trim(), password } : {}) },
      })
      await afterIdentityChange("studio")
      router.replace("/studio")
    } catch (cause) {
      const fields = fieldErrors(cause)
      setErrors({ name: fields.name, password: fields.password })
      setFailure(fields.token ?? (fields.name || fields.password ? null : cause instanceof ApiError ? cause.message : "This invitation could not be accepted. Try again."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="font-display text-display-lg text-ink">Join a brand team</h1>
      {current?.error || (!token ? "This invitation is missing its token." : null) ? (
        <p role="alert" className="mt-5 max-w-xl text-sm leading-relaxed text-danger">{current?.error ?? "This invitation is missing its token."}</p>
      ) : !current?.preview ? (
        <p role="status" className="mt-5 text-sm text-ink-2">Checking your invitation…</p>
      ) : (
        <div className="mt-6 max-w-lg">
          <p className="text-sm leading-relaxed text-ink-2">You’ve been invited to join <strong className="font-medium text-ink">{current.preview.brand.name}</strong> as {current.preview.roleLabel}. Invitation for {current.preview.email}.</p>
          {current.preview.hasAccount && (!shopper || shopper.demo) ? (
            <div className="mt-6 grid gap-3">
              <p className="text-sm text-ink-2">Sign in to the invited shopper account before accepting this invitation.</p>
              <Button asChild variant="primary"><Link href={`/sign-in?next=${encodeURIComponent(`/auth/invite?token=${token}`)}`}>Sign in to accept</Link></Button>
            </div>
          ) : (
            <form onSubmit={accept} className="mt-6 grid gap-4">
              {!current.preview.hasAccount ? (
                <>
                  <div className="grid gap-1.5">
                    <Label htmlFor="invite-name">Your name</Label>
                    <Input id="invite-name" autoComplete="name" required maxLength={80} value={name} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })) }} aria-invalid={!!errors.name} aria-describedby={errors.name ? "invite-name-error" : undefined} />
                    {errors.name ? <p id="invite-name-error" className="text-xs text-danger">{errors.name}</p> : null}
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="invite-password">Create a password</Label>
                    <Input id="invite-password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: undefined })) }} aria-invalid={!!errors.password} aria-describedby={errors.password ? "invite-password-error" : undefined} />
                    {errors.password ? <p id="invite-password-error" className="text-xs text-danger">{errors.password}</p> : null}
                  </div>
                </>
              ) : null}
              {failure ? <p role="alert" className="text-sm text-danger">{failure}</p> : null}
              <Button type="submit" variant="primary" loading={busy} disabled={busy}>Accept invitation</Button>
            </form>
          )}
        </div>
      )}
    </>
  )
}