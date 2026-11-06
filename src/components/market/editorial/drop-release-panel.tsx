"use client"

import Link from "next/link"
import { Countdown, formatRelease } from "@/components/market/countdown"
import { Button } from "@/components/ui/button"
import { site } from "@/config/site"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSaved } from "@/lib/stores/saved"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"
import { AddToCalendarButton, DropPrimaryAction, onPurple } from "./drop-actions"
import { accessName, accessRule, agoText, drawClosedRule, releasedAgo, runText } from "./drop-facts"
import { StockBar } from "./stock-bar"
import { useDropClock } from "./use-drop-phase"

/**
 * The drop page's release panel: countdown, the one main action and the rules. The status pill
 * sits on the photograph next to it, so the panel doesn't repeat it. A contained purple surface
 * while the drop is upcoming or live (the countdown and the acid action are the drop moment);
 * a quiet card once it is over, and once a draw has released: entries closed at release and
 * winners are still to be picked, so there is nothing for the shopper to do here.
 */
export function DropReleasePanel({ drop, brandName }: { drop: Drop; brandName: string }) {
  const { phase, now, release } = useDropClock(drop, 5000)
  const over = phase === "sold-out" || phase === "ended"
  // A draw's "live" window is for its winners; entering closed at release.
  const drawClosed = phase === "live" && drop.access === "draw"
  const quiet = over || drawClosed
  const hydrated = useHydrated()
  const saved = useSaved((s) => s.notify.includes(drop.id))
  const entered = hydrated && saved
  // What setting a reminder or entering actually did in this build, said once, next to the button.
  const status = drawClosed
    ? entered
      ? "Your entry is saved in this browser. Picking winners needs the drops backend, which isn't connected in this build, so no one has been drawn yet."
      : "Picking winners needs the drops backend, which isn't connected in this build, so no one has been drawn yet."
    : phase === "upcoming" && entered
      ? drop.access === "draw"
        ? "Entry saved in this browser. Picking winners needs the drops backend, which isn't connected in this build."
        : `Reminder saved in this browser. When it opens you'll see an alert in Notifications while ${site.name} is open; email and push aren't connected in this build.`
      : null
  const muted = quiet ? "text-ink-2" : "text-ink/70"
  const releasedLine = now !== null && release !== null ? agoText(now - release) : releasedAgo(drop)
  return (
    <div className={cn("rounded-lg p-5 text-ink sm:p-6 lg:p-7", quiet ? "border border-line-soft bg-card" : "bg-purple")}>
      {over ? (
        <div>
          <p className="font-display text-display-md text-ink">{phase === "sold-out" ? "Sold out" : "Ended"}</p>
          {/* On the clock once mounted, so a drop that closed during this visit reads right; the server text until then. */}
          {releasedLine ? <p className="mt-2 text-xs text-ink-2">Released {releasedLine}</p> : null}
        </div>
      ) : drawClosed ? (
        <div>
          <p className="font-display text-display-md text-ink">Entries closed</p>
          <p className="mt-2 text-xs text-ink-2">Winners to be picked.{release !== null ? ` Released ${formatRelease(release)}, your time.` : ""}</p>
        </div>
      ) : (
        <Countdown drop={drop} size="lg" className="text-ink" />
      )}

      <div className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {drawClosed ? (
          <Button asChild variant="secondary" size="lg" className="w-full">
            <Link href="/drops#upcoming">See upcoming drops</Link>
          </Button>
        ) : (
          <DropPrimaryAction drop={drop} size="lg" quiet className={cn("w-full", !quiet && onPurple)} />
        )}
        {phase === "upcoming" ? <AddToCalendarButton drop={drop} brandName={brandName} className="w-full border-ink/30 hover:border-ink/60 hover:bg-obsidian/20" /> : null}
      </div>

      <p aria-live="polite" className={cn("text-xs leading-relaxed", quiet ? "text-ink-2" : "text-ink/85", status && "mt-3")}>
        {status}
      </p>

      {phase === "live" && !drawClosed ? <StockBar drop={drop} tone="purple" className="mt-6" /> : null}

      <dl className={cn("mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-5 text-sm", quiet ? "border-line-soft" : "border-ink/20")}>
        <div className="col-span-2">
          <dt className={cn("text-xs", muted)}>Release type</dt>
          <dd className="mt-1">{accessName[drop.access]}</dd>
        </div>
        <div>
          <dt className={cn("text-xs", muted)}>Limit</dt>
          <dd className="mt-1 tabular">{drop.limitPerCustomer} per customer</dd>
        </div>
        <div>
          <dt className={cn("text-xs", muted)}>Run</dt>
          <dd className="mt-1 tabular">{runText(drop)}</dd>
        </div>
      </dl>
      <p className={cn("mt-5 text-xs leading-relaxed", quiet ? "text-ink-2" : "text-ink/75")}>
        {over
          ? "This drop is closed. Its page stays up as a record of what was released."
          : drawClosed
            ? drawClosedRule
            : accessRule[drop.access]}
      </p>
    </div>
  )
}
