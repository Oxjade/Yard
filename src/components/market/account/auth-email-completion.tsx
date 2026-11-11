"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { api, ApiError } from "@/lib/api/client"
import { afterIdentityChange } from "@/lib/session/identity"
import { takeOnboardingAuthReturn } from "@/lib/session/auth-return"
import { getServerSessionState, refreshServerSession } from "@/lib/session/use-server-session"
import { useSession, type SessionUser } from "@/lib/stores/session"
import { Button } from "@/components/ui/button"

type LinkMode = "verify" | "magic"
type LinkResult = { token: string; state: "success" | "error"; message: string; signedIn?: boolean }

type VerifyResponse =
  | { status: "verified"; signedIn: true; actor: "shopper"; profile: { id: string; name: string; email: string } }
  | { status: "verified"; signedIn: false }

type MagicResponse = { status: "signed_in"; actor: "shopper"; profile: { id: string; name: string; email: string } }

/**
 * Each single-use token is POSTed at most once per page load. Strict Mode (and an Activity
 * re-show) runs the effect again; the later run awaits the same promise instead of spending the
 * token a second time and reporting "already used".
 */
const completions = new Map<string, Promise<LinkResult>>()

async function complete(mode: LinkMode, token: string): Promise<LinkResult> {
  try {
    if (mode === "verify") {
      const response = await api<VerifyResponse>("/api/auth/verify-email/confirm", { body: { token } })
      if (!response.signedIn) return { token, state: "success", signedIn: false, message: "Your email is verified. Sign in to continue." }
      await afterIdentityChange("market")
      useSession.getState().signIn({ ...response.profile, provider: "email" as SessionUser["provider"] })
    } else {
      const response = await api<MagicResponse>("/api/auth/magic-link/consume", { body: { token } })
      await afterIdentityChange("market")
      useSession.getState().signIn({ ...response.profile, provider: "email" })
    }
    await refreshServerSession()
    return { token, state: "success", signedIn: true, message: mode === "verify" ? "Your email is verified and you’re signed in." : "You’re signed in." }
  } catch (error) {
    // A link that was already spent in this browser (another tab, a reload before the token
    // left the URL) has done its job if the session already holds a real shopper.
    if (error instanceof ApiError && error.status === 400) {
      await refreshServerSession()
      const shopper = getServerSessionState().shopper
      if (shopper && !shopper.demo) return { token, state: "success", signedIn: true, message: "This link can’t be used again, but you’re already signed in." }
    }
    return { token, state: "error", message: error instanceof ApiError ? error.fields?.token ?? error.message : "This link could not be completed. Request a new one and try again." }
  }
}

function completeOnce(mode: LinkMode, token: string) {
  const key = `${mode}:${token}`
  let pending = completions.get(key)
  if (!pending) {
    pending = complete(mode, token)
    completions.set(key, pending)
  }
  return pending
}

export function AuthEmailCompletion({ mode }: { mode: LinkMode }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const token = params.get("token") ?? ""
  const [result, setResult] = useState<LinkResult | null>(null)
  const [continueTo, setContinueTo] = useState("/you/orders")
  // Once the token has been used it is taken out of the address bar; the result stays on screen.
  const current = token ? (result?.token === token ? result : null) : result

  useEffect(() => {
    let active = true
    if (!token) return () => { active = false }
    void completeOnce(mode, token).then((outcome) => {
      if (!active) return
      setResult(outcome)
      if (mode === "verify" && outcome.signedIn) setContinueTo(takeOnboardingAuthReturn() ?? "/you/orders")
      // Keep the spent token out of history, screenshots and shared URLs.
      const url = new URL(window.location.href)
      if (url.searchParams.get("token") === token) {
        url.searchParams.delete("token")
        window.history.replaceState(window.history.state, "", `${pathname}${url.search}${url.hash}`)
      }
    })
    return () => { active = false }
  }, [mode, pathname, token])

  const title = mode === "verify" ? "Verify your email" : "Sign-in link"
  return (
    <>
      <h1 className="font-display text-display-lg text-ink">{title}</h1>
      <p className={current?.state === "error" ? "mt-5 max-w-xl text-sm leading-relaxed text-danger" : "mt-5 max-w-xl text-sm leading-relaxed text-ink-2"} role={current?.state === "error" ? "alert" : "status"}>
        {current?.message ?? (token ? "Checking this secure link…" : "This link is missing its token. Open the complete link from your email.")}
      </p>
      {current?.state === "error" ? (
        <Button asChild variant="primary" className="mt-6"><Link href="/sign-in">Return to sign in</Link></Button>
      ) : current?.state === "success" ? (
        <Button asChild variant="primary" className="mt-6"><Link href={current.signedIn === false ? "/sign-in" : continueTo}>{current.signedIn === false ? "Sign in" : "Continue to your account"}</Link></Button>
      ) : null}
    </>
  )
}
