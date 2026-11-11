"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, control, inputClass } from "@/components/studio/catalog/fields"
import { ApiError, api } from "@/lib/api/client"
import { fieldErrors } from "@/lib/api/errors"
import { OAUTH_REAUTH_CHANNEL, setReauthReturn, type OAuthReauthMessage } from "@/lib/session/auth-return"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/** 403 with fields.reauth = "required": the session must confirm it's them before a money action. */
export const needsBrandReauth = (e: unknown) => e instanceof ApiError && e.status === 403 && e.fields?.reauth === "required"

type Provider = "google" | "apple"
/** How this account confirms: the server says so with the ask (fields.reauthWith). */
type Method = { kind: "password" } | { kind: "demo" } | { kind: "provider"; providers: Provider[] }

const providerLabel = (p: Provider) => (p === "apple" ? "Apple" : "Google")
const providersIn = (v: string | undefined): Provider[] => (v ?? "").split(",").filter((p): p is Provider => p === "google" || p === "apple")

function methodOf(cause: unknown, demo: boolean): Method {
  const raw = cause instanceof ApiError ? cause.fields?.reauthWith : undefined
  if (raw === "demo" || (!raw && demo)) return { kind: "demo" }
  const providers = providersIn(raw)
  if (raw && raw !== "password") return { kind: "provider", providers: providers.length ? providers : ["google", "apple"] }
  return { kind: "password" }
}

/**
 * Step-up for a Studio money action (refund, cancelling a paid order, receiving a return with its
 * refund). The action is tried first; on a 403 `reauth` the form asks the way the server says this
 * account confirms (fields.reauthWith):
 * - a password: a password field; the next submit posts POST /api/auth/reauth?as=brand once;
 * - Google / Apple only (no password): a "Confirm with Google" button that runs the provider's
 *   reauth round trip in a small window (POST /api/auth/oauth/{provider}/start, mode "reauth",
 *   actor "brand"); the window reports back here, and the next submit goes ahead. If the browser
 *   blocks the window, the round trip runs in this tab and comes back to this page;
 * - a demo session (development): the button confirms with { demo: true }.
 * Either way the dialog then retries the action with the SAME Idempotency-Key it used the first
 * time. A refused confirmation shows the server's own message, never an API path.
 */
