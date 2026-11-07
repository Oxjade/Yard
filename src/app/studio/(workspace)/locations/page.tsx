import type { Metadata } from "next"
import { LocationsIndex } from "@/components/studio/locations/locations-index"

export const metadata: Metadata = { title: "Locations" }

/** Studio › Locations (§6.4): a static shell; the list loads from /api/studio/locations. */
export default function StudioLocationsPage() {
  return <LocationsIndex />
}
