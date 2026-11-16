import type { Metadata } from "next"
import { QuickAddRoute } from "@/components/studio/catalog/quick-add"

export const metadata: Metadata = { title: "Quick add" }

/** Quick add: list a product in five small steps (photos, name, price, sizes and stock, review). */
export default function QuickAddPage() {
  return <QuickAddRoute />
}
