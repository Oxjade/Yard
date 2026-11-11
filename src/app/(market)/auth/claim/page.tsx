import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthClaim } from "@/components/market/account/auth-claim"
import { AuthPageSkeleton } from "../_components/auth-page-skeleton"

export const metadata: Metadata = { title: "Claim your store", robots: { index: false, follow: false }, referrer: "no-referrer" }

/** /auth/claim?token= — the link in Yard's "your store is ready, claim it" email (founding brands). */
export default function ClaimStorePage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 pb-16 md:px-8 md:pt-32">
      <Suspense fallback={<AuthPageSkeleton form />}>
        <AuthClaim />
      </Suspense>
    </div>
  )
}
