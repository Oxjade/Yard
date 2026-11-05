import type { Metadata } from "next"

export const metadata: Metadata = { title: { default: "Brand Studio", template: "%s — Brand Studio" } }

/** Studio root: the workspace shell lives in (workspace); onboarding is full-screen. */
export default function StudioRootLayout({ children }: LayoutProps<"/studio">) {
  return children
}
