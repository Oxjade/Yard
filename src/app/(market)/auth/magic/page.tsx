import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthEmailCompletion } from "@/components/market/account/auth-email-completion"
import { AccountSkeleton } from "@/components/market/account/skeletons"

export const metadata: Metadata = { title: "Sign-in link", robots: { index: false } }

export default function MagicLinkPage() {
  return <Suspense fallback={<AccountSkeleton variant="split" />}><AuthEmailCompletion mode="magic" /></Suspense>
}