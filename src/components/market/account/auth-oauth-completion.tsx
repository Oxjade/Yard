"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import type { SessionDto } from "@/lib/api/contracts/session"
import { afterIdentityChange } from "@/lib/session/identity"
import { clearOnboardingAuthReturn, OAUTH_REAUTH_CHANNEL, takeOnboardingAuthReturn, takeReauthReturn, type OAuthReauthMessage } from "@/lib/session/auth-return"
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
  email_unverified: "That account’s email address isn’t verified with the provider. Verify it there, or sign in another way.",
  no_brand: "This account doesn’t have a brand workspace yet. Apply to sell on Yard to open one, or sign in with the account your brand uses.",
  suspended: "This account is currently unavailable.",
  reauth_mismatch: "The provider account didn’t match the account being confirmed.",
}))

type Completion = { result: string; message: string; success: boolean }

/**
 * A reauth round trip usually runs in the small window Studio opened: tell the page that opened it
 * (postMessage to the opener, and this browser's other tabs on a BroadcastChannel in case the
 * opener link was lost), then close. Returns true when there was an opener to hand back to.
 */
function reportReauth(message: OAuthReauthMessage) {
  try {
    const ch = new BroadcastChannel(OAUTH_REAUTH_CHANNEL)
    ch.postMessage(message)
    ch.close()
  } catch {
    /* no BroadcastChannel: the opener still hears postMessage */
  }
  const opener = window.opener as Window | null
  if (!opener || opener.closed) return false
  try {
    opener.postMessage(message, window.location.origin)
  } catch {
    return false
  }
  window.setTimeout(() => window.close(), 400)
  return true
}

export function AuthOAuthCompletion() {
  const params = useSearchParams()
  const rawProvider = params.get("provider") ?? "identity provider"
  // Auth0 fronts the social logins; the person picked Google, Facebook, … not "Auth0".
  const provider = rawProvider === "auth0" ? "your social sign-in" : rawProvider
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
        if (mode === "reauth") {
          // The identity didn't change: refresh this tab's session only, then hand the result back.
          let ok = false
          if (result === "reauthed") {
            // Read the session straight from the server (the shared store may be mid-refresh from
            // its own first load, and would then keep the older answer).
            const session = await api<SessionDto>("/api/session")
            ok = actor === "brand" ? !!session.brand && !session.brand.demo : !!session.shopper && !session.shopper.demo
            void refreshServerSession()
          }
          const message = ok ? "Your identity was confirmed." : result === "reauthed" ? "Yard couldn’t confirm this. Close this window and try again." : (messages.get(result) ?? "Your identity couldn’t be confirmed.")
          const handed = reportReauth({ type: "yard:oauth-reauth", actor, ok, message: ok ? undefined : message })
          if (!handed && active) setContinueTo(takeReauthReturn() ?? (actor === "brand" ? "/studio" : "/you"))
          if (active) setCompletion({ result, success: ok, message: ok ? (handed ? "Your identity was confirmed. Returning you to Studio…" : "Your identity was confirmed. Go back and press the button again to finish.") : message })
          return
        }
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
            useSession.getState().signIn({ id: shopper.id, name: shopper.name, email: shopper.email, provider: rawProvider === "apple" ? "apple" : rawProvider === "auth0" ? "auth0" : "google" })
            // Strict Mode runs this effect twice; only the live run may take (and so spend) the return.
            if (active) setContinueTo(takeOnboardingAuthReturn() ?? "/you/orders")
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
  }, [actor, mode, rawProvider, result])

  return (
    <>
      <h1 className="font-display text-display-lg text-ink">{mode === "reauth" ? (current?.success ? "Confirmed" : "Confirming it’s you") : current?.success ? "You’re signed in" : "Finishing sign-in"}</h1>
      <p className={current && !current.success ? "mt-5 max-w-xl text-sm leading-relaxed text-danger" : "mt-5 max-w-xl text-sm leading-relaxed text-ink-2"} role={current && !current.success ? "alert" : "status"}>
        {current?.message ?? (mode === "reauth" ? `Confirming with ${provider}…` : `Completing ${provider} ${mode === "signin" ? "sign-in" : mode}…`)}
      </p>
      {mode === "reauth" && current ? <Button asChild variant={current.success ? "primary" : "secondary"} className="mt-6"><Link href={continueTo === "/you/orders" ? (actor === "brand" ? "/studio" : "/you") : continueTo}>{current.success ? "Back to where you were" : "Go back"}</Link></Button> : current?.success ? <Button asChild variant="primary" className="mt-6"><Link href={mode === "signin" && actor === "shopper" ? continueTo : "/studio"}>{mode === "signin" && actor === "shopper" && continueTo === "/studio/onboarding" ? "Continue your brand application" : "Continue"}</Link></Button> : current?.result === "no_brand" ? <Button asChild variant="primary" className="mt-6"><Link href="/studio/onboarding">Apply to sell on Yard</Link></Button> : current ? <Button asChild variant="secondary" className="mt-6"><Link href={actor === "brand" ? "/studio" : "/sign-in"}>Return to sign in</Link></Button> : null}
    </>
  )
}