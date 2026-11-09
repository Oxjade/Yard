import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthPasswordReset } from "@/components/market/account/auth-password-reset"
import { AuthPageSkeleton } from "../_components/auth-page-skeleton"

export const metadata: Metadata = { title: "Reset password", robots: { index: false } }

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Suspense fallback={<AuthPageSkeleton form />}>
        <AuthPasswordReset />
      </Suspense>
    </div>
  )
}