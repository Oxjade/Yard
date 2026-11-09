"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { api, ApiError } from "@/lib/api/client"
import { afterIdentityChange } from "@/lib/session/identity"
import { refreshServerSession } from "@/lib/session/use-server-session"
import { useSession, type SessionUser } from "@/lib/stores/session"
import { Button } from "@/components/ui/button"

type LinkMode = "verify" | "magic"
type LinkResult = { token: string; state: "success" | "error"; message: string }

type VerifyResponse =
  | { status: "verified"; signedIn: true; actor: "shopper"; profile: { id: string; name: string; email: string } }
  | { status: "verified"; signedIn: false }

type MagicResponse = { status: "signed_in"; actor: "shopper"; profile: { id: string; name: string; email: string } }

export function AuthEmailCompletion({ mode }: { mode: LinkMode }) {
  const params = useSearchParams()
  const token = params.get("token") ?? ""
  const [result, setResult] = useState<LinkResult | null>(null)
  const current = result?.token === token ? result : null

  useEffect(() => {
    let active = true
    if (!token) return () => { active = false }
    void (async () => {
      try {
        if (mode === "verify") {
          const response = await api<VerifyResponse>("/api/auth/verify-email/confirm", { body: { token } })
          if (!response.signedIn) {
            if (active) setResult({ token, state: "success", message: "Your email is verified. Sign in to continue." })
            return
          }
          await afterIdentityChange("market")
          useSession.getState().signIn({ ...response.profile, provider: "email" as SessionUser["provider"] })
        } else {
          const response = await api<MagicResponse>("/api/auth/magic-link/consume", { body: { token } })
          await afterIdentityChange("market")
          useSession.getState().signIn({ ...response.profile, provider: "email" })
        }
        await refreshServerSession()
        if (active) setResult({ token, state: "success", message: mode === "verify" ? "Your email is verified and you’re signed in." : "You’re signed in." })
      } catch (error) {
        if (active) setResult({ token, state: "error", message: error instanceof ApiError ? error.message : "This link could not be completed. Request a new one and try again." })
      }
    })()
    return () => { active = false }
  }, [mode, token])

  const title = mode === "verify" ? "Verify your email" : "Sign-in link"
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <h1 className="font-display text-display-lg text-ink">{title}</h1>
      <p className={current?.state === "error" ? "mt-5 max-w-xl text-sm leading-relaxed text-danger" : "mt-5 max-w-xl text-sm leading-relaxed text-ink-2"} role={current?.state === "error" ? "alert" : "status"}>
        {current?.message ?? (token ? "Checking this secure link…" : "This link is missing its token. Open the complete link from your email.")}
      </p>
      {current?.state === "error" ? (
        <Button asChild variant="primary" className="mt-6"><Link href="/sign-in">Return to sign in</Link></Button>
      ) : current?.state === "success" ? (
        <Button asChild variant="primary" className="mt-6"><Link href="/you/orders">Continue to your account</Link></Button>
      ) : null}
    </div>
  )
}