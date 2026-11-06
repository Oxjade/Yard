import type { Metadata } from "next"
import { AccountGate } from "@/components/market/account/auth-panel"
import { FollowingFeed } from "@/components/market/account/following-feed"
import { img } from "@/lib/data/media"

export const metadata: Metadata = { title: "Following" }

export default function FollowingPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountGate
        skeleton="list"
        invite={{
          title: "Following",
          body: "Follow brands and their new pieces, collections, drop announcements and stories arrive here, in the order they happen. Sign in to start.",
          image: img("fashion/streetwear-editorial/3"),
        }}
      >
        <FollowingFeed />
      </AccountGate>
    </div>
  )
}
