import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthEmailCompletion } from "@/components/market/account/auth-email-completion"
import { AuthPageSkeleton } from "../_components/auth-page-skeleton"

export const metadata: Metadata = { title: "Confirm new email", robots: { index: false } }

/** /auth/change-email?token=…: the link sent to a new address. POSTs the token once; no sign-in needed. */
export default function ChangeEmailPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Suspense fallback={<AuthPageSkeleton />}>
        <AuthEmailCompletion mode="change-email" />
      </Suspense>
    </div>
  )
}
