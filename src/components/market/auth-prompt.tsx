"use client"

import { useEffect, useId, useRef, useState } from "react"
import { UserCircleIcon } from "@phosphor-icons/react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { bagButton } from "@/components/market/bag-drawer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api/client"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { useSession, type AuthIntent, type SessionUser } from "@/lib/stores/session"
import { useServerSession } from "@/lib/session/use-server-session"
import { clearOnboardingAuthReturn } from "@/lib/session/auth-return"
import { site } from "@/config/site"
import { socialButtons, type ProvidersStatus, type SocialButton } from "@/lib/auth/auth0"

const copy: Record<AuthIntent, { title: string; body: string }> = {
  follow: { title: "Sign in to follow brands", body: "Following puts their new products, drops and stories in your Following feed." },
  save: { title: "Sign in to save pieces", body: "Save pieces from any brand and keep them in one place." },
  notify: { title: "Sign in to get drop alerts", body: "Reminders and draw entries are saved in this browser, and you'll see an alert in Notifications when the drop opens. Email and push aren't connected in this build." },
  checkout: { title: "Sign in to check out", body: "One account for every brand, so your orders and tracking live in one place." },
  account: { title: `Sign in to ${site.name}`, body: "Follow brands, save pieces and track every order in one place." },
  message: { title: "Sign in to message brands", body: "Ask about sizing, stock and delivery. Replies arrive in your Inbox." },
  report: { title: "Sign in to report", body: "Reports go to Yard's trust and safety team." },
}

/** The demo note shown only when the server allows demo sign-in. */
export const DEMO_SIGN_IN_NOTE = "Demo sign-in uses the shared shopper account; email sign-in creates or opens your own account."

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.84 0 3.07.78 3.77 1.45l2.57-2.47C16.73 3.74 14.6 2.8 12 2.8 6.98 2.8 2.9 6.88 2.9 11.9S6.98 21 12 21c5.25 0 8.73-3.69 8.73-8.88 0-.6-.07-1.05-.15-1.5z" />
    </svg>
  )
}

export function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="currentColor" d="M16.37 12.6c-.02-2.24 1.83-3.31 1.91-3.37-1.04-1.52-2.66-1.73-3.24-1.75-1.38-.14-2.69.81-3.39.81-.7 0-1.78-.79-2.92-.77-1.5.02-2.89.87-3.66 2.21-1.56 2.71-.4 6.72 1.12 8.92.74 1.08 1.63 2.29 2.79 2.24 1.12-.04 1.54-.72 2.89-.72 1.35 0 1.73.72 2.91.7 1.2-.02 1.96-1.1 2.7-2.18.85-1.25 1.2-2.46 1.22-2.52-.03-.01-2.33-.9-2.33-3.57zM14.14 6.04c.62-.75 1.03-1.78.92-2.82-.89.04-1.96.59-2.6 1.34-.57.66-1.07 1.71-.94 2.73.99.08 2-.5 2.62-1.25z" />
    </svg>
  )
}

/** The mark on a social sign-in button: Google and Apple have their own, anything else a person. */
export function SocialMark({ mark }: { mark: SocialButton["mark"] }) {
  if (mark === "google") return <GoogleMark />
  if (mark === "apple") return <AppleMark />
  return <UserCircleIcon className="size-4" aria-hidden />
}

/** POST /api/auth/oauth/{provider}/start for a social button; resolves to the provider URL. */
export async function startSocialSignIn(button: SocialButton) {
  const body: Record<string, string> = { mode: "signin", actor: "shopper" }
  if (button.connection) body.connection = button.connection
  const { url } = await api<{ url: string }>(`/api/auth/oauth/${button.provider}/start`, { body })
  return url
}

/** Signs in to the server's demo shopper while keeping the name and email entered in onboarding. */
export function useDemoSignIn() {
  return (provider: SessionUser["provider"], name = "Ada Nwosu", email = "ada@example.com") =>
    useSession.getState().signInDemo(provider, { keepProfile: { name, email } })
}

const EMAIL = /^\S+@\S+\.\S+$/

type AuthErrors = { name?: string; email?: string; password?: string }

type AuthMode = "signin" | "signup"

function nameError(name: string) {
  if (!name.trim()) return "Enter your name."
}

function emailError(email: string) {
  if (!email.trim()) return "Enter your email address."
  if (!EMAIL.test(email.trim())) return "Enter an email address like name@example.com."
}

function passwordError(password: string) {
  if (!password) return "Enter your password."
  if (password.length < 10) return "Use at least 10 characters for your password."
}

/**
 * Social and email sign-in. Email and password are checked together on Continue: each error
 * sits under its own field, the first invalid field takes focus, and typed values stay. An
 * error clears as soon as its field is fixed. Field ids are scoped to the instance: /sign-in and
 * /checkout render their own form while the header can open the prompt's form over it.
 */
