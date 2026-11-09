import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthInvite } from "@/components/market/account/auth-invite"
import { AuthPageSkeleton } from "../_components/auth-page-skeleton"

export const metadata: Metadata = { title: "Brand invitation", robots: { index: false } }

export default function BrandInvitePage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Suspense fallback={<AuthPageSkeleton />}>
        <AuthInvite />
      </Suspense>
    </div>
  )
}