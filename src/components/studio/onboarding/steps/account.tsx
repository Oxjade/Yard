"use client"

import { useEffect, useRef, useState } from "react"
import { EyeIcon as Eye, EyeSlashIcon as EyeOff } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { AppleMark, GoogleMark, useDemoSignIn } from "@/components/market/auth-prompt"
import { useHydrated } from "@/hooks/use-hydrated"
import { api } from "@/lib/api/client"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { afterIdentityChange } from "@/lib/session/identity"
import { setOnboardingAuthReturn, clearOnboardingAuthReturn } from "@/lib/session/auth-return"
import { useServerSession } from "@/lib/session/use-server-session"
import { useSession, type SessionUser } from "@/lib/stores/session"
import { control, Field, inputClass, Panel } from "@/components/studio/growth/form"
import { StepForm, useStepForm, type StepProps } from "../step-form"
import { useOnboarding } from "../store"
import { isEmail } from "../validation"

const providerLabel: Record<SessionUser["provider"], string> = { google: "Google", apple: "Apple", email: "email" }

type AuthMode = "signup" | "signin"
type ProviderStatus = { google: boolean; apple: boolean; demo: { shopper: boolean } }
type AuthResponse =
  | { status: "signed_in"; actor: "shopper"; profile: { id: string; name: string; email: string } }
  | { status: "verify_email" }
  | { status: "mfa_required" | "mfa_enrol_required"; challenge: string; expiresAt: string }

const emptyProviders: ProviderStatus = { google: false, apple: false, demo: { shopper: false } }

