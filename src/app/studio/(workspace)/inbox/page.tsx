import type { Metadata } from "next"
import { StudioInbox } from "@/components/studio/inbox/studio-inbox"

export const metadata: Metadata = { title: "Inbox" }

/** Studio Inbox (§6.2): a static shell; the session gate and conversations load on the client. */
export default function StudioInboxPage() {
  return <StudioInbox />
}
