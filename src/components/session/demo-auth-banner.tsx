"use client"

import { WarningIcon } from "@phosphor-icons/react"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/**
 * The production demo sign-in warning (§2.3). Rendered on every surface; it shows only while
 * /api/session reports production with any demo flag on. Persistent and not dismissible.
 * `market`: a fixed strip just under the fixed 4.5rem header, plus an invisible in-flow copy of
 * the same strip, so the page below moves down by exactly its height (one line on desktop, two
 * on phones) and nothing sits under it. `shell`: a strip at the top of the Studio and Admin
 * content, under the top bar.
 */
export function DemoAuthBanner({ placement, preview = false }: { placement: "market" | "shell"; /** Dev gallery only: render regardless of the server's flags. */ preview?: boolean }) {
  const demo = useServerSession((s) => s.demoAuth)
  const on = preview || (!!demo?.production && (demo.shopper || demo.brand || demo.admin))
  if (!on) return null
  const text = (
    <>
      <WarningIcon aria-hidden weight="fill" className="size-4 shrink-0 text-ink" />
      <span>
        Demo sign-in is on — anyone can sign in without a password. Turn off <code className="font-mono text-[12px]">YARD_DEMO_AUTH</code> before real use.
      </span>
    </>
  )
  if (placement === "market" && !preview) {
    const strip = "border-y border-white/12 px-4 py-2 md:px-8"
    const line = "mx-auto flex max-w-page items-center gap-2 text-[12.5px] leading-snug"
    return (
      <>
        <div aria-hidden data-demo-auth-spacer className={cn(strip, "invisible")}>
          <p className={line}>{text}</p>
        </div>
        <div role="status" data-demo-auth-banner className={cn(strip, "fixed inset-x-0 top-[4.5rem] z-30 bg-[#141414]")}>
          <p className={cn(line, "text-ink")}>{text}</p>
        </div>
      </>
    )
  }
  return (
    <div role="status" data-demo-auth-banner className={cn("mb-5 rounded-lg border border-white/12 bg-[#141414] px-3.5 py-2.5")}>
      <p className="flex items-start gap-2 text-[12.5px] leading-snug text-ink">{text}</p>
    </div>
  )
}
