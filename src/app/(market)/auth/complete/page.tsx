import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthOAuthCompletion } from "@/components/market/account/auth-oauth-completion"
import { AccountSkeleton } from "@/components/market/account/skeletons"

export const metadata: Metadata = { title: "Complete sign-in", robots: { index: false } }

export default function AuthCompletePage() {
  return <Suspense fallback={<AccountSkeleton variant="split" />}><AuthOAuthCompletion /></Suspense>
}