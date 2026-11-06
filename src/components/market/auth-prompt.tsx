"use client"

import { useId, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { bagButton } from "@/components/market/bag-drawer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { errorMessage } from "@/lib/api/errors"
import { DEMO_SHOPPER, useSession, type AuthIntent, type SessionUser } from "@/lib/stores/session"
import { site } from "@/config/site"

const copy: Record<AuthIntent, { title: string; body: string }> = {
  follow: { title: "Sign in to follow brands", body: "Following puts their new products, drops and stories in your Following feed." },
  save: { title: "Sign in to save pieces", body: "Save pieces from any brand and keep them in one place." },
  notify: { title: "Sign in to get drop alerts", body: "Reminders and draw entries are saved in this browser, and you'll see an alert in Notifications when the drop opens. Email and push aren't connected in this build." },
  checkout: { title: "Sign in to check out", body: "One account for every brand, so your orders and tracking live in one place." },
  account: { title: `Sign in to ${site.name}`, body: "Follow brands, save pieces and track every order in one place." },
  message: { title: "Sign in to message brands", body: "Ask about sizing, stock and delivery. Replies arrive in your Inbox." },
  report: { title: "Sign in to report", body: "Reports go to Yard's trust and safety team." },
}

/** The demo note under every sign-in form (§2.3). */
export const DEMO_SIGN_IN_NOTE = "Demo build: there are no real accounts yet. You'll be signed in as the demo shopper Ada Nwosu."

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

/**
 * Synchronous local sign-in for callers that need the user at once (Studio onboarding's account
 * step). It also starts the server demo session (the shopper Ada, the only one this browser can
 * hold) but keeps the name and email the person typed: the server never silently renames them.
 */
export function useDemoSignIn() {
  const signIn = useSession((s) => s.signIn)
  return (provider: SessionUser["provider"], name = "Ada Nwosu", email = "ada@example.com") => {
    signIn({ id: DEMO_SHOPPER, name, email, provider })
    void useSession
      .getState()
      .signInDemo(provider, { keepProfile: { name, email } })
      .catch(() => {})
  }
}

const EMAIL = /^\S+@\S+\.\S+$/

type AuthErrors = { email?: string; password?: string }

function emailError(email: string) {
  if (!email.trim()) return "Enter your email address."
  if (!EMAIL.test(email.trim())) return "Enter an email address like name@example.com."
}

function passwordError(password: string) {
  if (!password) return "Enter your password."
  if (password.length < 8) return "Use at least 8 characters for your password."
}

/**
 * Social and email sign-in. Email and password are checked together on Continue: each error
 * sits under its own field, the first invalid field takes focus, and typed values stay. An
 * error clears as soon as its field is fixed. Field ids are scoped to the instance: /sign-in and
 * /checkout render their own form while the header can open the prompt's form over it.
 */
export function AuthForm({ onDone }: { onDone?: () => void }) {
  const signInDemo = useSession((s) => s.signInDemo)
  const [busy, setBusy] = useState<SessionUser["provider"] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<AuthErrors>({})
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  const ids = { email: `${uid}-email`, emailError: `${uid}-email-error`, password: `${uid}-password`, passwordError: `${uid}-password-error` }

  // Every method signs in on the server as the demo shopper; the profile comes from the server,
  // so a typed email no longer renames the account (§2.3).
  async function go(provider: SessionUser["provider"]) {
    if (busy) return
    setBusy(provider)
    setFailure(null)
    try {
      await signInDemo(provider)
      onDone?.()
    } catch (e) {
      setFailure(errorMessage(e, "Couldn't sign in. Check your connection and try again."))
    } finally {
      setBusy(null)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: AuthErrors = { email: emailError(email), password: passwordError(password) }
    setErrors(next)
    if (next.email || next.password) {
      window.requestAnimationFrame(() => (next.email ? emailRef : passwordRef).current?.focus())
      return
    }
    void go("email")
  }

  return (
    <div className="grid gap-3">
      <Button variant="secondary" size="lg" className="w-full" loading={busy === "google"} disabled={!!busy && busy !== "google"} onClick={() => void go("google")}>
        <GoogleMark /> Continue with Google
      </Button>
      <Button variant="secondary" size="lg" className="w-full" loading={busy === "apple"} disabled={!!busy && busy !== "apple"} onClick={() => void go("apple")}>
        <AppleMark /> Continue with Apple
      </Button>
      <div className="my-1 flex items-center gap-3 text-xs text-ink-3">
        <span className="h-px flex-1 bg-white/10" /> or with email <span className="h-px flex-1 bg-white/10" />
      </div>
      <form onSubmit={submit} className="grid gap-3" noValidate>
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
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === "email"} disabled={!!busy && busy !== "email"}>Continue</Button>
        {failure ? (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-ink-3">{DEMO_SIGN_IN_NOTE}</p>
      </form>
    </div>
  )
}

/** Opens whenever a guest tries something that needs an account; finishes that action after sign-in. */
export function AuthPrompt() {
  const prompt = useSession((s) => s.authPrompt)
  const dismiss = useSession((s) => s.dismissAuthPrompt)
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
        <p className="text-center text-xs text-ink-3">Every option signs in to the same demo account.</p>
      </DialogContent>
    </Dialog>
  )
}
