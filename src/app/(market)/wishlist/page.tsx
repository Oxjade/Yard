import type { Metadata } from "next"
import { AccountGate } from "@/components/market/account/auth-panel"
import { WishlistView } from "@/components/market/account/wishlist-view"
import { img } from "@/lib/data/media"

export const metadata: Metadata = { title: "Wishlist" }

export default function WishlistPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountGate
        invite={{
          title: "Wishlist",
          body: "Sign in to save pieces from any brand and keep them in one place until you're ready.",
          image: img("objects/accessories-editorial/1"),
        }}
      >
        <WishlistView />
      </AccountGate>
    </div>
  )
}
