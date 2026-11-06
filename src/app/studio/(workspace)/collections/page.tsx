import type { Metadata } from "next"
import { CollectionsView } from "@/components/studio/catalog/collections-view"

export const metadata: Metadata = { title: "Collections" }

export default function StudioCollectionsPage() {
  return <CollectionsView />
}
