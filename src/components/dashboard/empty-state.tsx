import { cn } from "@/lib/utils"

/** An empty view is an invitation to act: say what goes here and offer the one action. */
export function EmptyState({ icon: Icon, title, body, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; body?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-14 text-center", className)}>
      {Icon ? (
        <span className="mb-4 inline-flex size-11 items-center justify-center rounded-full border border-line">
          <Icon className="size-5 text-ink-2" />
        </span>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-ink-2">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
