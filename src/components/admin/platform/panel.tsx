import { cn } from "@/lib/utils"

/**
 * A panel on the platform screens (advertising, health, security), written like the other
 * admin section pages' panels: a card surface, a 13px title, an 11px description and an
 * optional action on the right. `flush` drops the body padding for tables and lists that
 * run edge to edge. Not the overview's admin/ui Panel, which has a different surface.
 */
export function PlatformPanel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  flush = false,
  id,
  tone = "default",
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  flush?: boolean
  id?: string
  tone?: "default" | "attention"
}) {
  const headingId = id ?? `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  return (
    <section aria-labelledby={headingId} className={cn("min-w-0 overflow-hidden rounded-lg border bg-card", tone === "attention" ? "border-acid/30" : "border-line-soft", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1 basis-48">
          <h2 id={headingId} className="text-[13px] font-medium text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[11px] text-ink-2">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
      </header>
      <div className={cn(flush ? "" : "px-4 pb-4", bodyClassName)}>{children}</div>
    </section>
  )
}
