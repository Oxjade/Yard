"use client"

import { AnimatePresence, motion } from "motion/react"
import { getDemoAnchor, useNow } from "@/hooks/use-now"
import { dropPhaseAt, dropWindow, splitCountdown } from "@/lib/drops"
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
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className={cn("mt-1 text-[11px]", size === "lg" ? "text-current/70" : "text-ink-3")}>{label}</span>
    </div>
  )
}

/**
 * Countdown to a drop's release. Rendered only on the client (the clock is not known at
 * prerender), with a same-size placeholder so nothing shifts.
 */
export function Countdown({ drop, size = "sm", className }: { drop: Drop; size?: "sm" | "lg"; className?: string }) {
  const now = useNow(1000)
  if (now === null) {
    return <div className={cn("flex gap-4 opacity-0", className)} aria-hidden><Digit value={0} label="days" size={size} /></div>
  }
  const anchor = getDemoAnchor()
  const phase = dropPhaseAt(drop, now, anchor)
  const { release, end } = dropWindow(drop, anchor)
  const target = phase === "upcoming" ? release : end
  const t = splitCountdown(target - now)
  const releaseText = new Date(release).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

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
        {phase === "upcoming" ? `Releases ${releaseText}, your time` : "Closes in"}
      </p>
    </div>
  )
}

/** Live/upcoming indicator: acid is the release signal. */
export function DropStatus({ drop, className }: { drop: Drop; className?: string }) {
  const now = useNow(5000)
  if (now === null) return <span className={cn("inline-block h-6", className)} />
  const phase = dropPhaseAt(drop, now, getDemoAnchor())
  const label =
    phase === "live"
      ? `Live now — ${drop.unitsLeft} of ${drop.totalUnits} left`
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
      {hot ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-obsidian/60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-obsidian" />
        </span>
      ) : null}
      {label}
    </span>
  )
}
