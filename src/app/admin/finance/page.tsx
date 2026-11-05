import type { Metadata } from "next"
import { FinanceView } from "@/components/admin/finance/finance-view"

export const metadata: Metadata = { title: "Finance" }

export default function AdminFinancePage() {
  return <FinanceView />
}
