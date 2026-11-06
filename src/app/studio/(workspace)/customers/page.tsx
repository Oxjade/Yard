import type { Metadata } from "next"
import { CustomersIndex } from "@/components/studio/business/customers-index"

export const metadata: Metadata = { title: "Customers" }

export default function StudioCustomersPage() {
  return <CustomersIndex />
}