export function AuthForm({ onDone }: { onDone?: () => void }) {
  const signInDemo = useSession((s) => s.signInDemo)
  const signInWithPassword = useSession((s) => s.signInWithPassword)
  const demoEnabled = useServerSession((s) => s.demoAuth?.shopper === true)
  const [oauthProviders, setOauthProviders] = useState<{ buttons: SocialButton[]; magicLink: boolean }>({ buttons: [], magicLink: false })
  /** A social button's key ("google", "auth0:facebook", …) while its round trip starts. */
  const [busy, setBusy] = useState<"demo" | "email" | "signup" | "forgot" | "magic" | `social:${string}` | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [mode, setMode] = useState<AuthMode>("signin")
  const [signupSent, setSignupSent] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<AuthErrors>({})
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  const ids = { email: `${uid}-email`, emailError: `${uid}-email-error`, password: `${uid}-password`, passwordError: `${uid}-password-error` }

  useEffect(() => {
    let active = true
    void api<ProvidersStatus & { magicLink: boolean }>("/api/auth/providers").then((providers) => {
      if (active) setOauthProviders({ buttons: socialButtons(providers), magicLink: providers.magicLink })
    }).catch(() => {})
    return () => { active = false }
  }, [])

  async function handleDemoSignIn() {
    if (busy) return
    setBusy("demo")
    setFailure(null)
    try {
      await signInDemo("email")
      onDone?.()
    } catch (e) {
      setFailure(errorMessage(e, "Couldn't sign in. Check your connection and try again."))
    } finally {
      setBusy(null)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: AuthErrors = {
      ...(mode === "signup" ? { name: nameError(name) } : {}),
      email: emailError(email),
      password: passwordError(password),
    }
    setErrors(next)
    if (next.name || next.email || next.password) {
      window.requestAnimationFrame(() => (next.name ? nameRef : next.email ? emailRef : passwordRef).current?.focus())
      return
    }
    if (busy) return
    setBusy(mode === "signup" ? "signup" : "email")
    setFailure(null)
    setNotice(null)
    try {
      if (mode === "signup") {
        await api<{ status: "verify_email" }>("/api/auth/sign-up", { body: { name: name.trim(), email: email.trim(), password } })
        // A sign-up from here isn't the brand wizard's: its link mustn't return to onboarding.
        clearOnboardingAuthReturn()
        setSignupSent(true)
        return
      }
      const result = await signInWithPassword(email.trim(), password)
      if (result.status === "verify_email") {
        setFailure("Check your email for a verification link, then sign in again.")
        return
      }
      onDone?.()
    } catch (e) {
      // The server's own field messages (a password that's too easy to guess, say) go under
      // their fields, like the client checks; the summary line only repeats a non-field error.
      const fields = fieldErrors(e)
      const fromServer: AuthErrors = { name: mode === "signup" ? fields.name : undefined, email: fields.email, password: fields.password }
      if (fromServer.name || fromServer.email || fromServer.password) {
        setErrors(fromServer)
        window.requestAnimationFrame(() => (fromServer.name ? nameRef : fromServer.email ? emailRef : passwordRef).current?.focus())
        setFailure(null)
      } else {
        setFailure(errorMessage(e, "Couldn't sign in. Check your email and password, then try again."))
      }
    } finally {
      setBusy(null)
    }
  }

  async function requestPasswordReset() {
    const invalidEmail = emailError(email)
    if (invalidEmail) {
      setErrors((current) => ({ ...current, email: invalidEmail }))
      window.requestAnimationFrame(() => emailRef.current?.focus())
      return
    }
    if (busy) return
    setBusy("forgot")
    setFailure(null)
    setNotice(null)
    try {
      await api<{ ok: true }>("/api/auth/password/forgot", { body: { email: email.trim() } })
      setNotice("If an account exists for that address, a password reset link has been sent.")
    } catch (e) {
      setFailure(errorMessage(e, "Couldn't request a reset link. Try again."))
    } finally {
      setBusy(null)
    }
  }

  async function requestMagicLink() {
    const invalidEmail = emailError(email)
    if (invalidEmail) {
      setErrors((current) => ({ ...current, email: invalidEmail }))
      window.requestAnimationFrame(() => emailRef.current?.focus())
      return
    }
    if (busy) return
    setBusy("magic")
    setFailure(null)
    setNotice(null)
    try {
      await api<{ ok: true }>("/api/auth/magic-link", { body: { email: email.trim() } })
      clearOnboardingAuthReturn()
      setNotice("If an account exists for that address, a sign-in link has been sent.")
    } catch (e) {
      setFailure(errorMessage(e, "Couldn't request a sign-in link. Try again."))
    } finally {
      setBusy(null)
    }
  }

  async function startOAuth(button: SocialButton) {
    if (busy) return
    setBusy(`social:${button.key}`)
    setFailure(null)
    try {
      const url = await startSocialSignIn(button)
      clearOnboardingAuthReturn()
      window.location.assign(url)
    } catch (e) {
      setFailure(errorMessage(e, `Couldn't start ${button.label} sign-in. Try again.`))
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-3">
      {demoEnabled ? <Button variant="secondary" size="lg" className="w-full" loading={busy === "demo"} disabled={!!busy && busy !== "demo"} onClick={() => void handleDemoSignIn()}>Continue as demo shopper</Button> : null}
      {mode === "signin" || mode === "signup" ? oauthProviders.buttons.map((b) => <Button key={b.key} variant="secondary" size="lg" className="w-full" loading={busy === `social:${b.key}`} disabled={!!busy && busy !== `social:${b.key}`} onClick={() => void startOAuth(b)}><SocialMark mark={b.mark} /> Continue with {b.label}</Button>) : null}
      {demoEnabled || ((mode === "signin" || mode === "signup") && oauthProviders.buttons.length > 0) ? <div className="my-1 flex items-center gap-3 text-xs text-ink-3"><span className="h-px flex-1 bg-white/10" /> or with email <span className="h-px flex-1 bg-white/10" /></div> : null}
      {signupSent ? (
        <p role="status" className="rounded-md border border-line-soft bg-card px-4 py-3 text-sm leading-relaxed text-ink-2">
          We sent a verification link to {email.trim()}. Open it to finish creating your account.
        </p>
      ) : null}
      {!signupSent ? (
      <form onSubmit={submit} className="grid gap-3" noValidate>
        {mode === "signup" ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`${uid}-name`}>Name</Label>
            <Input ref={nameRef} id={`${uid}-name`} autoComplete="name" required value={name} onChange={(e) => { setName(e.target.value); if (errors.name && !nameError(e.target.value)) setErrors((x) => ({ ...x, name: undefined })) }} aria-invalid={!!errors.name} className="h-11" />
            {errors.name ? <p className="text-xs text-danger">{errors.name}</p> : null}
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor={ids.email}>Email</Label>
          <Input
            ref={emailRef}
            id={ids.email}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (errors.email && !emailError(e.target.value)) setErrors((x) => ({ ...x, email: undefined }))
            }}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? ids.emailError : undefined}
            className="h-11"
          />
          {errors.email ? <p id={ids.emailError} className="text-xs text-danger">{errors.email}</p> : null}
        </div>
        {mode === "signin" && oauthProviders.magicLink ? <button type="button" className="justify-self-start text-sm text-violet underline-offset-4 hover:underline" disabled={!!busy} onClick={() => void requestMagicLink()}>{busy === "magic" ? "Sending sign-in link…" : "Email me a sign-in link"}</button> : null}
        <div className="grid gap-1.5">
          <Label htmlFor={ids.password}>Password</Label>
          <Input
            ref={passwordRef}
            id={ids.password}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              if (errors.password && !passwordError(e.target.value)) setErrors((x) => ({ ...x, password: undefined }))
            }}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? ids.passwordError : undefined}
            className="h-11"
          />
          {errors.password ? <p id={ids.passwordError} className="text-xs text-danger">{errors.password}</p> : null}
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === "signup" || busy === "email"} disabled={!!busy}>{mode === "signup" ? "Create account" : "Sign in"}</Button>
        {mode === "signin" ? <button type="button" className="justify-self-center text-sm text-violet underline-offset-4 hover:underline" disabled={!!busy} onClick={() => void requestPasswordReset()}>{busy === "forgot" ? "Sending reset link…" : "Forgot password?"}</button> : null}
        {failure ? (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        ) : null}
        {notice ? <p role="status" className="text-xs leading-relaxed text-ink-2">{notice}</p> : null}
        {demoEnabled ? <p className="text-xs leading-relaxed text-ink-3">{DEMO_SIGN_IN_NOTE}</p> : null}
        <button type="button" className="justify-self-center text-sm text-violet underline-offset-4 hover:underline" onClick={() => { setMode((current) => current === "signin" ? "signup" : "signin"); setFailure(null); setErrors({}) }}>
          {mode === "signup" ? "I already have an account" : "Create an account"}
        </button>
      </form>
      ) : null}
    </div>
  )
}

