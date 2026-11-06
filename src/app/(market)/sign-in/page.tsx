import { Suspense } from "react"
import type { Metadata } from "next"
import { SignInView } from "@/components/market/account/sign-in-view"
import { AccountSkeleton } from "@/components/market/account/skeletons"
import { img } from "@/lib/data/media"

export const metadata: Metadata = { title: "Sign in" }

export default function SignInPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Suspense fallback={<AccountSkeleton variant="split" />}>
        <SignInView image={img("fashion/campaign/1")} />
      </Suspense>
    </div>
  )
}
