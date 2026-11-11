import { SparkleIcon } from "@phosphor-icons/react/ssr"
import { cn } from "@/lib/utils"

/**
 * "Founding brand": one of the first brands Yard brought on itself (an admin toggle). Text, not
 * just an icon, so it reads the same to everyone; `compact` is the brand-line size.
 */
export function FoundingBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-violet/40 bg-violet/10 whitespace-nowrap text-ink",
        compact ? "h-5 px-1.5 text-[10.5px]" : "h-6 px-2 text-[11px]",
        className,
      )}
    >
      <SparkleIcon weight="fill" aria-hidden className={cn("shrink-0 text-violet", compact ? "size-2.5" : "size-3")} />
      Founding brand
    </span>
  )
}

/** "Opening soon": a founding brand that's visible on Yard but not selling yet. */
export function OpeningSoonTag({ className }: { className?: string }) {
  return <span className={cn("glass inline-flex h-6 items-center rounded-[5px] px-2 text-[11px] whitespace-nowrap text-ink-2", className)}>Opening soon</span>
}
