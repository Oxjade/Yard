"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChatsCircleIcon, LightningIcon } from "@phosphor-icons/react"
import { surfaceClass } from "@/components/dashboard/insight/insight-panel"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { useBelowLg, useMedia } from "@/components/inbox/hooks"
import { SessionGate } from "@/components/session/session-gate"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { STUDIO_FILTERS, type ConversationSummary, type ConversationsPage, type StudioFilter } from "@/lib/api/contracts/inbox"
import { customerContext, listQuickReplies } from "@/lib/api/inbox"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { useServerSession } from "@/lib/session/use-server-session"
import { useSearchParam, writeParams } from "@/hooks/use-search-param"
import { cn } from "@/lib/utils"
import { CustomerContext } from "./customer-context"
import { QuickRepliesSheet } from "./quick-replies-sheet"
import { StudioList } from "./studio-list"
import { StudioThread } from "./studio-thread"

/**
 * Studio Inbox (§6.2). xl: list 340 / thread / customer 300. lg: list and thread, with Customer
 * opening the context as a sheet. Phone: the list, with the thread in a full-width sheet.
 * Everything is scoped to the session's active brand on the server.
 */
export function StudioInbox() {
  return (
    <div className="grid gap-5">
      <InboxHeader />
      <SessionGate surface="studio" permission="inbox.read" feature="the Inbox">
        <InboxWorkspace />
      </SessionGate>
    </div>
  )
}

function InboxHeader() {
  const brand = useServerSession((s) => s.brand)
  const [sample, setSample] = useState(false)
  useEffect(() => {
    const on = (e: Event) => setSample((e as CustomEvent<boolean>).detail)
    window.addEventListener("yard:inbox-sample", on)
    return () => window.removeEventListener("yard:inbox-sample", on)
  }, [])
  return (
    <PageHeader
      title="Inbox"
      description="Messages from shoppers about your pieces, sizing and delivery. Refunds, returns and order problems stay in Orders."
      actions={
        brand ? (
          <>
            {sample ? <SampleDataNote /> : null}
            <Button size="sm" variant="secondary" onClick={() => writeParams({ sheet: "quick-replies" })}>
              <LightningIcon /> Quick replies
            </Button>
          </>
        ) : null
      }
    />
  )
}

