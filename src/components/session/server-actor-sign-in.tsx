"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { afterIdentityChange } from "@/lib/session/identity"
import { socialButtons, type ProvidersStatus, type SocialButton } from "@/lib/auth/auth0"
import { SocialMark, startSocialSignIn } from "@/components/auth/social-sign-in"
import { AuthenticatorQr } from "@/components/auth/authenticator-qr"

type Surface = "studio" | "admin"
type ChallengeMode = "enrol" | "verify"
type SignInResponse =
  | { status: "signed_in"; actor: Surface; profile: unknown }
  | { status: "mfa_required" | "mfa_enrol_required"; challenge: string; expiresAt: string }
  | { status: "verify_email" }

type Props = {
  surface: Surface
  /** Runs once the session holds the new identity (after afterIdentityChange), e.g. to leave the sign-in page. */
  onSignedIn?: () => void
  /**
   * True while the one-time recovery codes are on screen: the session is already signed in then
   * (enrol confirm sets the cookie), so a page that leaves on sign-in must wait for "Continue".
   */
  onHold?: (hold: boolean) => void
}

export function ServerActorSignIn({ surface, onSignedIn, onHold }: Props) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<string | null>(null)
  const [challengeMode, setChallengeMode] = useState<ChallengeMode | null>(null)
  const [authenticator, setAuthenticator] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [useRecovery, setUseRecovery] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [sending, setSending] = useState<"forgot" | "verify" | null>(null)
  // Brand Studio also takes the social sign-ins (Control Center stays password + authenticator).
  const [social, setSocial] = useState<SocialButton[]>([])
  const [socialBusy, setSocialBusy] = useState<string | null>(null)

  useEffect(() => {
    if (surface !== "studio") return
    let active = true
    void api<ProvidersStatus>("/api/auth/providers").then((p) => { if (active) setSocial(socialButtons(p)) }).catch(() => {})
    return () => { active = false }
  }, [surface])

  async function startSocial(button: SocialButton) {
    if (busy || socialBusy) return
    setSocialBusy(button.key)
    setFailure(null)
    try {
      window.location.assign(await startSocialSignIn(button, "brand"))
    } catch (error) {
      setFailure(errorMessage(error, `Couldn't start ${button.label} sign-in. Try again.`))
      setSocialBusy(null)
    }
  }

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFailure(null)
    setNotice(null)
    setUnverified(false)
    try {
      const result = await api<SignInResponse>("/api/auth/sign-in", { body: { actor: surface === "studio" ? "brand" : "admin", email: email.trim(), password } })
      if (result.status === "verify_email") {
        setFailure("Verify your email before signing in. Check your inbox for the latest verification link.")
        setUnverified(true)
      } else if (result.status === "signed_in") {
        await afterIdentityChange(surface)
        onSignedIn?.()
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
        onHold?.(true)
        setRecoveryCodes(result.recoveryCodes)
      } else {
        await api("/api/auth/mfa/verify", { body: useRecovery ? { challenge, recoveryCode: recoveryCode.trim() } : { challenge, code: code.replace(/\s/g, "") } })
        await afterIdentityChange("admin")
        onSignedIn?.()
      }
    } catch (error) {
      setFailure(errorMessage(error, "That code could not be verified. Try again."))
    } finally {
      setBusy(false)
    }
  }

  /** Forgot password and resend verification: the same public routes the market sign-in uses. */
  async function sendEmailLink(kind: "forgot" | "verify") {
    if (busy || sending) return
    const address = email.trim()
    if (!address) {
      setFailure("Enter your email address first.")
      return
    }
    setSending(kind)
    setFailure(null)
    setNotice(null)
    try {
      await api<{ ok: true }>(kind === "forgot" ? "/api/auth/password/forgot" : "/api/auth/verify-email/request", { body: { email: address } })
      setNotice(kind === "forgot" ? "If an account exists for that address, a password reset link has been sent." : "If that address still needs verifying, a new verification link has been sent.")
      if (kind === "verify") setUnverified(false)
    } catch (error) {
      setFailure(errorMessage(error, kind === "forgot" ? "Couldn't request a reset link. Try again." : "Couldn't send a new verification link. Try again."))
    } finally {
      setSending(null)
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
        <Button
          variant="primary"
          onClick={() =>
            void afterIdentityChange("admin").then(() => {
              onHold?.(false)
              onSignedIn?.()
            })
          }
        >
          Continue to Control Center
        </Button>
      </section>
    )
  }

  if (challenge && challengeMode) {
    return (
      <form onSubmit={submitCode} className="grid gap-4 rounded-lg border border-line-soft bg-card p-5">
        <div>
          <h2 className="text-base font-medium text-ink">{challengeMode === "enrol" ? "Set up two-factor authentication" : "Verify your sign-in"}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{challengeMode === "enrol" ? "Scan the QR code with an authenticator app, then enter its six-digit code." : useRecovery ? "Enter one of the recovery codes you saved when you set up two-factor authentication. Each code works once." : "Enter the six-digit code from your authenticator app."}</p>
        </div>
        {authenticator ? <AuthenticatorQr otpauthUrl={authenticator.otpauthUrl} secret={authenticator.secret} /> : null}
        {challengeMode === "verify" && useRecovery ? (
          <div className="grid gap-1.5">
            <Label htmlFor="admin-mfa-recovery">Recovery code</Label>
            <Input id="admin-mfa-recovery" autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={10} maxLength={20} required value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} className="font-mono" />
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="admin-mfa-code">Authenticator code</Label>
            <Input id="admin-mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(event) => setCode(event.target.value)} />
          </div>
        )}
        {failure ? <p role="alert" className="text-sm text-danger">{failure}</p> : null}
        <Button type="submit" variant="primary" loading={busy} disabled={busy}>{challengeMode === "enrol" ? "Confirm authenticator" : "Verify and sign in"}</Button>
        {challengeMode === "verify" ? (
          <button type="button" className="justify-self-center text-sm text-violet underline-offset-4 hover:underline" disabled={busy} onClick={() => { setUseRecovery((current) => !current); setFailure(null) }}>
            {useRecovery ? "Use your authenticator app" : "Use a recovery code"}
          </button>
        ) : null}
      </form>
    )
  }

  return (
    <form onSubmit={submitPassword} className="grid gap-4 rounded-lg border border-line-soft bg-card p-5">
      <div>
        <h2 className="text-base font-medium text-ink">Sign in with your account</h2>
        <p className="mt-1 text-sm text-ink-2">{social.length ? "Use the account connected to this workspace." : "Use the email address and password connected to this workspace."}</p>
      </div>
      {social.map((b) => <Button key={b.key} type="button" variant="secondary" className="w-full" loading={socialBusy === b.key} disabled={busy || (!!socialBusy && socialBusy !== b.key)} onClick={() => void startSocial(b)}><SocialMark mark={b.mark} /> Continue with {b.label}</Button>)}
      {social.length ? <div className="flex items-center gap-3 text-xs text-ink-3"><span className="h-px flex-1 bg-white/10" /> or with email <span className="h-px flex-1 bg-white/10" /></div> : null}
      <div className="grid gap-1.5">
        <Label htmlFor={`${surface}-email`}>Email</Label>
        <Input id={`${surface}-email`} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${surface}-password`}>Password</Label>
        <Input id={`${surface}-password`} type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      {failure ? <p role="alert" className="text-sm text-danger">{failure}</p> : null}
      {notice ? <p role="status" className="text-sm leading-relaxed text-ink-2">{notice}</p> : null}
      <Button type="submit" variant="primary" loading={busy} disabled={busy || !!sending}>Sign in</Button>
      {unverified ? (
        <button type="button" className="justify-self-center text-sm text-violet underline-offset-4 hover:underline" disabled={busy || !!sending} onClick={() => void sendEmailLink("verify")}>
          {sending === "verify" ? "Sending verification link…" : "Resend verification email"}
        </button>
      ) : null}
      <button type="button" className="justify-self-center text-sm text-violet underline-offset-4 hover:underline" disabled={busy || !!sending} onClick={() => void sendEmailLink("forgot")}>
        {sending === "forgot" ? "Sending reset link…" : "Forgot password?"}
      </button>
    </form>
  )
}