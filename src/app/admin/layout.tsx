import type { Metadata } from "next"
import { AdminShell } from "@/components/admin/admin-shell"
import { Toaster } from "@/components/ui/sonner"

export const metadata: Metadata = { title: { default: "Control Center", template: "%s — Control Center" }, robots: { index: false, follow: false } }

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <AdminShell>{children}</AdminShell>
      <Toaster tone="calm" />
    </>
  )
}
