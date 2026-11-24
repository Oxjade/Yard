import { StudioShell } from "@/components/studio/studio-shell"
import { StudioSessionGate } from "@/components/studio/studio-session-gate"
import { DemoAuthBanner } from "@/components/session/demo-auth-banner"
import { RealtimeProvider } from "@/lib/realtime/provider"

/**
 * The Studio workspace: one realtime stream per tab for the brand session (§4.3), and the demo
 * warning when it applies. In production every page needs a signed-in brand member
 * (StudioSessionGate, after the proxy's sign-in redirect); the demo renders as before.
 */
export default function StudioWorkspaceLayout({ children }: LayoutProps<"/studio">) {
  return (
    <RealtimeProvider surface="studio">
      <StudioShell>
        <DemoAuthBanner placement="shell" />
        <StudioSessionGate>{children}</StudioSessionGate>
      </StudioShell>
    </RealtimeProvider>
  )
}
