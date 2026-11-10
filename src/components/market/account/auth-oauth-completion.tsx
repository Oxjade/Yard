"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { afterIdentityChange } from "@/lib/session/identity"
import { clearOnboardingAuthReturn, takeOnboardingAuthReturn } from "@/lib/session/auth-return"
import { refreshServerSession, getServerSessionState } from "@/lib/session/use-server-session"
import { useSession } from "@/lib/stores/session"

const messages = new Map<string, string>(Object.entries({
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
}))

type Completion = { result: string; message: string; success: boolean }

export function AuthOAuthCompletion() {
  const params = useSearchParams()
  const provider = params.get("provider") ?? "identity provider"
  const mode = params.get("mode") ?? "signin"
  const actor = params.get("actor") === "brand" ? "brand" : "shopper"
  const result = params.get("result") ?? "error"
  const [completion, setCompletion] = useState<Completion | null>(null)
  const [continueTo, setContinueTo] = useState("/you/orders")
  const current = completion?.result === result ? completion : null

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (result === "signed_in" || result === "linked" || result === "reauthed") {
          await afterIdentityChange(actor === "brand" ? "studio" : "market")
          await refreshServerSession()
          const session = getServerSessionState()
          // The query string only says what the callback reported; success is shown only when
          // the refreshed server session really holds a non-demo account for this actor.
          const signedInAs = actor === "brand" ? (session.brand && !session.brand.demo ? session.brand : null) : (session.shopper && !session.shopper.demo ? session.shopper : null)
          if (!signedInAs) {
            if (active) setCompletion({ result, success: false, message: "Yard couldn’t confirm this sign-in. Start again from the sign-in page." })
            return
          }
          const shopper = session.shopper
          if (result === "signed_in" && actor === "shopper" && shopper) {
            useSession.getState().signIn({ id: shopper.id, name: shopper.name, email: shopper.email, provider: provider === "apple" ? "apple" : "google" })
            setContinueTo(takeOnboardingAuthReturn() ?? "/you/orders")
          } else {
            clearOnboardingAuthReturn()
          }
          if (active) setCompletion({ result, success: true, message: result === "signed_in" ? "Your account is connected." : result === "linked" ? "The provider is linked to your account." : "Your identity was confirmed." })
          return
        }
        clearOnboardingAuthReturn()
        if (active) setCompletion({ result, success: false, message: messages.get(result) ?? "Sign-in could not be completed." })
      } catch {
        clearOnboardingAuthReturn()
        if (active) setCompletion({ result, success: false, message: "Yard couldn’t refresh your sign-in. Check your connection, then try again." })
      }
    })()
    return () => { active = false }
  }, [actor, provider, result])

  return (
    <>
      <h1 className="font-display text-display-lg text-ink">{current?.success ? "You’re signed in" : "Finishing sign-in"}</h1>
      <p className={current && !current.success ? "mt-5 max-w-xl text-sm leading-relaxed text-danger" : "mt-5 max-w-xl text-sm leading-relaxed text-ink-2"} role={current && !current.success ? "alert" : "status"}>
        {current?.message ?? `Completing ${provider} ${mode === "signin" ? "sign-in" : mode}…`}
      </p>
      {current?.success ? <Button asChild variant="primary" className="mt-6"><Link href={mode === "signin" && actor === "shopper" ? continueTo : "/studio"}>Continue</Link></Button> : current ? <Button asChild variant="secondary" className="mt-6"><Link href="/sign-in">Return to sign in</Link></Button> : null}
    </>
  )
}