"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { afterIdentityChange } from "@/lib/session/identity"
import { refreshServerSession, getServerSessionState } from "@/lib/session/use-server-session"
import { useSession } from "@/lib/stores/session"

const messages: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  invalid_state: "This sign-in link expired or could not be verified. Start again.",
  error: "The provider couldn’t complete sign-in. Try again.",
  not_configured: "This sign-in provider isn’t configured on Yard yet.",
  identity_in_use: "That provider account is connected to another Yard account.",
  already_linked: "That provider is already connected to this account.",
  link_required: "Sign in with your password before connecting this provider.",
  email_required: "The provider didn’t share an email address. Try another sign-in method.",
  no_brand: "This account doesn’t have access to a brand workspace.",
  suspended: "This account is currently unavailable.",
  reauth_mismatch: "The provider account didn’t match the account being confirmed.",
}

type Completion = { result: string; message: string; success: boolean }

export function AuthOAuthCompletion() {
  const params = useSearchParams()
  const provider = params.get("provider") ?? "identity provider"
  const mode = params.get("mode") ?? "signin"
  const result = params.get("result") ?? "error"
  const [completion, setCompletion] = useState<Completion | null>(null)
  const current = completion?.result === result ? completion : null

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (result === "signed_in" || result === "linked" || result === "reauthed") {
          await afterIdentityChange("market")
          await refreshServerSession()
          const shopper = getServerSessionState().shopper
          if (result === "signed_in" && shopper) useSession.getState().signIn({ id: shopper.id, name: shopper.name, email: shopper.email, provider: provider === "apple" ? "apple" : "google" })
          if (active) setCompletion({ result, success: true, message: result === "signed_in" ? "Your account is connected." : result === "linked" ? "The provider is linked to your account." : "Your identity was confirmed." })
          return
        }
        if (active) setCompletion({ result, success: false, message: messages[result] ?? "Sign-in could not be completed." })
      } catch {
        if (active) setCompletion({ result, success: false, message: "Yard couldn’t refresh your sign-in. Check your connection, then try again." })
      }
    })()
    return () => { active = false }
  }, [provider, result])

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <h1 className="font-display text-display-lg text-ink">{current?.success ? "You’re signed in" : "Finishing sign-in"}</h1>
      <p className={current?.success ? "mt-5 max-w-xl text-sm leading-relaxed text-ink-2" : "mt-5 max-w-xl text-sm leading-relaxed text-danger"} role={current?.success ? "status" : "alert"}>
        {current?.message ?? `Completing ${provider} ${mode === "signin" ? "sign-in" : mode}…`}
      </p>
      {current?.success ? <Button asChild variant="primary" className="mt-6"><Link href={mode === "signin" ? "/you/orders" : "/studio"}>Continue</Link></Button> : current ? <Button asChild variant="secondary" className="mt-6"><Link href="/sign-in">Return to sign in</Link></Button> : null}
    </div>
  )
}