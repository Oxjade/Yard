import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthOAuthCompletion } from "@/components/market/account/auth-oauth-completion"
import { AuthPageSkeleton } from "../_components/auth-page-skeleton"

export const metadata: Metadata = { title: "Complete sign-in", robots: { index: false } }

export default function AuthCompletePage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Suspense fallback={<AuthPageSkeleton />}>
        <AuthOAuthCompletion />
      </Suspense>
    </div>
  )
}