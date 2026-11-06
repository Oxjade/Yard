import type { Metadata } from "next"
import { AdminNotificationsView } from "./notifications-view"

export const metadata: Metadata = { title: "Notifications" }

export default function AdminNotificationsPage() {
  return <AdminNotificationsView />
}
