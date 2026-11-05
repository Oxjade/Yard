import { StudioShell } from "@/components/studio/studio-shell"

export default function StudioWorkspaceLayout({ children }: LayoutProps<"/studio">) {
  return <StudioShell>{children}</StudioShell>
}
