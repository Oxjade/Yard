"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { FlaskIcon } from "@phosphor-icons/react"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import { PageHeader } from "@/components/dashboard/page-header"
import { Button } from "@/components/ui/button"
import { providerLabels, type SocialProviderId } from "@/lib/api/contracts/social"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/** A random sandbox code (the sandbox's token exchange accepts only sandbox_* codes). */
function sandboxCode() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return `sandbox_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`
}

/**
 * The development sandbox's simulated consent card (§6.1). It is not Instagram or TikTok and says
 * so in its title. Allow and Cancel go to the real callback, with a sandbox_* code or
 * error=access_denied, so the state check, the vault and the sync all run as they would live.
 */
export function SandboxConsent() {
  const params = useSearchParams()
  const provider = (params.get("provider") === "tiktok" ? "tiktok" : "instagram") as SocialProviderId
  const state = params.get("state") ?? ""
  const brand = useServerSession((s) => s.brand)
  const [leaving, setLeaving] = useState<"allow" | "cancel" | null>(null)
  const label = providerLabels[provider]

  function go(allow: boolean) {
    setLeaving(allow ? "allow" : "cancel")
    const q = new URLSearchParams({ state })
    if (allow) q.set("code", sandboxCode())
    else q.set("error", "access_denied")
    // A Route Handler that answers with a redirect, not a page: a full navigation, as a provider's consent screen would do.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/social/${provider}/callback?${q.toString()}`)
  }

  return (
    <div className="grid gap-6">
      <PageHeader title={`Development sandbox — this is not ${label}`} description={`A stand-in for ${label}'s consent screen, so the whole connection can be tried on this machine. Nothing here talks to ${label}.`} />
      <section aria-labelledby="sandbox-title" className={cn(surfaceClass, "mx-auto grid w-full max-w-md gap-5 p-6")}>
        <span className="inline-flex size-11 items-center justify-center rounded-full border border-white/10 text-ink-2">
          <FlaskIcon className="size-5" aria-hidden />
        </span>
        <div className="grid gap-2">
          <h2 id="sandbox-title" className="text-lg font-medium text-ink">
            Allow Yard to read {brand ? `${brand.brand.name}'s` : "your"} sandbox profile and posts?
          </h2>
          <p className="text-sm text-ink-2">
            Yard would read the profile and posts only. In the sandbox, the posts are 12 sample photos from this machine. They arrive hidden, and you choose what shows on your storefront.
          </p>
          {!state ? <p className="text-sm text-danger">This page was opened without a connection request. Start again from Social.</p> : null}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={!state || !!leaving} loading={leaving === "cancel"} onClick={() => go(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!state || !!leaving} loading={leaving === "allow"} onClick={() => go(true)}>
            Allow
          </Button>
        </div>
      </section>
    </div>
  )
}
