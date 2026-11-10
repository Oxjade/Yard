"use client"

import { AdminPageHead } from "@/components/admin/marketplace/page-head"
import { Panel, PanelError, PanelSkeleton } from "@/components/admin/ui/panel"
import { refreshServerSession } from "@/lib/session/use-server-session"

/**
 * What Finance and Orders show before they know whose session this is. A real admin must never
 * see the sample views flash in first, so the page waits for GET /api/session.
 */
export function LiveLoading({ label }: { label: string }) {
  return (
    <div className="@container grid gap-3" aria-busy="true">
      <span className="sr-only">Loading {label}</span>
      <PanelSkeleton className="h-28" />
      <PanelSkeleton className="h-10" />
      <PanelSkeleton className="h-72" />
    </div>
  )
}

/** The session check failed: say so and retry it, rather than falling back to sample data. */
export function SessionFailed({ title }: { title: string }) {
  return (
    <div className="@container grid gap-3">
      <AdminPageHead live title={title} description="We couldn't confirm your admin session, so nothing is shown yet." />
      <PanelError message="Your admin session couldn't be checked." onRetry={() => void refreshServerSession()} />
    </div>
  )
}

/** The admin's role can't use this page: the server would answer 403 on every request. */
export function RoleNote({ title, description, message }: { title: string; description: string; message: string }) {
  return (
    <div className="@container grid gap-3">
      <AdminPageHead live title={title} description={description} />
      <Panel title="Not available for your role" className="rounded-[20px]">
        <p className="text-sm text-ink-2">{message}</p>
      </Panel>
    </div>
  )
}
