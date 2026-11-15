import { cn } from "@/lib/utils"

/**
 * An empty view is an invitation to act: say what goes here and offer the one action. It rises
 * into place once when it appears (`rise-in`, e.g. after the last row is removed), and the icon
 * sits in a small raised well, lit from the top like the panels around it.
 */
export function EmptyState({ icon: Icon, title, body, action, className }: { icon?: React.ComponentType<{ className?: string }>; title: string; body?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rise-in flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-14 text-center", className)}>
      {Icon ? (
        <span className="mb-4 inline-flex size-11 items-center justify-center rounded-full border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_20px_-10px_rgba(0,0,0,0.8)]">
          <Icon className="size-5 text-ink-2" />
        </span>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-pretty text-ink-2">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
