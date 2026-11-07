"use client"

import Link from "next/link"
import { useSearchParam } from "@/hooks/use-search-param"
import { useHydrated } from "@/hooks/use-hydrated"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { LocationFormPage } from "./location-form"

/** /studio/locations/edit?id=…: the id comes from the URL after hydration. */
export function EditLocation() {
  const hydrated = useHydrated()
  const id = useSearchParam("id")
  if (!hydrated) return null
  if (!id) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Edit location" />
        <div className="flex flex-col items-start gap-3 rounded-lg border border-line-soft bg-card p-5">
          <p className="text-sm text-ink">No location was chosen.</p>
          <Button asChild size="sm" variant="secondary">
            <Link href="/studio/locations">Back to locations</Link>
          </Button>
        </div>
      </div>
    )
  }
  return <LocationFormPage key={id} id={id} />
}
