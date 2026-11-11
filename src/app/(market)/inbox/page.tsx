import type { Metadata } from "next"
import { Suspense } from "react"
import { InboxApp, InboxSkeleton } from "@/components/inbox/inbox-app"
import { InboxGate } from "@/components/inbox/inbox-gate"
import { img } from "@/lib/data/media"
import { getEnv } from "@/server/env"
import { invitePhoto, siteImages } from "@/lib/site-images"

export const metadata: Metadata = { title: "Inbox" }

/** The marketplace Inbox (§6.2): a static shell; conversations load on the client over the API. */
export default function InboxPage() {
  return (
    <div className="mx-auto max-w-page px-4 pt-24 md:px-8 md:pt-28">
      <h1 className="mb-5 font-display text-display-sm text-ink">Inbox</h1>
      <InboxGate
        invite={{
          title: "Your inbox",
          body: "Sign in to message brands about sizing, stock and delivery.",
          ...invitePhoto(getEnv().seedDemo, img("fashion/streetwear-editorial/1"), siteImages.inbox),
        }}
      >
        <Suspense fallback={<InboxSkeleton />}>
          <InboxApp />
        </Suspense>
      </InboxGate>
    </div>
  )
}
