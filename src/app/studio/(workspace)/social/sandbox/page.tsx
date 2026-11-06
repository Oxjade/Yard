import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { SandboxConsent } from "@/components/studio/social/sandbox-consent"
import { getEnv } from "@/server/env"

export const metadata: Metadata = { title: "Development sandbox", robots: { index: false, follow: false } }

/**
 * The social sandbox's consent page (§6.1). Development only: when the sandbox is off (production,
 * or YARD_SOCIAL_SANDBOX=0) this answers 404, and the sandbox provider refuses every call.
 */
export default function SocialSandboxPage() {
  if (!getEnv().sandboxEnabled) notFound()
  return (
    <Suspense fallback={null}>
      <SandboxConsent />
    </Suspense>
  )
}
