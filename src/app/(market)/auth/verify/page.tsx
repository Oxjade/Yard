import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthEmailCompletion } from "@/components/market/account/auth-email-completion"
import { AccountSkeleton } from "@/components/market/account/skeletons"

export const metadata: Metadata = { title: "Verify email", robots: { index: false } }

export default function VerifyEmailPage() {
  return <Suspense fallback={<AccountSkeleton variant="split" />}><AuthEmailCompletion mode="verify" /></Suspense>
}