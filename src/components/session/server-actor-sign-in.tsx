"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { afterIdentityChange } from "@/lib/session/identity"

type Surface = "studio" | "admin"
type ChallengeMode = "enrol" | "verify"
type SignInResponse =
  | { status: "signed_in"; actor: Surface; profile: unknown }
  | { status: "mfa_required" | "mfa_enrol_required"; challenge: string; expiresAt: string }
  | { status: "verify_email" }

export function ServerActorSignIn({ surface }: { surface: Surface }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<string | null>(null)
  const [challengeMode, setChallengeMode] = useState<ChallengeMode | null>(null)
  const [authenticator, setAuthenticator] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await api<SignInResponse>("/api/auth/sign-in", { body: { actor: surface === "studio" ? "brand" : "admin", email: email.trim(), password } })
      if (result.status === "verify_email") {
        setFailure("Verify your email before signing in. Check your inbox for the latest verification link.")
      } else if (result.status === "signed_in") {
        await afterIdentityChange(surface)
      } else {
        setChallenge(result.challenge)
        setChallengeMode(result.status === "mfa_enrol_required" ? "enrol" : "verify")
        if (result.status === "mfa_enrol_required") {
          const setup = await api<{ secret: string; otpauthUrl: string }>("/api/auth/mfa/enrol", { body: { challenge: result.challenge } })
          setAuthenticator(setup)
        }
      }
    } catch (error) {
      setFailure(errorMessage(error, "Couldn't sign in. Check your details and try again."))
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!challenge || !challengeMode || busy) return
    setBusy(true)
    setFailure(null)
    try {
      if (challengeMode === "enrol") {
        const result = await api<{ recoveryCodes: string[] }>("/api/auth/mfa/enrol/confirm", { body: { challenge, code: code.replace(/\s/g, "") } })
        setRecoveryCodes(result.recoveryCodes)
      } else {
        await api("/api/auth/mfa/verify", { body: { challenge, code: code.replace(/\s/g, "") } })
        await afterIdentityChange("admin")
      }
    } catch (error) {
      setFailure(errorMessage(error, "That code could not be verified. Try again."))
    } finally {
      setBusy(false)
    }
  }

  if (recoveryCodes) {
    return (
      <section className="grid gap-4 rounded-lg border border-line-soft bg-card p-5" aria-labelledby="recovery-title">
        <div>
          <h2 id="recovery-title" className="text-base font-medium text-ink">Save your recovery codes</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">These one-time codes are the only way back in if you lose your authenticator. Store them somewhere private.</p>
        </div>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-ink">{recoveryCodes.map((item) => <li key={item}>{item}</li>)}</ul>
        <Button variant="primary" onClick={() => void afterIdentityChange("admin")}>Continue to Control Center</Button>
      </section>
    )
  }

  if (challenge && challengeMode) {
    return (
      <form onSubmit={submitCode} className="grid gap-4 rounded-lg border border-line-soft bg-card p-5">
        <div>
          <h2 className="text-base font-medium text-ink">{challengeMode === "enrol" ? "Set up two-factor authentication" : "Verify your sign-in"}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{challengeMode === "enrol" ? "Add this key to an authenticator app, then enter its six-digit code." : "Enter the six-digit code from your authenticator app."}</p>
        </div>
        {authenticator ? <p className="break-all rounded-md bg-obsidian px-3 py-2 font-mono text-xs text-ink" aria-label="Authenticator setup key">{authenticator.secret}</p> : null}
        <div className="grid gap-1.5">
          <Label htmlFor="admin-mfa-code">Authenticator code</Label>
          <Input id="admin-mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        {failure ? <p role="alert" className="text-sm text-danger">{failure}</p> : null}
        <Button type="submit" variant="primary" loading={busy} disabled={busy}>{challengeMode === "enrol" ? "Confirm authenticator" : "Verify and sign in"}</Button>
      </form>
    )
  }

  return (
    <form onSubmit={submitPassword} className="grid gap-4 rounded-lg border border-line-soft bg-card p-5">
      <div>
        <h2 className="text-base font-medium text-ink">Sign in with your account</h2>
        <p className="mt-1 text-sm text-ink-2">Use the email address and password connected to this workspace.</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${surface}-email`}>Email</Label>
        <Input id={`${surface}-email`} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${surface}-password`}>Password</Label>
        <Input id={`${surface}-password`} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      {failure ? <p role="alert" className="text-sm text-danger">{failure}</p> : null}
      <Button type="submit" variant="primary" loading={busy} disabled={busy}>Sign in</Button>
    </form>
  )
}