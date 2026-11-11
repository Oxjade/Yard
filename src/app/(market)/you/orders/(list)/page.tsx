import type { Metadata } from "next"
import { AccountGate } from "@/components/market/account/auth-panel"
import { OrdersList } from "@/components/market/account/orders-list"
import { img } from "@/lib/data/media"
import { getEnv } from "@/server/env"
import { invitePhoto, siteImages } from "@/lib/site-images"

export const metadata: Metadata = { title: "Orders" }

export default function OrdersPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountGate
        skeleton="list"
        invite={{
          title: "Orders",
          body: "Sign in to see every order you've placed. Each brand's part of a checkout has its own status, tracking and returns.",
          ...invitePhoto(getEnv().seedDemo, img("objects/bags/1"), siteImages.orders),
        }}
      >
        <OrdersList />
      </AccountGate>
    </div>
  )
}
