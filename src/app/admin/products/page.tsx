import type { Metadata } from "next"
import { ModerationView } from "@/components/admin/marketplace/moderation-view"

export const metadata: Metadata = { title: "Moderation" }

export default function AdminProductsPage() {
  return <ModerationView />
}
