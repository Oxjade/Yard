import { Suspense } from "react"
import type { Metadata } from "next"
import { StudioSignIn, StudioSignInSkeleton } from "./studio-sign-in"

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } }

/**
 * Brand Studio's own sign-in page: bare and centred, outside the workspace shell (like
 * onboarding). In production every other Studio page sends a signed-out visitor here with
 * ?next=<the page> (src/proxy.ts, src/lib/studio-gate.ts). The search params are read on the
 * client, inside Suspense, so the page prerenders as its skeleton.
 */
export default function StudioSignInPage() {
  return (
    <Suspense fallback={<StudioSignInSkeleton />}>
      <StudioSignIn />
    </Suspense>
  )
}
