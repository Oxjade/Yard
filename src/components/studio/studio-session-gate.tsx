"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { STUDIO_ONBOARDING_PATH, studioSignInHref } from "@/lib/studio-gate"
import { refreshServerSession, useServerSession } from "@/lib/session/use-server-session"

/** Development and test builds are always the demo (src/server/demo-switch.ts seedDemoFrom). */
const DEV_BUILD = process.env.NODE_ENV !== "production"

/**
 * The Studio workspace's page gate (§2.3). With sample data on (the demo and development), pages
 * render exactly as before, signed in or not. In production a page renders only for a signed-in
 * brand member: the proxy already sends a visitor without a brand session cookie to the Studio
 * sign-in (src/proxy.ts), and this catches the rest — an expired or revoked session goes to
 * sign-in with this page as ?next=, and an account signed in to the shop that runs no brand goes to
 * apply (onboarding). Until /api/session answers, only a skeleton shows, so no page ever renders
 * the browser's sample brand (settings, payouts, orders, products, storefront…) for someone who
 * isn't a member. The server checks every read and write again; this only decides what renders.
 */
export function StudioSessionGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const s = useServerSession()
  const sample = DEV_BUILD || s.sampleData === true
  const member = s.brand
  const signedOut = !sample && s.status === "ready" && !member
  const noBrand = signedOut && !!s.shopper && !s.shopper.demo && (s.shopper.brands?.length ?? 0) === 0

  useEffect(() => {
    if (!signedOut) return
    if (noBrand) router.replace(STUDIO_ONBOARDING_PATH)
    else router.replace(studioSignInHref(`${window.location.pathname}${window.location.search}${window.location.hash}`))
  }, [signedOut, noBrand, router, pathname])

  if (member || sample) return <>{children}</>
  if (s.status === "error") {
    return (
      <div role="alert" className="grid max-w-sm gap-3 py-10">
        <p className="text-base font-medium text-ink">Couldn&apos;t check your session</p>
        <p className="text-sm leading-relaxed text-ink-2">Yard&apos;s server didn&apos;t answer. Check your connection, then try again.</p>
        <Button variant="secondary" className="justify-self-start" onClick={() => void refreshServerSession()}>
          Try again
        </Button>
      </div>
    )
  }
  return (
    <div aria-busy role="status" className="grid gap-3">
      <span className="sr-only">{signedOut ? "Opening the Studio sign-in" : "Checking your session"}</span>
      <Bone className="h-8 w-48" />
      <Bone className="h-4 w-72 max-w-full" />
      <Bone className="mt-3 h-40 w-full rounded-lg" />
    </div>
  )
}
