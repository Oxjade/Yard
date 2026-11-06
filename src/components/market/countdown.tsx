"use client"

import { AnimatePresence, motion } from "motion/react"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { dropPhaseAt, dropWindow, splitCountdown } from "@/lib/drops"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"

function Digit({ value, label, size }: { value: number; label: string; size: "sm" | "lg" }) {
  const text = String(value).padStart(2, "0")
  return (
    <div className="flex flex-col items-start">
      <span className={cn("relative overflow-hidden font-display tabular leading-none", size === "lg" ? "text-display-lg" : "text-2xl")}>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={text}
            className="block"
            initial={{ y: "60%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-60%", opacity: 0 }}
            transition={{ duration: duration.page, ease: ease.out }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className={cn("mt-1 text-[11px]", size === "lg" ? "text-current/70" : "text-ink-3")}>{label}</span>
    </div>
  )
}

/** "Thu 12 Nov, 19:00": the release time in this device's zone, 24-hour, as Studio writes times. */
const releaseFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

export function formatRelease(ms: number) {
  return releaseFormat.format(new Date(ms))
}

/**
 * Countdown to a drop's release. Rendered only on the client (the clock is not known at
 * prerender), with a same-size placeholder so nothing shifts.
 *
 * The release time reads in the shopper's own zone ("Releases Thu 12 Nov, 19:00, your time").
 * `formatRelease` replaces that wording with a time the caller formats, zone included (the
 * Studio drop builder shows its preview in the zone the drop is scheduled in).
 */
export function Countdown({
  drop,
  size = "sm",
  className,
  formatRelease: format,
}: {
  drop: Drop
  size?: "sm" | "lg"
  className?: string
  /** Formats the release instant, zone included; replaces "…, your time". */
  formatRelease?: (releaseMs: number) => string
}) {
  const now = useNow(1000)
  if (now === null) {
    return <div className={cn("flex gap-4 opacity-0", className)} aria-hidden><Digit value={0} label="days" size={size} /></div>
  }
  const anchor = getDemoAnchor()
  const phase = dropPhaseAt(drop, now, anchor)
  const { release, end } = dropWindow(drop, anchor)
  const target = phase === "upcoming" ? release : end
  const t = splitCountdown(target - now)
  const releaseText = format ? format(release) : formatRelease(release)

  if (phase === "sold-out" || phase === "ended") {
    return <p className={cn("text-sm text-ink-2", className)}>{phase === "sold-out" ? "Sold out" : "Ended"}</p>
  }

  return (
    <div className={className}>
      <div className="flex items-end gap-3 sm:gap-5" role="timer" aria-label={phase === "upcoming" ? `Releases ${releaseText}` : "Live now"}>
        {t.days > 0 ? <Digit value={t.days} label="days" size={size} /> : null}
        <Digit value={t.hours} label="hrs" size={size} />
        <Digit value={t.minutes} label="min" size={size} />
        <Digit value={t.seconds} label="sec" size={size} />
      </div>
      <p className={cn("mt-2 text-xs", size === "lg" ? "text-current/75" : "text-ink-2")}>
        {phase === "upcoming" ? (format ? `Releases ${releaseText}` : `Releases ${releaseText}, your time`) : "Closes in"}
      </p>
    </div>
  )
}

/** Live/upcoming indicator: acid is the release signal. The dot is still: the colour already says it's happening. */
export function DropStatus({ drop, className }: { drop: Drop; className?: string }) {
  const now = useNow(5000)
  if (now === null) return <span className={cn("inline-block h-6", className)} />
  const phase = dropPhaseAt(drop, now, getDemoAnchor())
  const label =
    phase === "live"
      ? `Live now, ${drop.unitsLeft} of ${drop.totalUnits} left`
      : phase === "upcoming"
        ? drop.releaseOffsetHours < 6
          ? "Releasing soon"
          : "Upcoming"
        : phase === "sold-out"
          ? "Sold out"
          : "Ended"
  const hot = phase === "live" || (phase === "upcoming" && drop.releaseOffsetHours < 6)
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[11px] font-medium",
        hot ? "bg-acid text-obsidian" : phase === "upcoming" ? "glass text-ink" : "bg-elevated text-ink-2",
        className,
      )}
    >
      {hot ? <span aria-hidden className="inline-flex size-1.5 rounded-full bg-obsidian" /> : null}
      {label}
    </span>
  )
}