/** Opens whenever a guest tries something that needs an account; finishes that action after sign-in. */
export function AuthPrompt() {
  const prompt = useSession((s) => s.authPrompt)
  const dismiss = useSession((s) => s.dismissAuthPrompt)
  const demoEnabled = useServerSession((s) => s.demoAuth?.shopper === true)
  // Kept through the closing animation, so the title doesn't change as the dialog fades.
  const [intent, setIntent] = useState<AuthIntent>(prompt?.intent ?? "account")
  if (prompt && prompt.intent !== intent) setIntent(prompt.intent)

  // DialogContent hands focus back to what opened the prompt (Checkout, Follow, Save) when it
  // closes, whether the shopper dismissed it or signed in and the action went ahead. When that
  // control has gone (Checkout in the "Added to bag" bubble, which closes as the prompt opens),
  // focus goes to the header's bag button the bubble pointed at.
  return (
    <Dialog open={!!prompt} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="sm:max-w-[420px]" returnFocus={bagButton}>
        <DialogHeader>
          <DialogTitle className="font-display text-display-sm">{copy[intent].title}</DialogTitle>
          <DialogDescription className="text-ink-2">{copy[intent].body}</DialogDescription>
        </DialogHeader>
        <AuthForm />
        {demoEnabled ? <p className="text-center text-xs text-ink-3">Demo sign-in uses the same shared shopper account.</p> : null}
      </DialogContent>
    </Dialog>
  )
}
