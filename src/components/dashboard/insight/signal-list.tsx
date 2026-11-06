import { cn } from "@/lib/utils"
import { DeltaChip } from "./delta-chip"

export type Signal = {
  key: string
  label: string
  value: string
  delta?: number | null
  hint?: string
  /** The value is words for "nothing yet" ("No orders"), shown as quiet text rather than a numeral. */
  empty?: boolean
}

/**
 * The signal ledger: compact rows for secondary metrics, each with its own change chip.
 * Until `ready`, same-size skeletons hold each row. Pass `flex-1 auto-rows-fr` in a flex
 * column to spread equal rows over a card that is taller than the list; each row's content
 * stays centred.
 */
export function SignalList({ items, ready = true, deltaContext, className }: { items: Signal[]; ready?: boolean; deltaContext?: string; className?: string }) {
  return (
    <ul className={cn("grid gap-2", className)}>
      {items.map((s) => (
        <li key={s.key} className="flex min-w-0 flex-col justify-center rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5">
          <p className="flex min-w-0 items-center gap-2 text-[12px] text-ink-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-[2px] bg-violet" />
            <span className="truncate">{s.label}</span>
          </p>
          <div className="mt-1.5 flex min-h-6 items-center justify-between gap-2">
            {ready ? (
              <>
                <p className="flex min-w-0 items-baseline gap-2">
                  {s.empty ? <span className="text-[13px] text-ink-3">{s.value}</span> : <span className="font-metric text-[1.25rem] text-ink">{s.value}</span>}
                  {s.hint ? <span className="truncate text-[11px] text-ink-3">{s.hint}</span> : null}
                </p>
                <DeltaChip value={s.delta} size="sm" context={deltaContext} />
              </>
            ) : (
              <span aria-hidden className="skeleton block h-5 w-20 rounded" />
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
