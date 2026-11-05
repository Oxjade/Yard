"use client"

import { PageHeader } from "@/components/dashboard/page-header"
import { NotificationsList } from "@/components/feedback/notifications-page"

export default function AdminNotificationsPage() {
  return (
    <div className="grid gap-5">
      <PageHeader title="Notifications" description="Applications, reports, payment failures, chargebacks and system alerts." />
      <NotificationsList audience="admin" />
    </div>
  )
}
