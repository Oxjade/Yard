import type { Metadata } from "next"
import { LocationFormPage } from "@/components/studio/locations/location-form"

export const metadata: Metadata = { title: "Add location" }

export default function NewLocationPage() {
  return <LocationFormPage id={null} />
}
