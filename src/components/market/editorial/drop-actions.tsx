"use client"

import Link from "next/link"
import { CalendarPlusIcon as CalendarPlus, ShoppingBagOpenIcon as ShoppingBag } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { NotifyButton } from "@/components/market/notify-button"
import { site } from "@/config/site"
import { getDemoAnchor } from "@/hooks/use-now"
import { dropAccessLabel, dropWindow } from "@/lib/drops"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"
import { useDropClock } from "./use-drop-phase"

/**
 * The drop reminder (or draw entry) button. It is the shared NotifyButton, kept under this name
 * for the editorial callers; `quiet` skips the toast where the page explains the result itself.
 */
export { NotifyButton as DropReminderButton } from "@/components/market/notify-button"

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
  /** The reminder or entry is explained beside the button, so no toast (see NotifyButton). */
  quiet?: boolean
}) {
  const { phase } = useDropClock(drop, 5000)
  if (phase === "upcoming") return <NotifyButton drop={drop} size={size} variant="primary" quiet={quiet} className={className} />
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
