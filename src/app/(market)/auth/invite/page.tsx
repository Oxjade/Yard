import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthInvite } from "@/components/market/account/auth-invite"
import { AccountSkeleton } from "@/components/market/account/skeletons"

export const metadata: Metadata = { title: "Brand invitation", robots: { index: false } }

export default function BrandInvitePage() {
  return <Suspense fallback={<AccountSkeleton variant="split" />}><AuthInvite /></Suspense>
}