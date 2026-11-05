import { cn } from "@/lib/utils"

/** The title row of every Studio and Admin page. */
export function PageHeader({ title, description, actions, className, children }: { title: string; description?: string; actions?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-4 border-b border-line-soft pb-5 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-medium tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/** Marks numbers that come from development sample data, so they're never mistaken for production metrics. */
export function SampleDataNote({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-[5px] border border-white/10 px-2 text-[11px] text-ink-2", className)}>
      <span className="size-1.5 rounded-full bg-ink-3" aria-hidden />
      Sample data
    </span>
  )
}
