import type { Metadata } from "next"
import { AdvertisingView } from "@/components/admin/platform/advertising/advertising-view"

export const metadata: Metadata = { title: "Advertising" }

export default function AdminAdvertisingPage() {
  return <AdvertisingView />
}
