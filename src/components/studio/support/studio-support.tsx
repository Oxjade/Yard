"use client"

import { useCallback } from "react"
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import { PageHeader } from "@/components/dashboard/page-header"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { SupportThread } from "@/components/inbox/support-thread"
import { SessionGate } from "@/components/session/session-gate"
import { Button } from "@/components/ui/button"
import type { ConversationSummary } from "@/lib/api/contracts/inbox"
import { errorMessage } from "@/lib/api/errors"
import { getSupportConversation } from "@/lib/api/support"
import { useApi } from "@/lib/api/use-api"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"
import { cn } from "@/lib/utils"

/** The brand's Yard Support thread: one per brand, shared by its team (any member can write). */
export function StudioSupport() {
  return (
    <div className="grid gap-5">
      <PageHeader title="Yard Support" description="Message @support, the Yard team, about selling on Yard, your storefront, orders or payouts. Your whole team sees this conversation." />
      <SessionGate surface="studio" feature="Yard Support">
        <SupportWorkspace />
      </SessionGate>
    </div>
  )
}

/** The support conversation summary for the active brand, live (the sidebar badge reads it too). */
export function useStudioSupport(enabled: boolean) {
  const brandId = useServerSession((s) => s.brand?.brand.id ?? null)
  const q = useApi(enabled && brandId ? `studio:support:${brandId}` : null, () => getSupportConversation("brand"), { revalidateOnFocus: true })
  const mutate = q.mutate
  const apply = useCallback(
    (c: ConversationSummary | undefined) => {
      if (c?.kind === "support") mutate(() => ({ conversation: c }))
    },
    [mutate],
  )
  useRealtimeEvent("message.created", (p, meta) => (meta.partial ? void q.revalidate() : apply(p.conversation)))
  useRealtimeEvent("conversation.updated", (p, meta) => (meta.partial ? void q.revalidate() : apply(p.conversation)))
  return { ...q, apply }
}

function SupportWorkspace() {
  const support = useStudioSupport(true)
  const conv = support.data?.conversation ?? null
  return (
    <div className={cn(surfaceClass, "h-[calc(100dvh-14rem)] min-h-[520px] overflow-hidden p-0")}>
      {support.error && !support.data ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
          <p className="text-sm text-ink">Couldn&apos;t open Yard Support.</p>
          <p className="text-xs text-ink-2">{errorMessage(support.error)}</p>
          <Button size="sm" variant="secondary" onClick={() => void support.revalidate()}>
            <ArrowCounterClockwiseIcon /> Retry
          </Button>
        </div>
      ) : !support.data ? (
        <div className="p-4">
          <ListSkeleton rows={2} />
        </div>
      ) : (
        <SupportThread key={conv ? conv.id : "new"} party="brand" conversationId={conv?.id ?? null} onCreated={(c) => support.apply(c)} onConversation={support.apply} />
      )}
    </div>
  )
}
