import type { Metadata } from "next"
import { AccountGate } from "@/components/market/account/auth-panel"
import { DropsView } from "@/components/market/account/drops-view"
import { img } from "@/lib/data/media"
import { getEnv } from "@/server/env"
import { invitePhoto, siteImages } from "@/lib/site-images"

export const metadata: Metadata = { title: "Your drops" }

export default function YourDropsPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountGate
        invite={{
          title: "Your drops",
          body: "Sign in to see every draw you enter and every release reminder you set, across your followed brands.",
          ...invitePhoto(getEnv().seedDemo, img("fashion/campaign/2"), siteImages.yourDrops),
        }}
      >
        <DropsView />
      </AccountGate>
    </div>
  )
}