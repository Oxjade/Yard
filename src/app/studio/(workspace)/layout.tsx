import { StudioShell } from "@/components/studio/studio-shell"
import { DemoAuthBanner } from "@/components/session/demo-auth-banner"
import { RealtimeProvider } from "@/lib/realtime/provider"

/** The Studio workspace: one realtime stream per tab for the brand session (§4.3), and the demo warning when it applies. */
export default function StudioWorkspaceLayout({ children }: LayoutProps<"/studio">) {
  return (
    <RealtimeProvider surface="studio">
      <StudioShell>
        <DemoAuthBanner placement="shell" />
        {children}
      </StudioShell>
    </RealtimeProvider>
  )
}
