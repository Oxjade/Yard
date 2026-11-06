import { cn } from "@/lib/utils"

/**
 * The marketplace empty state, as on /shop and the wishlist: a card with an icon ring, a
 * title, one line on why it's empty and one action. `inline` sets it on one row for a section
 * that sits among others (Live now, Upcoming), so an empty section doesn't take a whole screen.
 */
export function EmptyCard({
  icon,
  title,
  reason,
  action,
  layout = "stacked",
  className,
}: {
  icon: React.ReactNode
  title: string
  reason: React.ReactNode
  action?: React.ReactNode
  layout?: "stacked" | "inline"
  className?: string
}) {
  const ring = <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 [&_svg]:size-6">{icon}</span>

  if (layout === "inline") {
    return (
      <div className={cn("flex flex-col items-start gap-4 rounded-lg border border-line-soft bg-card p-6 sm:flex-row sm:items-center sm:justify-between", className)}>
        <div className="flex items-center gap-4">
          {ring}
          <div>
            <p className="text-base text-ink">{title}</p>
            <p className="mt-1 text-sm text-ink-2">{reason}</p>
          </div>
        </div>
        {action}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 rounded-lg border border-line-soft bg-card px-6 py-14 text-center md:py-20", className)}>
      {ring}
      <div>
        <p className="text-base text-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-pretty text-ink-2">{reason}</p>
      </div>
      {action}
    </div>
  )
}
