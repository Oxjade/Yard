import { useId } from "react"
import { cn } from "@/lib/utils"
import { ArrowLink } from "./arrow-link"

/** The Studio card surface: one step above the page, a hairline border and a 1px top light. */
export const surfaceClass = "rounded-[20px] border border-white/[0.06] bg-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"

/**
 * A titled card for the insight dashboards. The header's round arrow opens the detail page;
 * `action` holds a control such as a Segmented switch.
 */
export function InsightPanel({
  title,
  description,
  action,
  href,
  hrefLabel,
  children,
  className,
  bodyClassName,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  href?: string
  hrefLabel?: string
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn(surfaceClass, "flex min-w-0 flex-col", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4 md:px-5 md:pt-5">
        <div className="min-w-0">
          <h2 id={id} className="text-[15px] font-medium text-ink">{title}</h2>
          {description ? <p className="mt-1 text-[12px] leading-snug text-ink-3">{description}</p> : null}
        </div>
        {action || href ? (
          <div className="flex shrink-0 items-center gap-2">
            {action}
            {href ? <ArrowLink href={href} label={hrefLabel ?? `Open ${title.toLowerCase()}`} /> : null}
          </div>
        ) : null}
      </header>
      <div className={cn("flex min-w-0 flex-1 flex-col px-4 pt-4 pb-4 md:px-5 md:pb-5", bodyClassName)}>{children}</div>
    </section>
  )
}
