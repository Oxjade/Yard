import type { Metadata } from "next"
import { BrandsView } from "@/components/admin/marketplace/brands-view"

export const metadata: Metadata = { title: "Brands" }

export default function AdminBrandsPage() {
  return <BrandsView />
}
