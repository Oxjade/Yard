import type { Metadata } from "next"
import { Suspense } from "react"
import { connection } from "next/server"
import { SampleDataProvider } from "@/components/sample/sample-data-context"
import { getEnv } from "@/server/env"
import { AccountGate } from "@/components/market/account/auth-panel"
import { YouOverview } from "@/components/market/account/you-overview"
import { img } from "@/lib/data/media"
import { invitePhoto, siteImages } from "@/lib/site-images"

export const metadata: Metadata = { title: "Your World" }

export default function YouPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      <AccountGate
        invite={{
          title: "Your World",
          body: "Sign in to see drops from the brands you follow, everything you've saved and every order, across every brand, in one place.",
          ...invitePhoto(getEnv().seedDemo, img("fashion/campaign/2"), siteImages.you),
        }}
      >
        {/* The demo switch, read at request time: the demo shows sample drops, production the scheduled ones. */}
        <Suspense fallback={null}>
          <WithSampleFlag />
        </Suspense>
      </AccountGate>
    </div>
  )
}

async function WithSampleFlag() {
  await connection()
  return (
    <SampleDataProvider value={getEnv().seedDemo}>
      <YouOverview />
    </SampleDataProvider>
  )
}
