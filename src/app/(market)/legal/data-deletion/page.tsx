import type { Metadata } from "next"
import { Suspense } from "react"
import { Bone } from "@/components/feedback/skeletons"
import { DataDeletionStatus } from "./status"

export const metadata: Metadata = { title: "Data deletion request", robots: { index: false, follow: false } }

/**
 * /legal/data-deletion?code= (§6.1): the status page Meta links people to after a data-deletion
 * request. It shows only "Received" or "Completed" for the code: no account or brand details.
 */
export default function DataDeletionPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-28 pb-16 md:px-8 md:pt-32">
      <h1 className="font-display text-display-lg text-ink">Data deletion request</h1>
      <p className="mt-3 text-ink-2">When you remove Yard from Instagram and ask for your data to be deleted, Yard deletes the posts and photos it imported from your account.</p>
      <div className="mt-10">
        <Suspense fallback={<Bone className="h-28 w-full rounded-lg" />}>
          <DataDeletionStatus />
        </Suspense>
      </div>
    </div>
  )
}
