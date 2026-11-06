"use client"

import Link from "next/link"
import { BellIcon as Bell, BellRingingIcon as BellRing, CalendarPlusIcon as CalendarPlus, ShoppingBagOpenIcon as ShoppingBag } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { site } from "@/config/site"
import { useHydrated } from "@/hooks/use-hydrated"
import { getDemoAnchor } from "@/hooks/use-now"
import { dropAccessLabel, dropWindow } from "@/lib/drops"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"
import { useDropClock } from "./use-drop-phase"

/**
 * Set a reminder, or enter the draw, before a drop opens. Both are saved in this browser (the
 * saved store); a reminder turns into an alert in Notifications when the drop opens while
 * NOCTURNE is open, and email, push and the draw itself need backends this build doesn't have,
 * so the feedback says exactly that. `quiet` skips the toast where the page already explains the
 * result next to the button (the drop page's release panel).
 *
 * This is the shared NotifyButton with honest wording; see the shared-changes note to fold it
 * back into components/market/notify-button.tsx.
 */
export function DropReminderButton({
  drop,
  size = "sm",
  variant = "secondary",
  quiet = false,
  className,
}: {
  drop: Drop
  size?: "sm" | "default" | "lg"
  variant?: "secondary" | "glass" | "primary"
  quiet?: boolean
  className?: string
}) {
  const hydrated = useHydrated()
  const on = useSaved((s) => s.notify.includes(drop.id))
  const toggle = useSaved((s) => s.toggleNotify)
  const requireAuth = useSession((s) => s.requireAuth)
  const active = hydrated && on
  const draw = drop.access === "draw"
  const label = draw ? (active ? "Entered" : "Enter the draw") : active ? "Reminder set" : "Notify me"

  function onClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const run = () => {
      const now = toggle(drop.id)
      if (quiet) return
      if (draw) toast(now ? "Entry saved in this browser" : "Entry withdrawn", { description: now ? "Picking winners isn't connected in this build." : undefined })
      else
        toast(now ? "Reminder saved in this browser" : "Reminder removed", {
          description: now ? "You'll see an alert in Notifications when it opens while NOCTURNE is open. Email and push aren't connected in this build." : undefined,
        })
    }
    if (requireAuth("notify", run)) run()
  }

  return (
    <Button type="button" size={size} variant={active ? "brand" : variant} aria-pressed={active} onClick={onClick} className={cn("relative z-10", className)}>
      {active ? <BellRing /> : <Bell />}
      {label}
    </Button>
  )
}

/** On a purple surface the active (purple) reminder state needs an outline to stay visible. */
export const onPurple = "data-[variant=brand]:border-ink/45"

/**
 * The one main action for a drop, following its phase: set a reminder (or enter the draw)
 * before release, shop while live, look back once it's over.
 */
export function DropPrimaryAction({
  drop,
  size = "lg",
  className,
  shopHref,
  quiet = false,
}: {
  drop: Drop
  size?: "sm" | "default" | "lg"
  className?: string
  /** Where "Shop the drop" goes while live. Defaults to the drop page's product grid. */
  shopHref?: string
  /** The reminder or entry is explained beside the button, so no toast (see DropReminderButton). */
  quiet?: boolean
}) {
  const { phase } = useDropClock(drop, 5000)
  if (phase === "upcoming") return <DropReminderButton drop={drop} size={size} variant="primary" quiet={quiet} className={className} />
  if (phase === "live") {
    return (
      <Button asChild variant="primary" size={size} className={className}>
        <Link href={shopHref ?? `/drops/${drop.slug}#in-this-drop`}>
          <ShoppingBag />
          Shop the drop
        </Link>
      </Button>
    )
  }
  return (
    <Button asChild variant="secondary" size={size} className={className}>
      <Link href="/drops#upcoming">See upcoming drops</Link>
    </Button>
  )
}

/** ICS dates are UTC in the basic format: 20261106T171500Z. */
function icsDate(ms: number) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

function icsText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1")
}

/**
 * Downloads an .ics file for the release, so the shopper can put it in their own calendar.
 * Times come from the demo clock; the backend will serve the same file from the drop's UTC start.
 */
export function AddToCalendarButton({ drop, brandName, className }: { drop: Drop; brandName: string; className?: string }) {
  function onClick() {
    const { release } = dropWindow(drop, getDemoAnchor())
    const url = `${window.location.origin}/drops/${drop.slug}`
    const body = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      `PRODID:-//${site.name}//Drops//EN`,
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${drop.id}@${site.name.toLowerCase()}`,
      `DTSTAMP:${icsDate(Date.now())}`,
      `DTSTART:${icsDate(release)}`,
      `DTEND:${icsDate(release + 30 * 60_000)}`,
      `SUMMARY:${icsText(`${drop.name}, ${brandName}`)}`,
      `DESCRIPTION:${icsText(`${dropAccessLabel[drop.access]}. Limit ${drop.limitPerCustomer} per customer. ${url}`)}`,
      `URL:${url}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT15M",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(`${drop.name} releases in 15 minutes`)}`,
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n")
    const href = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }))
    const a = document.createElement("a")
    a.href = href
    a.download = `${drop.slug}.ics`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(href), 1000)
    toast("Calendar file downloaded", { description: `Open ${drop.slug}.ics to add the release to your calendar, with an alert 15 minutes before.` })
  }

  return (
    <Button type="button" variant="secondary" size="lg" onClick={onClick} className={cn(className)}>
      <CalendarPlus />
      Add to calendar
    </Button>
  )
}
