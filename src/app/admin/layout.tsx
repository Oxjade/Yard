import type { Metadata } from "next"
import { AdminShell } from "@/components/admin/admin-shell"
import { Toaster } from "@/components/ui/sonner"
import { DemoAuthBanner } from "@/components/session/demo-auth-banner"
import { RealtimeProvider } from "@/lib/realtime/provider"

export const metadata: Metadata = { title: { default: "Control Center", template: "%s — Control Center" }, robots: { index: false, follow: false } }

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <RealtimeProvider surface="admin">
      <AdminShell>
        <DemoAuthBanner placement="shell" />
        {children}
      </AdminShell>
      <Toaster tone="calm" />
    </RealtimeProvider>
  )
}