export function AccountStep({ onNext }: StepProps) {
  const hydrated = useHydrated()
  const user = useSession((s) => s.user)
  const signOut = useSession((s) => s.signOut)
  const serverSession = useServerSession()
  const demoSignIn = useDemoSignIn()
  const account = useOnboarding((s) => s.data.account)
  const update = useOnboarding((s) => s.update)

  const [providers, setProviders] = useState(emptyProviders)
  const [mode, setMode] = useState<AuthMode>("signup")
  const [name, setName] = useState(account.name)
  const [email, setEmail] = useState(account.email)
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState<"email" | "google" | "apple" | "demo" | "resend" | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [serverErrors, setServerErrors] = useState<{ name?: string; email?: string; password?: string }>({})
  const pendingRef = useRef<HTMLDivElement>(null)
  const signedIn = hydrated ? user : null
  const demoSession = serverSession.shopper?.demo === true

  useEffect(() => {
    let active = true
    void api<ProviderStatus>("/api/auth/providers")
      .then((status) => {
        if (active) setProviders(status)
      })
      .catch(() => {
        if (active) setProviders(emptyProviders)
      })
    return () => { active = false }
  }, [])

  function adopt(u: SessionUser) {
    update("account", { name: u.name, email: u.email, provider: u.provider })
    const business = useOnboarding.getState().data.business
    if (!business.contactEmail) update("business", { contactEmail: u.email })
  }

  async function social(provider: "google" | "apple") {
    if (busy) return
    setBusy(provider)
    setFailure(null)
    setOnboardingAuthReturn()
    try {
      const { url } = await api<{ url: string }>(`/api/auth/oauth/${provider}/start`, { body: { mode: "signin", actor: "shopper" } })
      window.location.assign(url)
    } catch (error) {
      clearOnboardingAuthReturn()
      setFailure(errorMessage(error, `Couldn't start ${provider} sign-in. Try again.`))
      setBusy(null)
    }
  }

  async function authenticate() {
    if (busy) return
    setBusy("email")
    setFailure(null)
    setNotice(null)
    setNeedsVerification(false)
    setServerErrors({})
    try {
      if (mode === "signup") {
        await api<{ status: "verify_email" }>("/api/auth/sign-up", { body: { name: name.trim(), email: email.trim(), password } })
        setOnboardingAuthReturn()
        // An address that already has an account gets a sign-in link instead, so name neither.
        showPending(`We sent a link from Yard to ${email.trim()}. Open it on this device to come straight back here.`)
        return
      }

      const result = await api<AuthResponse>("/api/auth/sign-in", { body: { actor: "shopper", email: email.trim(), password } })
      if (result.status === "verify_email") {
        setOnboardingAuthReturn()
        showPending(`Verify ${email.trim()} using the link from Yard in your inbox. Open it on this device to come straight back here.`)
        return
      }
      if (result.status !== "signed_in") {
        setFailure("This account requires administrator verification and can't start a brand application.")
        return
      }

      await afterIdentityChange("market")
      const signedIn: SessionUser = { ...result.profile, provider: "email" }
      useSession.getState().signIn(signedIn)
      clearOnboardingAuthReturn()
      adopt(signedIn)
      onNext()
    } catch (error) {
      const fields = fieldErrors(error)
      const nextErrors = { name: fields.name, email: fields.email, password: fields.password }
      setServerErrors(nextErrors)
      setFailure(Object.values(nextErrors).some(Boolean) ? null : errorMessage(error, "Couldn't continue. Check your details and try again."))
    } finally {
      setBusy(null)
    }
  }

  /** The link is on its way: swap the form for a clear inbox state and bring it into view (the phone action bar would hide a notice at the bottom). */
  function showPending(message: string) {
    setNeedsVerification(true)
    setNotice(message)
    focusPending()
  }

  function focusPending() {
    requestAnimationFrame(() => {
      const el = pendingRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: "start", behavior: "smooth" })
    })
  }

  function leavePending(next: AuthMode) {
    setNeedsVerification(false)
    setNotice(null)
    setFailure(null)
    setPassword("")
    setMode(next)
  }

  async function resendVerification() {
    if (busy) return
    setBusy("resend")
    setFailure(null)
    setNotice(null)
    try {
      await api<{ ok: true }>("/api/auth/verify-email/request", { body: { email: email.trim() } })
      setNotice("If this account still needs verification, a fresh link has been sent.")
    } catch (error) {
      setFailure(errorMessage(error, "Couldn't send a new verification link. Try again."))
    } finally {
      setBusy(null)
    }
  }

  async function signInDemo() {
    if (busy) return
    setBusy("demo")
    setFailure(null)
    try {
      const demoUser = await demoSignIn("email", name.trim() || "Ada Nwosu", email.trim() || "ada@example.com")
      adopt(demoUser)
      onNext()
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const form = useStepForm(
    () =>
      signedIn || needsVerification
        ? {}
        : {
            name: mode === "signup" && name.trim().length < 2 ? "Enter your full name." : undefined,
            email: isEmail(email) ? undefined : "Enter a valid email address.",
            password: mode === "signup" && password.length < 10 ? "Use at least 10 characters for your password." : !password ? "Enter your password." : undefined,
          },
    () => {
      if (signedIn) {
        adopt(signedIn)
        onNext()
        return
      }
      // Waiting on the emailed link: Continue mustn't sign up a second time.
      if (needsVerification) return focusPending()
      void authenticate()
    },
  )
  const e = { ...form.errors, ...serverErrors }

  if (signedIn) {
    return (
      <StepForm formRef={form.formRef} onSubmit={form.onSubmit} errors={{}}>
        <Panel title="Signed in" description="Your brand will belong to this account. You can invite your team from Settings later.">
          <div className="flex items-center gap-3 rounded-md border border-line-soft bg-surface/50 p-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-purple text-sm font-semibold text-ink" aria-hidden>
              {signedIn.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{signedIn.name}</p>
              <p className="truncate text-xs text-ink-2">{signedIn.email}</p>
              <p className="text-xs text-ink-3">{demoSession ? `Demo ${providerLabel[signedIn.provider]} account on this device` : `${providerLabel[signedIn.provider]} account`}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3 -ml-2"
            onClick={async () => {
              if (!(await signOut())) return
              update("account", { name: "", email: "", provider: null })
              setMode("signup")
            }}
          >
            Use a different account
          </Button>
        </Panel>
      </StepForm>
    )
  }

  if (needsVerification) {
    return (
      <StepForm formRef={form.formRef} onSubmit={form.onSubmit} errors={{}}>
        <div ref={pendingRef} tabIndex={-1} className="scroll-mt-24 outline-none">
          <Panel title="Check your inbox" description="Your account is almost ready. Finish with the link we emailed, then carry on with your brand.">
            {notice ? <p role="status" className="text-sm text-ink-2">{notice}</p> : null}
            {failure ? <p role="alert" className="mt-3 text-sm text-danger">{failure}</p> : null}
            <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
              <Button type="button" variant="secondary" size="sm" loading={busy === "resend"} disabled={!!busy} onClick={() => void resendVerification()}>Resend the link</Button>
              <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => leavePending("signin")}>I’ve verified, sign in</Button>
              <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => leavePending("signup")}>Use a different email</Button>
            </div>
          </Panel>
        </div>
      </StepForm>
    )
  }

  return (
    <StepForm formRef={form.formRef} onSubmit={form.onSubmit} errors={e}>
      <Panel title={mode === "signup" ? "Sign up" : "Sign in"} description="Use one Yard account for your brand and shopping.">
        <div className="grid gap-2 sm:grid-cols-2">
          {providers.google ? <Button type="button" variant="secondary" size="lg" className="w-full" loading={busy === "google"} disabled={!!busy} onClick={() => void social("google")}><GoogleMark /> Continue with Google</Button> : null}
          {providers.apple ? <Button type="button" variant="secondary" size="lg" className="w-full" loading={busy === "apple"} disabled={!!busy} onClick={() => void social("apple")}><AppleMark /> Continue with Apple</Button> : null}
        </div>
        <div className="my-5 flex items-center gap-3 text-xs text-ink-3">
          <span className="h-px flex-1 bg-white/10" /> or with email <span className="h-px flex-1 bg-white/10" />
        </div>
        <div className="grid gap-4">
          {mode === "signup" ? <Field id="ob-name" label="Full name" error={e.name}>
            <Input {...control("ob-name", e.name)} autoComplete="name" value={name} onChange={(ev) => { setName(ev.target.value); setServerErrors((current) => ({ ...current, name: undefined })) }} className={inputClass} />
          </Field> : null}
          <Field id="ob-email" label="Email" error={e.email}>
            <Input {...control("ob-email", e.email)} type="email" autoComplete="email" inputMode="email" value={email} onChange={(ev) => { setEmail(ev.target.value); setServerErrors((current) => ({ ...current, email: undefined })) }} className={inputClass} />
          </Field>
          <Field id="ob-password" label="Password" error={e.password} hint={mode === "signup" ? "At least 10 characters." : undefined}>
            <InputGroup className={inputClass}>
              <InputGroupInput
                {...control("ob-password", e.password, true)}
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(ev) => { setPassword(ev.target.value); setServerErrors((current) => ({ ...current, password: undefined })) }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </div>
        {mode === "signup" ? <p className="mt-4 text-xs text-ink-3">By continuing you agree to the seller terms and the privacy policy.</p> : null}
        {providers.demo.shopper ? <Button type="button" variant="secondary" size="lg" className="mt-4 w-full" loading={busy === "demo"} disabled={!!busy} onClick={() => void signInDemo()}>Continue as demo shopper</Button> : null}
        {failure ? <p role="alert" className="mt-3 text-sm text-danger">{failure}</p> : null}
        {notice ? <p role="status" className="mt-3 text-sm text-ink-2">{notice}</p> : null}
        <button type="button" className="mt-4 justify-self-center text-sm text-violet underline-offset-4 hover:underline" disabled={!!busy} onClick={() => { setMode((current) => current === "signup" ? "signin" : "signup"); setFailure(null); setNotice(null); setNeedsVerification(false); setServerErrors({}) }}>
          {mode === "signup" ? "I already have an account" : "Create an account"}
        </button>
      </Panel>
    </StepForm>
  )
}
