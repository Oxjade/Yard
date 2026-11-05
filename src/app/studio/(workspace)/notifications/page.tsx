"use client"

import { PageHeader } from "@/components/dashboard/page-header"
import { NotificationsList } from "@/components/feedback/notifications-page"

export default function StudioNotificationsPage() {
  return (
    <div className="grid gap-6">
      <PageHeader title="Notifications" description="Orders, stock, followers, campaigns and payouts for your brand." />
      <NotificationsList audience="merchant" />
    </div>
  )
}