function InboxWorkspace() {
  const session = useServerSession((s) => s.brand)!
  const thread = useSearchParam("thread")
  const filterParam = useSearchParam("filter")
  const q = useSearchParam("q") ?? ""
  const sheet = useSearchParam("sheet")
  const filter: StudioFilter = (STUDIO_FILTERS as readonly string[]).includes(filterParam ?? "") ? (filterParam as StudioFilter) : "open"
  const phone = useBelowLg()
  const xl = useMedia("(min-width: 1280px)")
  const [contextOpen, setContextOpen] = useState(false)
  const asideRef = useRef<HTMLElement | null>(null)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(false), 1400)
    return () => window.clearTimeout(t)
  }, [flash])
  // "Their orders": at xl the context pane is already on screen, so bring its orders into view and focus them.
  const showOrders = useCallback(() => {
    if (!xl) return setContextOpen(true)
    const aside = asideRef.current
    const target = aside?.querySelector<HTMLElement>("#customer-orders") ?? aside
    if (!aside || !target) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    // Scroll the pane only (scrollIntoView would also move the page under the sticky header).
    const top = target === aside ? 0 : target.getBoundingClientRect().top - aside.getBoundingClientRect().top + aside.scrollTop - 12
    aside.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" })
    target.focus({ preventScroll: true })
    setFlash(true)
  }, [xl])
  const [summaries, setSummaries] = useState<Record<string, ConversationSummary>>({})
  const canManage = session.permissions.includes("inbox.manage")

  const qr = useApi(`studio:inbox:qr:${session.brand.id}`, () => listQuickReplies())
  const ctx = useApi(thread ? `studio:inbox:ctx:${thread}` : null, () => customerContext(thread!))

  const onPage = useCallback((p: ConversationsPage) => {
    setSummaries((s) => {
      const next = { ...s }
      for (const c of p.items) next[c.id] = c
      return next
    })
    window.dispatchEvent(new CustomEvent("yard:inbox-sample", { detail: p.items.some((c) => c.sample) }))
  }, [])
  const onSelect = useCallback((c: ConversationSummary) => {
    setSummaries((s) => ({ ...s, [c.id]: c }))
    writeParams({ thread: c.id })
  }, [])
  const onChanged = useCallback(() => {
    revalidatePrefix("studio:inbox:list:")
    revalidatePrefix("studio:inbox:ctx:")
  }, [])

  const list = <StudioList selected={thread} onSelect={onSelect} filter={filter} onFilter={(f) => writeParams({ filter: f === "open" ? null : f })} q={q} onQuery={(v) => writeParams({ q: v || null })} canManage={canManage} onPage={onPage} className="h-full" />

  const threadView = thread ? (
    <StudioThread
      key={thread}
      conversationId={thread}
      summary={summaries[thread] ?? null}
      session={session}
      quickReplies={qr.data?.items}
      context={ctx.data}
      onOpenContext={xl ? undefined : () => setContextOpen(true)}
      onShowOrders={showOrders}
      onBack={phone ? () => writeParams({ thread: null }) : undefined}
      onClose={() => writeParams({ thread: null })}
      onChanged={onChanged}
    />
  ) : null

  const context = <CustomerContext data={ctx.data} error={ctx.error} loading={ctx.isLoading} onRetry={() => void ctx.revalidate()} brandId={session.brand.id} />

  return (
    <>
      {phone ? (
        <div className={cn(surfaceClass, "min-h-[60dvh] overflow-hidden")}>{list}</div>
      ) : (
        <div className={cn(surfaceClass, "grid h-[calc(100dvh-76px-2.5rem-6.5rem)] min-h-[560px] overflow-hidden", xl ? "grid-cols-[340px_minmax(0,1fr)_300px]" : "grid-cols-[340px_minmax(0,1fr)]")}>
          <div className="min-h-0 border-r border-white/[0.06]">{list}</div>
          <div className="min-h-0">
            {threadView ?? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
                <span className="mb-2 inline-flex size-12 items-center justify-center rounded-full border border-line">
                  <ChatsCircleIcon className="size-6 text-ink-2" />
                </span>
                <p className="text-sm text-ink">Pick a conversation</p>
                <p className="max-w-xs text-sm text-ink-2">Shoppers&apos; questions about sizing, stock and delivery open here, with their orders beside them.</p>
              </div>
            )}
          </div>
          {xl ? (
            <aside ref={asideRef} className={cn("min-h-0 overflow-y-auto border-l border-white/[0.06] [&_#customer-orders]:transition-shadow motion-reduce:[&_#customer-orders]:transition-none", flash && "[&_#customer-orders]:ring-1 [&_#customer-orders]:ring-violet [&_#customer-orders]:ring-offset-4 [&_#customer-orders]:ring-offset-surface")} aria-label="Customer">
              {thread ? context : <p className="p-4 text-xs text-ink-3">The customer&apos;s orders with you show here.</p>}
            </aside>
          ) : null}
        </div>
      )}

      {phone ? (
        <Sheet open={!!thread} onOpenChange={(o) => !o && writeParams({ thread: null })}>
          <SheetContent side="right" showCloseButton={false} className="gap-0 bg-surface p-0 data-[side=right]:w-full data-[side=right]:max-w-none data-[side=right]:sm:max-w-none">
            <SheetHeader className="sr-only">
              <SheetTitle>Conversation</SheetTitle>
              <SheetDescription>Messages with this customer</SheetDescription>
            </SheetHeader>
            <div className="flex h-full min-h-0 flex-col pt-[env(safe-area-inset-top)]">{threadView}</div>
          </SheetContent>
        </Sheet>
      ) : null}

      {!xl ? (
        <Sheet open={contextOpen && !!thread} onOpenChange={setContextOpen}>
          <SheetContent side="right" className="gap-0 bg-surface data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]">
            <SheetHeader className="border-b border-line-soft">
              <SheetTitle>Customer</SheetTitle>
              <SheetDescription>Their history with {session.brand.name} only.</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">{context}</div>
          </SheetContent>
        </Sheet>
      ) : null}

      <QuickRepliesSheet
        open={sheet === "quick-replies"}
        onOpenChange={(o) => writeParams({ sheet: o ? "quick-replies" : null })}
        items={qr.data?.items}
        loading={qr.isLoading}
        error={qr.error}
        onRetry={() => void qr.revalidate()}
        onChanged={(items) => qr.mutate({ items })}
        canManage={canManage}
      />
    </>
  )
}
