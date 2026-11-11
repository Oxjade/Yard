import { Suspense } from "react"
import type { Metadata } from "next"
import { AccountGate } from "@/components/market/account/auth-panel"
import { AccountSkeleton } from "@/components/market/account/skeletons"
import { WelcomeFlow } from "@/components/market/account/welcome-flow"
import { img } from "@/lib/data/media"
import { getEnv } from "@/server/env"
import { invitePhoto, siteImages } from "@/lib/site-images"

export const metadata: Metadata = { title: "Welcome" }

export default function WelcomePage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <Suspense fallback={<AccountSkeleton variant="welcome" />}>
        <AccountGate
          skeleton="welcome"
          invite={{
            title: "Make it yours",
            body: "Sign in and tell us what you shop for. Three quick picks, under a minute, and Discover starts with your kind of brands.",
            ...invitePhoto(getEnv().seedDemo, img("fashion/campaign/3"), siteImages.welcome),
          }}
        >
          <WelcomeFlow />
        </AccountGate>
      </Suspense>
    </div>
  )
}
