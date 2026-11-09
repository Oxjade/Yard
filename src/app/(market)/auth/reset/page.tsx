import { Suspense } from "react"
import type { Metadata } from "next"
import { AuthPasswordReset } from "@/components/market/account/auth-password-reset"
import { AccountSkeleton } from "@/components/market/account/skeletons"

export const metadata: Metadata = { title: "Reset password", robots: { index: false } }

export default function ResetPasswordPage() {
  return <Suspense fallback={<AccountSkeleton variant="split" />}><AuthPasswordReset /></Suspense>
}