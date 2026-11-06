import type { Metadata } from "next"
import { MessagesView } from "@/components/admin/trust/messages-view"

export const metadata: Metadata = { title: "Messages" }

export default function AdminMessagesPage() {
  return <MessagesView />
}
