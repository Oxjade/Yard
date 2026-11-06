import type { Metadata } from "next"
import { DemoAuthBanner } from "@/components/session/demo-auth-banner"
import { OnboardingTopBar } from "@/components/studio/onboarding/top-bar"

export const metadata: Metadata = { title: "Set up your brand" }

/** Full-screen onboarding: outside the Studio workspace shell, with a minimal top bar. */
export default function OnboardingLayout({ children }: LayoutProps<"/studio/onboarding">) {
  return (
    <div data-surface="studio" className="min-h-dvh bg-obsidian text-sm">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-md focus:bg-acid focus:px-3 focus:py-2 focus:text-obsidian">
        Skip to content
      </a>
      <DemoAuthBanner placement="shell" />
      <OnboardingTopBar />
      <main id="main">{children}</main>
    </div>
  )
}
