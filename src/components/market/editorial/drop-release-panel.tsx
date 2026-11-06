"use client"

import { Countdown } from "@/components/market/countdown"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSaved } from "@/lib/stores/saved"
import { cn } from "@/lib/utils"
import type { Drop } from "@/lib/data/types"
import { AddToCalendarButton, DropPrimaryAction, onPurple } from "./drop-actions"
import { accessName, accessRule, releasedAgo, runText } from "./drop-facts"
import { StockBar } from "./stock-bar"
import { useDropClock } from "./use-drop-phase"

/**
 * The drop page's release panel: countdown, the one main action and the rules. The status pill
 * sits on the photograph next to it, so the panel doesn't repeat it. A contained purple surface
 * while the drop is upcoming or live (the countdown and the acid action are the drop moment);
 * a quiet card once it is over.
 */
export function DropReleasePanel({ drop, brandName }: { drop: Drop; brandName: string }) {
  const { phase } = useDropClock(drop, 5000)
  const over = phase === "sold-out" || phase === "ended"
  const hydrated = useHydrated()
  const saved = useSaved((s) => s.notify.includes(drop.id))
  // What setting a reminder or entering actually did in this build, said once, next to the button.
  const status =
    phase === "upcoming" && hydrated && saved
      ? drop.access === "draw"
        ? "Entry saved in this browser. Picking winners needs the drops backend, which isn't connected in this build."
        : "Reminder saved in this browser. When it opens you'll see an alert in Notifications while NOCTURNE is open; email and push aren't connected in this build."
      : null
  return (
    <div className={cn("rounded-lg p-5 text-ink sm:p-6 lg:p-7", over ? "border border-line-soft bg-card" : "bg-purple")}>
      {over ? (
        <div>
          <p className="font-display text-display-md text-ink">{phase === "sold-out" ? "Sold out" : "Ended"}</p>
          <p className="mt-2 text-xs text-ink-2">Released {releasedAgo(drop)}</p>
        </div>
      ) : (
        <Countdown drop={drop} size="lg" className="text-ink" />
      )}

      <div className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <DropPrimaryAction drop={drop} size="lg" quiet className={cn("w-full", !over && onPurple)} />
        {phase === "upcoming" ? <AddToCalendarButton drop={drop} brandName={brandName} className="w-full border-ink/30 hover:border-ink/60 hover:bg-obsidian/20" /> : null}
      </div>

      <p aria-live="polite" className={cn("text-xs leading-relaxed text-ink/85", status && "mt-3")}>
        {status}
      </p>

      {phase === "live" ? <StockBar drop={drop} tone="purple" className="mt-6" /> : null}

      <dl className={cn("mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-5 text-sm", over ? "border-line-soft" : "border-ink/20")}>
        <div className="col-span-2">
          <dt className={cn("text-xs", over ? "text-ink-2" : "text-ink/70")}>Release type</dt>
          <dd className="mt-1">{accessName[drop.access]}</dd>
        </div>
        <div>
          <dt className={cn("text-xs", over ? "text-ink-2" : "text-ink/70")}>Limit</dt>
          <dd className="mt-1 tabular">{drop.limitPerCustomer} per customer</dd>
        </div>
        <div>
          <dt className={cn("text-xs", over ? "text-ink-2" : "text-ink/70")}>Run</dt>
          <dd className="mt-1 tabular">{runText(drop)}</dd>
        </div>
      </dl>
      <p className={cn("mt-5 text-xs leading-relaxed", over ? "text-ink-2" : "text-ink/75")}>
        {over ? "This drop is closed. Its page stays up as a record of what was released." : accessRule[drop.access]}
      </p>
    </div>
  )
}
