"use client"

import { ChatsCircleIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { PageHeader } from "@/components/dashboard/page-header"
import { SessionGate } from "@/components/session/session-gate"

/**
 * Studio Inbox. F1's stub: the SessionGate is real (sign-in and permission states); the inbox
 * itself is built by cluster I in wave 2, which takes this file over (§9.1, §9.4).
 */
export default function StudioInboxPage() {
  return (
    <div className="grid gap-6">
      <PageHeader title="Inbox" description="Messages from shoppers about your pieces, sizing and delivery. Refunds, returns and order problems stay in Orders." />
      <SessionGate surface="studio" permission="inbox.read" feature="the Inbox">
        <EmptyState icon={ChatsCircleIcon} title="The Inbox isn't switched on yet" body="Shopper conversations will arrive here once messaging is connected in this build. Nothing has been sent or received." />
      </SessionGate>
    </div>
  )
}
