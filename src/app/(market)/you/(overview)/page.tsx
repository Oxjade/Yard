import type { Metadata } from "next"
import { AccountGate } from "@/components/market/account/auth-panel"
import { YouOverview } from "@/components/market/account/you-overview"
import { img } from "@/lib/data/media"

export const metadata: Metadata = { title: "Your World" }

export default function YouPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountGate
        invite={{
          title: "Your World",
          body: "Sign in to see drops from the brands you follow, everything you've saved and every order, across every brand, in one place.",
          image: img("fashion/campaign/2"),
        }}
      >
        <YouOverview />
      </AccountGate>
    </div>
  )
}
