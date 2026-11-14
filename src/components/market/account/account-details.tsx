"use client"

import { useEffect, useState } from "react"
import { CheckIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { BrandReauthField, useBrandReauth } from "@/components/studio/business/reauth"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, ApiError } from "@/lib/api/client"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { refreshServerSession } from "@/lib/session/use-server-session"
import { useSession } from "@/lib/stores/session"

/** GET /api/account (src/server/auth/account.ts). */
export type AccountDto = {
  name: string
  email: string
  emailVerified: boolean
  hasPassword: boolean
  signInProviders: string[]
  pendingEmail: { email: string; expiresAt: string } | null
  demo: boolean
}

const providerWords: Record<string, string> = { google: "Google", apple: "Apple", auth0: "social sign-in" }

/** The sign-up name rules (src/server/auth/contracts.ts `name`), checked before the round trip. */
function nameProblem(n: string) {
  if (!n) return "Enter your name."
  if (n.length > 80) return "Keep it to 80 characters."
  if (/[\u0000-\u001f\u007f<>]/.test(n)) return "Use letters, numbers and simple punctuation."
  return null
}

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

/**
 * The signed-in person's name and email, on the server (shopper Settings and Studio Settings; a
 * brand member's account is the same person). The name saves at once. A new email is a request:
 * it asks for the current password (or, without one, a Google / Apple confirmation), sends a link
 * to the new address, and changes only once that link is opened. A pending change can be resent
 * or cancelled; the old address is told when it goes through.
 */
