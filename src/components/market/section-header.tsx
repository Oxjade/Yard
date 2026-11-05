import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"

export function SectionHeader({
  title,
  description,
  href,
  action = "See all",
  className,
  as: Heading = "h2",
}: {
  title: string
  description?: string
  href?: string
  action?: string
  className?: string
  as?: "h2" | "h3"
}) {
  return (
    <div className={cn("mb-6 flex items-end justify-between gap-6 md:mb-8", className)}>
      <div className="max-w-2xl">
        <Heading className="font-display text-display-md text-ink">{title}</Heading>
        {description ? <p className="mt-3 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {href ? (
        <Link
          href={href}
          className="group inline-flex shrink-0 items-center gap-1 rounded-md py-1 text-sm text-ink-2 transition-colors hover:text-ink"
        >
          {action}
          <ArrowUpRight className="size-4 transition-transform duration-300 ease-out-quint group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      ) : null}
    </div>
  )
}
