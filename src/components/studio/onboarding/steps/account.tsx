"use client"

import { useState } from "react"
import { EyeIcon as Eye, EyeSlashIcon as EyeOff } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { AppleMark, GoogleMark, useDemoSignIn } from "@/components/market/auth-prompt"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSession, type SessionUser } from "@/lib/stores/session"
import { control, Field, inputClass, Panel } from "@/components/studio/growth/form"
import { StepForm, useStepForm, type StepProps } from "../step-form"
import { useOnboarding } from "../store"
import { isEmail } from "../validation"

const providerLabel: Record<SessionUser["provider"], string> = { google: "Google", apple: "Apple", email: "email" }

export function AccountStep({ onNext }: StepProps) {
  const hydrated = useHydrated()
  const user = useSession((s) => s.user)
  const signOut = useSession((s) => s.signOut)
  const demoSignIn = useDemoSignIn()
  const account = useOnboarding((s) => s.data.account)
  const update = useOnboarding((s) => s.update)

  const [name, setName] = useState(account.name)
  const [email, setEmail] = useState(account.email)
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const signedIn = hydrated ? user : null

  function adopt(u: SessionUser) {
    update("account", { name: u.name, email: u.email, provider: u.provider })
    const business = useOnboarding.getState().data.business
    if (!business.contactEmail) update("business", { contactEmail: u.email })
  }

  function social(provider: "google" | "apple") {
    demoSignIn(provider)
    const u = useSession.getState().user
    if (!u) return
    adopt(u)
    onNext()
  }

  const form = useStepForm(
    () =>
      signedIn
        ? {}
        : {
            name: name.trim().length < 2 ? "Enter your full name." : undefined,
            email: isEmail(email) ? undefined : "Enter a valid email address.",
            password: password.length < 8 ? "Use at least 8 characters for your password." : undefined,
          },
    () => {
      if (signedIn) {
        adopt(signedIn)
      } else {
        demoSignIn("email", name.trim(), email.trim())
        const u = useSession.getState().user
        if (u) adopt(u)
      }
      onNext()
    },
  )
  const e = form.errors

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
              <p className="truncate text-xs text-ink-2">{signedIn.email}, signed in with {signedIn.provider === "email" ? "email" : `a demo ${providerLabel[signedIn.provider]} account`}</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3 -ml-2"
            onClick={() => {
              signOut()
              update("account", { name: "", email: "", provider: null })
            }}
          >
            Use a different account
          </Button>
        </Panel>
      </StepForm>
    )
  }

  return (
    <StepForm formRef={form.formRef} onSubmit={form.onSubmit} errors={e}>
      <Panel title="Sign up" description="Continue with Google or Apple, or use your email. Sign-in providers and account storage aren't connected in this development build, so each option creates a demo account on this device.">
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="secondary" size="lg" className="w-full" onClick={() => social("google")}>
            <GoogleMark /> Continue with Google
          </Button>
          <Button type="button" variant="secondary" size="lg" className="w-full" onClick={() => social("apple")}>
            <AppleMark /> Continue with Apple
          </Button>
        </div>
        <div className="my-5 flex items-center gap-3 text-xs text-ink-3">
          <span className="h-px flex-1 bg-white/10" /> or with email <span className="h-px flex-1 bg-white/10" />
        </div>
        <div className="grid gap-4">
          <Field id="ob-name" label="Full name" error={e.name}>
            <Input {...control("ob-name", e.name)} autoComplete="name" value={name} onChange={(ev) => setName(ev.target.value)} className={inputClass} />
          </Field>
          <Field id="ob-email" label="Email" error={e.email}>
            <Input {...control("ob-email", e.email)} type="email" autoComplete="email" inputMode="email" value={email} onChange={(ev) => setEmail(ev.target.value)} className={inputClass} />
          </Field>
          <Field id="ob-password" label="Password" error={e.password} hint="At least 8 characters.">
            <InputGroup className={inputClass}>
              <InputGroupInput
                {...control("ob-password", e.password, true)}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </div>
        <p className="mt-4 text-xs text-ink-3">By continuing you agree to the seller terms and the privacy policy.</p>
      </Panel>
    </StepForm>
  )
}
