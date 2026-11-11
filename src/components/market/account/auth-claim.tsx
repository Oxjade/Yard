"use client"

import { useEffect, useId, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { SealCheckIcon, SparkleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { countries, type CountryCode } from "@/config/markets"
import { ApiError } from "@/lib/api/client"
import { fieldErrors } from "@/lib/api/errors"
import { acceptClaim, previewClaim, type ClaimPreviewDto } from "@/lib/api/founding"
import { afterIdentityChange } from "@/lib/session/identity"
import { useServerSession } from "@/lib/session/use-server-session"

/**
 * /auth/claim?token=: a founding brand's owner claims the store Yard set up for them. The token
 * stays in the URL and is only ever POSTed (never stored in the browser). The page previews the
 * link, then the owner signs in (an existing account with the invited email) or creates their
 * account here, accepts the seller agreement and becomes the brand's owner. Studio then opens on
 * Settings → Payouts: selling starts once the payout account is saved.
 */

type Refusal = { kind: "invalid" | "expired" | "revoked" | "used" | "on_hold" | "error"; message: string }
type State = { key: string; preview?: ClaimPreviewDto; refusal?: Refusal }

const refusalTitle: Record<Refusal["kind"], string> = {
  invalid: "This claim link isn't valid",
  expired: "This claim link has expired",
  revoked: "This claim link was replaced",
  used: "This store has been claimed",
  on_hold: "This store is on hold",
  error: "We couldn't open this claim link",
}

function refusalOf(cause: unknown): Refusal {
  if (cause instanceof ApiError) {
    const link = cause.fields?.link
    const kind = link === "invalid" || link === "expired" || link === "revoked" || link === "used" || link === "on_hold" ? link : cause.status === 404 ? "invalid" : "error"
    return { kind, message: fieldErrors(cause).token ?? cause.message }
  }
  return { kind: "error", message: "This claim link could not be loaded. Check your connection and try again." }
}

const expiryFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })

export function AuthClaim() {
  const params = useSearchParams()
  const router = useRouter()
  const id = useId()
  const token = params.get("token") ?? ""
  const shopper = useServerSession((s) => s.shopper)
  const sessionReady = useServerSession((s) => s.status !== "loading")
  // The preview depends on who's signed in (signedInMatches), so it's read again when that changes.
  const key = `${token}|${shopper?.id ?? "-"}`
  const [state, setState] = useState<State | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ message: string; reload?: boolean; signIn?: boolean } | null>(null)
  const [errors, setErrors] = useState<{ name?: string; password?: string; acceptAgreement?: string }>({})
  const current = state?.key === key ? state : null

  useEffect(() => {
    if (!token || !sessionReady) return
    const controller = new AbortController()
    previewClaim(token, controller.signal)
      .then((preview) => setState({ key, preview }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setState({ key, refusal: refusalOf(cause) })
      })
    return () => controller.abort()
  }, [token, key, sessionReady, attempt])

  const signInHref = `/sign-in?next=${encodeURIComponent(`/auth/claim?token=${token}`)}`

  async function claim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const preview = current?.preview
    if (!preview || busy) return
    const next: typeof errors = {}
    const creating = !preview.hasAccount
    if (creating && !name.trim()) next.name = "Enter your name."
    if (creating && password.length < 10) next.password = "Use at least 10 characters for your password."
    if (!agreed) next.acceptAgreement = "Accept the seller agreement to claim your store."
    setErrors(next)
    setFailure(null)
    if (Object.keys(next).length) {
      document.getElementById(`${id}-${Object.keys(next)[0]}`)?.focus()
      return
    }
    setBusy(true)
    try {
      const r = await acceptClaim({ token, acceptAgreement: true, agreementVersion: preview.agreementVersion, ...(creating ? { name: name.trim(), password } : {}) })
      await afterIdentityChange("studio")
      // Settings → Payouts, with the note that selling starts once the payout account is saved.
      const [path, hash] = r.redirect.split("#")
      router.replace(`${path}${path.includes("?") ? "&" : "?"}claimed=1${hash ? `#${hash}` : ""}`)
    } catch (cause) {
      const fields = fieldErrors(cause)
      setErrors({ name: fields.name, password: fields.password, acceptAgreement: fields.acceptAgreement })
      if (fields.name || fields.password || fields.acceptAgreement) return
      if (cause instanceof ApiError && cause.fields?.link) {
        setState({ key, refusal: refusalOf(cause) })
        return
      }
      setFailure({
        message: cause instanceof ApiError ? cause.message : "Your store couldn't be claimed. Try again.",
        reload: cause instanceof ApiError && cause.status === 409,
        signIn: cause instanceof ApiError && cause.status === 401,
      })
    } finally {
      setBusy(false)
    }
  }

  if (!token)
    return (
      <Refused
        refusal={{ kind: "invalid", message: "This claim link is missing its token. Open the whole link from Yard's email again." }}
      />
    )
  if (!current) return <p role="status" className="text-sm text-ink-2">Checking your claim link…</p>
  if (current.refusal) return <Refused refusal={current.refusal} onRetry={current.refusal.kind === "error" ? () => setAttempt((n) => n + 1) : undefined} />

  const p = current.preview!
  const place = `${p.brand.city}, ${countries[p.brand.country as CountryCode]?.name ?? p.brand.country}`
  const wrongAccount = p.hasAccount && !!shopper && !p.signedInMatches
  const needsSignIn = p.hasAccount && !p.signedInMatches

  return (
    <div className="grid max-w-xl gap-8">
      <header>
        <p className="inline-flex items-center gap-1.5 text-xs text-violet">
          <SparkleIcon weight="fill" aria-hidden className="size-3.5" />
          You&apos;re one of Yard&apos;s founding brands
        </p>
        <h1 className="mt-3 font-display text-display-lg text-balance break-words text-ink">Claim {p.brand.name}</h1>
        <p className="mt-4 text-sm leading-relaxed text-pretty text-ink-2">Your store is ready: Yard set it up for you. Claim it to become its owner, then add your payout account in Studio to start selling.</p>
      </header>

      <dl className="grid grid-cols-[minmax(0,1fr)] gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
        {[
          { label: "Store", value: `${p.brand.name} (@${p.brand.handle})` },
          { label: "Based in", value: place },
          { label: "Link for", value: p.email },
          { label: "Link expires", value: expiryFmt.format(new Date(p.expiresAt)) },
        ].map((f) => (
          <div key={f.label} className="min-w-0 bg-card px-4 py-3">
            <dt className="text-xs text-ink-3">{f.label}</dt>
            <dd className="mt-1 text-sm break-words text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>

      {needsSignIn ? (
        <section aria-labelledby={`${id}-signin`} className="grid gap-3">
          <h2 id={`${id}-signin`} className="text-base font-medium text-ink">
            Sign in first
          </h2>
          <p className="text-sm leading-relaxed text-ink-2">
            {wrongAccount
              ? `You're signed in as ${shopper!.name}, but this link is for ${p.email}. Sign out, then sign in with that email to claim ${p.brand.name}.`
              : `There's already a Yard account for ${p.email}. Sign in with it to claim ${p.brand.name}. If you signed up with Google or Apple, sign in that way.`}
          </p>
          <Button asChild variant="primary" className="w-full sm:w-fit">
            <Link href={signInHref}>{wrongAccount ? "Sign in with the invited email" : "Sign in to claim"}</Link>
          </Button>
        </section>
      ) : (
        <form onSubmit={claim} noValidate className="grid gap-5">
          {p.hasAccount ? (
            <p className="flex items-start gap-2 text-sm text-ink-2">
              <SealCheckIcon className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
              <span className="min-w-0 break-words">Signed in as {shopper?.name ?? p.email}. Your Yard account becomes the store&apos;s owner.</span>
            </p>
          ) : (
            <fieldset className="grid gap-4">
              <legend className="mb-1 text-base font-medium text-ink">Create your account</legend>
              <p className="-mt-2 text-sm text-ink-2">For {p.email}. You&apos;ll use it to sign in to Studio.</p>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-name`}>Your name</Label>
                <Input
                  id={`${id}-name`}
                  autoComplete="name"
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setErrors((c) => ({ ...c, name: undefined }))
                  }}
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? `${id}-name-error` : undefined}
                />
                {errors.name ? <p id={`${id}-name-error`} className="text-xs text-danger">{errors.name}</p> : null}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-password`}>Create a password</Label>
                <Input
                  id={`${id}-password`}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setErrors((c) => ({ ...c, password: undefined }))
                  }}
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? `${id}-password-error` : `${id}-password-hint`}
                />
                {errors.password ? <p id={`${id}-password-error`} className="text-xs text-danger">{errors.password}</p> : <p id={`${id}-password-hint`} className="text-xs text-ink-3">At least 10 characters.</p>}
              </div>
              <p className="text-xs text-ink-3">
                This store is tied to {p.email}, so the owner account is created for that address. Want it on a Yard account you already have under another email? Ask Yard to re-send the link to that address.
              </p>
            </fieldset>
          )}

          <div className="grid gap-1.5">
            <div className="flex items-start gap-3 rounded-lg border border-line bg-card p-4">
              <Checkbox
                id={`${id}-acceptAgreement`}
                checked={agreed}
                onCheckedChange={(v) => {
                  setAgreed(v === true)
                  setErrors((c) => ({ ...c, acceptAgreement: undefined }))
                }}
                aria-invalid={!!errors.acceptAgreement}
                aria-describedby={errors.acceptAgreement ? `${id}-agreement-error` : undefined}
                className="mt-0.5"
              />
              <Label htmlFor={`${id}-acceptAgreement`} className="block text-sm leading-relaxed font-normal text-ink-2">
                I accept Yard&apos;s{" "}
                <Link href={p.agreementUrl} target="_blank" rel="noopener" className="text-violet underline-offset-4 hover:underline">
                  seller agreement
                  <span className="sr-only"> (opens in a new tab)</span>
                </Link>{" "}
                on behalf of {p.brand.name}. <span className="text-ink-3">Version {p.agreementVersion}.</span>
              </Label>
            </div>
            {errors.acceptAgreement ? <p id={`${id}-agreement-error`} className="text-xs text-danger">{errors.acceptAgreement}</p> : null}
          </div>

          {failure ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
              <span className="min-w-0 break-words">{failure.message}</span>
              {failure.reload ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => window.location.reload()}>
                  Reload
                </Button>
              ) : null}
              {failure.signIn ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href={signInHref}>Sign in</Link>
                </Button>
              ) : null}
            </div>
          ) : null}

          <Button type="submit" variant="primary" size="lg" className="w-full sm:w-fit" loading={busy} disabled={busy}>
            Claim my store
          </Button>
        </form>
      )}
    </div>
  )
}

function Refused({ refusal, onRetry }: { refusal: Refusal; onRetry?: () => void }) {
  return (
    <div className="grid max-w-xl gap-4">
      <h1 className="font-display text-display-lg text-balance break-words text-ink">{refusalTitle[refusal.kind]}</h1>
      <p role="alert" className="text-sm leading-relaxed break-words text-ink-2">
        {refusal.message}
      </p>
      <div className="flex flex-wrap gap-2">
        {onRetry ? (
          <Button type="button" variant="primary" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        {refusal.kind === "used" ? (
          <Button asChild variant="primary">
            <Link href="/studio">Open Studio</Link>
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link href="/">Go to Yard</Link>
        </Button>
      </div>
    </div>
  )
}