export function useBrandReauth(fieldId: string) {
  const sessionDemo = useServerSession((s) => !!s.brand?.demo)
  const [required, setRequired] = useState(false)
  const [method, setMethod] = useState<Method>({ kind: "password" })
  const [password, setPasswordValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  /** The provider round trip came back confirmed: the next submit goes ahead without asking. */
  const [confirmed, setConfirmed] = useState(false)
  const [opening, setOpening] = useState<Provider | null>(null)
  const listening = useRef<(() => void) | null>(null)
  /** The latest ask's method: the dialog reads prompt() in the same handler that called catches(). */
  const askedRef = useRef<Method>({ kind: "password" })

  useEffect(() => () => listening.current?.(), [])
  // The password field appears with the ask: focus it once it's on screen.
  useEffect(() => {
    if (required && method.kind === "password") document.getElementById(fieldId)?.focus()
  }, [required, method.kind, fieldId])

  function stopListening() {
    listening.current?.()
    listening.current = null
  }

  function reset() {
    stopListening()
    setRequired(false)
    setMethod({ kind: "password" })
    setPasswordValue("")
    setError(null)
    setConfirmed(false)
    setOpening(null)
  }
  function setPassword(value: string) {
    setPasswordValue(value)
    setError(null)
  }
  const focus = () => window.setTimeout(() => document.getElementById(fieldId)?.focus(), 0)

  /** True when the action may go ahead: nothing was asked for, or the confirmation was accepted. */
  async function verify(): Promise<boolean> {
    if (!required) return true
    if (method.kind === "provider") {
      if (confirmed) {
        reset()
        return true
      }
      setError(`Confirm with ${method.providers.map(providerLabel).join(" or ")} first.`)
      focus()
      return false
    }
    if (method.kind === "password" && !password) {
      setError("Enter your password to confirm.")
      focus()
      return false
    }
    try {
      await api("/api/auth/reauth", { query: { as: "brand" }, body: method.kind === "demo" ? { demo: true } : { password } })
    } catch (cause) {
      const fields = fieldErrors(cause)
      // The account has no password after all (it was removed meanwhile): offer its provider.
      if (cause instanceof ApiError && cause.fields?.reauthWith) {
        const m = methodOf(cause, sessionDemo)
        askedRef.current = m
        setMethod(m)
        setError(cause.message)
        return false
      }
      if (fields.password) {
        setError(fields.password)
        focus()
        return false
      }
      throw cause
    }
    reset()
    return true
  }

  /** Starts the provider's reauth round trip. Called from the button's click, so the window may open. */
  async function confirmWith(provider: Provider) {
    if (opening) return
    setError(null)
    setOpening(provider)
    // Open the window inside the click (browsers block a window opened after an await), then
    // point it at the provider once the server has the state ready.
    let popup: Window | null = null
    try {
      popup = window.open("", "yard-reauth", "popup,width=500,height=680")
    } catch {
      popup = null
    }
    try {
      const { url } = await api<{ url: string }>(`/api/auth/oauth/${provider}/start`, { body: { mode: "reauth", actor: "brand" } })
      if (!popup || popup.closed) {
        // Blocked: run the round trip in this tab; the completion page brings the owner back here.
        // The 403 recorded nothing, so pressing the button again there is safe.
        setReauthReturn(window.location.pathname + window.location.search)
        window.location.assign(url)
        return
      }
      listenForResult(provider, popup)
      popup.location.href = url
    } catch (cause) {
      popup?.close()
      setOpening(null)
      setError(cause instanceof ApiError && cause.message ? cause.message : `Couldn't open ${providerLabel(provider)}. Check your connection and try again.`)
    }
  }

  function listenForResult(provider: Provider, popup: Window) {
    stopListening()
    let channel: BroadcastChannel | null = null
    const onResult = (data: unknown) => {
      const m = data as Partial<OAuthReauthMessage> | null
      if (!m || m.type !== "yard:oauth-reauth" || m.actor !== "brand") return
      stopListening()
      setOpening(null)
      if (m.ok) {
        setConfirmed(true)
        setError(null)
      } else {
        setError(m.message || `${providerLabel(provider)} didn't confirm it's you. Try again.`)
      }
    }
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin) onResult(e.data)
    }
    window.addEventListener("message", onMessage)
    try {
      channel = new BroadcastChannel(OAUTH_REAUTH_CHANNEL)
      channel.onmessage = (e) => onResult(e.data)
    } catch {
      channel = null
    }
    // The owner closed the window without finishing: let them press the button again.
    const stop = () => {
      window.removeEventListener("message", onMessage)
      channel?.close()
      window.clearInterval(timer)
    }
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.setTimeout(() => {
          if (listening.current === stop) {
            stopListening()
            setOpening(null)
          }
        }, 800)
        window.clearInterval(timer)
      }
    }, 500)
    listening.current = stop
  }

  /** True when the error was the reauth ask: the field (or the provider button) appears. */
  function catches(cause: unknown) {
    if (!needsBrandReauth(cause)) return false
    const m = methodOf(cause, sessionDemo)
    askedRef.current = m
    stopListening()
    setRequired(true)
    setMethod(m)
    setPasswordValue("")
    setError(null)
    setConfirmed(false)
    setOpening(null)
    return true
  }

  /** The dialog's note after the server asked, e.g. prompt("refund again"). */
  function prompt(again: string) {
    const m = askedRef.current
    return m.kind === "demo"
      ? `Confirm it's you: this demo account confirms without a password. Press the button to ${again}.`
      : m.kind === "provider"
        ? `Confirm it's you with ${m.providers.map(providerLabel).join(" or ")}, then ${again}.`
        : `Confirm it's you: enter your Studio password, then ${again}.`
  }

  return { fieldId, required, method, demo: method.kind === "demo", password, setPassword, error, verify, catches, reset, prompt, confirmed, opening, confirmWith }
}

export type BrandReauth = ReturnType<typeof useBrandReauth>

/**
 * What a Studio money dialog shows once the server asks (inline, in the same form): the password
 * input, or for an account that signs in with Google or Apple, a button per provider.
 */
export function BrandReauthField({ reauth, className }: { reauth: BrandReauth; className?: string }) {
  if (!reauth.required || reauth.method.kind === "demo") return null
  const id = reauth.fieldId
  const error = reauth.error ?? undefined
  if (reauth.method.kind === "provider") {
    const { providers } = reauth.method
    return (
      <div className={cn("grid gap-2", className)}>
        {reauth.confirmed ? (
          <p role="status" className="text-sm text-ink">
            Confirmed. Press the button below to finish.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-2">Your account signs in with {providers.map(providerLabel).join(" or ")}. Money actions need you to confirm it&apos;s you every few minutes.</p>
            <div className="flex flex-wrap gap-2">
              {providers.map((p, i) => (
                <Button key={p} id={i === 0 ? id : undefined} type="button" variant="secondary" loading={reauth.opening === p} disabled={!!reauth.opening && reauth.opening !== p} onClick={() => void reauth.confirmWith(p)}>
                  Confirm with {providerLabel(p)}
                </Button>
              ))}
            </div>
          </>
        )}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    )
  }
  return (
    <Field id={id} label="Your password" error={error} hint="Money actions need your password again every few minutes." className={cn(className)}>
      <Input {...control(id, error)} type="password" value={reauth.password} onChange={(e) => reauth.setPassword(e.target.value)} className={inputClass} autoComplete="current-password" />
    </Field>
  )
}