export function AccountDetails({ as }: { as: "shopper" | "brand" }) {
  const key = `account:${as}`
  const { data, error, isLoading, mutate, revalidate } = useApi(key, () => api<{ account: AccountDto }>("/api/account", { query: { as } }))
  const account = data?.account
  // The draft name; null shows the saved one.
  const [draft, setName] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const [savedName, setSavedName] = useState(false)
  const [changing, setChanging] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<{ email?: string; currentPassword?: string; form?: string }>({})
  const [sending, setSending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const reauth = useBrandReauth(`acc-reauth-${as}`, as)
  const updateLocal = useSession((s) => s.updateProfile)
  const localUser = useSession((s) => s.user)

  // Come back from the confirmation link (another tab, the phone): the email may have changed.
  useEffect(() => {
    const onFocus = () => void revalidate()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [revalidate])
  // Keep this browser's shopper copy (header, checkout) in step with the server.
  useEffect(() => {
    if (as === "shopper" && account && localUser && (localUser.name !== account.name || localUser.email !== account.email) && !account.demo) updateLocal({ name: account.name, email: account.email })
  }, [as, account, localUser, updateLocal])

  if (isLoading && !account)
    return (
      <div className="grid gap-4" role="status" aria-label="Loading your account">
        <Bone className="h-11 w-full" />
        <Bone className="h-11 w-full" />
      </div>
    )
  if (error && !account)
    return (
      <div className="grid gap-3" role="alert">
        <p className="text-sm text-ink">Couldn&apos;t load your account.</p>
        <p className="text-xs text-ink-2">{errorMessage(error)}</p>
        <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => void revalidate()}>
          Try again
        </Button>
      </div>
    )
  if (!account) return null

  const name = draft ?? account.name
  const nameDirty = name.trim() !== account.name
  const saveName = async (e: React.FormEvent) => {
    e.preventDefault()
    const n = name.trim()
    const problem = nameProblem(n)
    setNameError(problem)
    if (problem || !nameDirty || savingName) return
    setSavingName(true)
    try {
      const r = await api<{ account: AccountDto }>("/api/account", { method: "PATCH", query: { as }, body: { name: n } })
      mutate(() => r)
      setName(null)
      setSavedName(true)
      await refreshServerSession()
    } catch (err) {
      setNameError(fieldErrors(err).name ?? errorMessage(err, "Your name wasn't saved. Try again."))
    } finally {
      setSavingName(false)
    }
  }

  const sendLink = async (e?: React.FormEvent, to = email.trim()) => {
    e?.preventDefault()
    if (sending) return
    const next: typeof errors = {}
    if (!/^\S+@\S+\.\S+$/.test(to)) next.email = "Enter an email address like name@example.com."
    else if (to.toLowerCase() === account.email.toLowerCase()) next.email = "That's already your email."
    if (account.hasPassword && !password) next.currentPassword = "Enter your current password."
    setErrors(next)
    if (Object.keys(next).length) return
    setSending(true)
    try {
      if (!(await reauth.verify())) return
      const r = await api<{ account: AccountDto }>("/api/account/email", { query: { as }, body: account.hasPassword ? { email: to, currentPassword: password } : { email: to } })
      mutate(() => r)
      setChanging(false)
      setEmail("")
      setPassword("")
      toast("Check your new inbox", { description: `We sent a link to ${to}. Your email changes once you open it.` })
    } catch (err) {
      if (reauth.catches(err)) return
      const f = fieldErrors(err)
      if (f.email || f.currentPassword) setErrors({ email: f.email, currentPassword: f.currentPassword })
      else setErrors({ form: err instanceof ApiError && err.code === "rate_limited" ? err.message : errorMessage(err, "The link wasn't sent. Try again.") })
    } finally {
      setSending(false)
    }
  }

  const cancel = async () => {
    setCancelling(true)
    try {
      const r = await api<{ account: AccountDto }>("/api/account/email", { method: "DELETE", query: { as } })
      mutate(() => r)
      toast("Email change cancelled", { description: "The link we sent no longer works." })
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't cancel. Try again."))
    } finally {
      setCancelling(false)
    }
  }

  const providers = account.signInProviders.map((p) => providerWords[p] ?? p)
  return (
    <div className="grid gap-6">
      <form onSubmit={saveName} noValidate className="grid gap-1.5">
        <Label htmlFor={`acc-name-${as}`}>Name</Label>
        <div className="flex flex-wrap items-start gap-3">
          <Input
            id={`acc-name-${as}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
              setSavedName(false)
            }}
            autoComplete="name"
            maxLength={80}
            disabled={account.demo}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? `acc-name-${as}-error` : undefined}
            className="h-11 min-w-0 flex-1 basis-56"
          />
          <Button type="submit" variant="primary" disabled={account.demo || (!nameDirty && !savedName)} loading={savingName} success={savedName && !nameDirty}>
            {savedName && !nameDirty ? (
              <>
                <CheckIcon /> Saved
              </>
            ) : (
              "Save name"
            )}
          </Button>
        </div>
        {nameError ? (
          <p id={`acc-name-${as}-error`} className="text-xs text-danger">
            {nameError}
          </p>
        ) : (
          <p className="text-xs text-ink-3">{as === "brand" ? "Shown to your team in Studio and on your Yard account." : "Goes on your orders and shows to brands you message."}</p>
        )}
      </form>

      <div className="grid gap-1.5">
        <p className="text-sm text-ink">Email</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="min-w-0 truncate text-[0.9375rem] text-ink">{account.email}</span>
          {account.emailVerified ? <span className="inline-flex h-5 items-center rounded-[3px] border border-white/10 px-1.5 text-[10px] text-ink-2">Verified</span> : null}
        </div>
        <p className="text-xs text-ink-3">
          {providers.length ? `You also sign in with ${providers.join(" and ")}; that keeps working after a change.` : "Sign-in links, order updates and receipts go here."}
        </p>

        {account.pendingEmail ? (
          <div className="mt-3 grid gap-3 rounded-lg border border-line-soft bg-white/[0.02] p-4" role="status">
            <p className="flex items-start gap-2 text-sm text-ink">
              <EnvelopeSimpleIcon className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
              <span>
                We sent a link to <span className="font-medium">{account.pendingEmail.email}</span>. Your email changes once you open it. The link expires {dateTime.format(new Date(account.pendingEmail.expiresAt))}.
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  // Resending asks for the password (or confirmation) again, so it opens the form with the address filled in.
                  setEmail(account.pendingEmail?.email ?? "")
                  setErrors({})
                  setChanging(true)
                }}
              >
                Resend link
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEmail("")
                  setErrors({})
                  setChanging(true)
                }}
              >
                Use a different email
              </Button>
              <Button size="sm" variant="ghost" loading={cancelling} onClick={() => void cancel()}>
                Cancel change
              </Button>
            </div>
          </div>
        ) : null}

        {account.demo ? (
          <p className="mt-2 text-xs text-ink-3">Demo accounts can&apos;t change their email.</p>
        ) : changing ? (
          <form onSubmit={(e) => void sendLink(e)} noValidate className="mt-3 grid gap-4 rounded-lg border border-line-soft p-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`acc-new-email-${as}`}>New email</Label>
              <Input
                id={`acc-new-email-${as}`}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setErrors((x) => ({ ...x, email: undefined, form: undefined }))
                }}
                autoComplete="email"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? `acc-new-email-${as}-error` : undefined}
                className="h-11"
              />
              {errors.email ? (
                <p id={`acc-new-email-${as}-error`} className="text-xs text-danger">
                  {errors.email}
                </p>
              ) : null}
            </div>
            {account.hasPassword ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`acc-pw-${as}`}>Current password</Label>
                <Input
                  id={`acc-pw-${as}`}
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setErrors((x) => ({ ...x, currentPassword: undefined, form: undefined }))
                  }}
                  autoComplete="current-password"
                  aria-invalid={!!errors.currentPassword}
                  aria-describedby={errors.currentPassword ? `acc-pw-${as}-error` : undefined}
                  className="h-11"
                />
                {errors.currentPassword ? (
                  <p id={`acc-pw-${as}-error`} className="text-xs text-danger">
                    {errors.currentPassword}
                  </p>
                ) : null}
              </div>
            ) : null}
            <BrandReauthField reauth={reauth} hint="Changing your email needs you to confirm it's you." />
            {errors.form ? (
              <p role="alert" className="text-xs text-danger">
                {errors.form}
              </p>
            ) : null}
            <p className="text-xs text-ink-3">We&apos;ll email a link to the new address. Your email changes only when you open it, and we tell your current address.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={sending}>
                Send link
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setChanging(false)
                  setEmail("")
                  setPassword("")
                  setErrors({})
                  reauth.reset()
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : !account.pendingEmail ? (
          <Button variant="secondary" size="sm" className="mt-2 justify-self-start" onClick={() => setChanging(true)}>
            Change email
          </Button>
        ) : null}
      </div>
    </div>
  )
}
