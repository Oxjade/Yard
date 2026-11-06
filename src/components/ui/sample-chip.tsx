import { cn } from "@/lib/utils"

/**
 * The quiet "Sample" mark for anything that comes from sample data in the marketplace (§6 intro):
 * sample orders, seeded conversations, posts and places, and chart activity. One component for
 * every cluster: `label="Includes sample activity"`, `label="Sample place"`. It is a label, not
 * a status: hairline, grey, never purple or acid.
 */
export function SampleChip({ label = "Sample", className, title }: { label?: string; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 shrink-0 items-center rounded-[3px] border border-white/10 px-1.5 align-middle text-[10px] font-normal whitespace-nowrap text-ink-3", className)}>
      {label}
    </span>
  )
}
