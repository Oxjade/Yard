"use client"

import { BellIcon as Bell } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { NotificationsList } from "@/components/feedback/notifications-page"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSession } from "@/lib/stores/session"

export default function CustomerNotificationsPage() {
  const hydrated = useHydrated()
  const user = useSession((s) => s.user)
  const requireAuth = useSession((s) => s.requireAuth)

  return (
    <div className="mx-auto max-w-3xl px-4 pt-28 pb-10 md:px-8 md:pt-32">
      <h1 className="font-display text-display-lg text-ink">Notifications</h1>
      <p className="mt-3 text-ink-2">Orders, drops and news from the brands you follow.</p>
      <div className="mt-10">
        {!hydrated ? (
          <ListSkeleton rows={6} />
        ) : user ? (
          <NotificationsList audience="customer" />
        ) : (
          <div className="flex flex-col items-center rounded-xl border border-white/8 bg-card px-6 py-16 text-center">
            <span className="inline-flex size-11 items-center justify-center rounded-full border border-white/10"><Bell className="size-5 text-ink-2" /></span>
            <p className="mt-3 text-ink">Sign in to see your notifications</p>
            <p className="mt-1 max-w-sm text-sm text-ink-2">Order updates and drop alerts are tied to your account.</p>
            <Button variant="primary" className="mt-6" onClick={() => requireAuth("account")}>Sign in</Button>
          </div>
        )}
      </div>
    </div>
  )
}
