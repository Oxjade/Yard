import type { Metadata } from "next"
import { AdvertisingIndex } from "@/components/studio/growth/advertising-index"

export const metadata: Metadata = { title: "Advertising" }

export default function StudioAdvertisingPage() {
  return <AdvertisingIndex />
}
