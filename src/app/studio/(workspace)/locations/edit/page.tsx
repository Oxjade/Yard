import { Suspense } from "react"
import type { Metadata } from "next"
import { EditLocation } from "@/components/studio/locations/edit-location"

export const metadata: Metadata = { title: "Edit location" }

/** The place opens through `?id=` (§1.6 rule 9: records whose ids the build can't know). */
export default function EditLocationPage() {
  return (
    <Suspense fallback={null}>
      <EditLocation />
    </Suspense>
  )
}
