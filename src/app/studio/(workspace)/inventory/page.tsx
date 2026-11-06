import type { Metadata } from "next"
import { InventoryView } from "@/components/studio/catalog/inventory-view"

export const metadata: Metadata = { title: "Inventory" }

export default function StudioInventoryPage() {
  return <InventoryView />
}
