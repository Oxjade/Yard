"use client"

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowCounterClockwiseIcon, ArrowLeftIcon, ChatsCircleIcon, LockKeyIcon } from "@phosphor-icons/react"
import { EmptyState } from "@/components/dashboard/empty-state"
import { Bone, ListSkeleton } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import type { ConversationSummary, Interaction } from "@/lib/api/contracts/inbox"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"
import { conversationByBrand } from "@/lib/api/inbox"
import { useApi } from "@/lib/api/use-api"
import { brandByHandle } from "@/lib/data/brands"
import { usePageSampleData } from "@/components/sample/sample-data-context"
import { refreshServerSession, useServerSession } from "@/lib/session/use-server-session"
import { useSearchParam, writeParams } from "@/hooks/use-search-param"
import { ConversationList } from "./conversation-list"
import { useBelowLg } from "./hooks"
import { ShopperThread } from "./shopper-thread"

/** The page's loading shape: a list of 6 rows beside a thread of bubble bones. */
export function InboxSkeleton() {
  return (
    <div role="status" aria-label="Loading your inbox" className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div>
        <Bone className="mb-4 h-10 w-full rounded-full" />
        <ListSkeleton rows={6} />
      </div>
      <div className="hidden min-h-[60dvh] rounded-[20px] border border-line-soft lg:block">
        <div className="flex h-16 items-center gap-3 border-b border-line-soft px-4">
          <Bone className="size-9 rounded-md" />
          <Bone className="h-4 w-32" />
        </div>
      </div>
    </div>
  )
}

/**
 * The marketplace Inbox (§6.2). Query params: `?thread=<cv>` opens a conversation;
 * `?brand=<handle>[&product=&variant=|&order=]` opens that brand's conversation, or a new-thread
 * view whose first send creates it, with the product or order attached as a removable chip.
 * Desktop: a 360 px list and the thread. Phone: the list, and the thread as a full-screen layer.
 */
export function InboxApp() {
  const session = useServerSession()
  const thread = useSearchParam("thread")
  const brandHandle = useSearchParam("brand")
  const productParam = useSearchParam("product")
  const variantParam = useSearchParam("variant")
  const orderParam = useSearchParam("order")
  const filterParam = useSearchParam("filter")
  const qParam = useSearchParam("q") ?? ""
  const filter = filterParam === "blocked" || filterParam === "archived" ? filterParam : null
  const phone = useBelowLg()
  // The brand of each conversation we've seen, so a thread opens with its own header at once.
  const [known, setKnown] = useState<Record<string, string>>({})
  const remember = useCallback((id: string, brandId: string) => setKnown((k) => (k[id] === brandId ? k : { ...k, [id]: brandId })), [])

  // Demo: a sample brand by handle. Production: the listed brand on the server (a sample handle
  // isn't one), so a ?brand= link opens a real brand's composer and never a sample one.
  const sampleOn = usePageSampleData()
  const sampleBrand = brandHandle && sampleOn ? brandByHandle.get(brandHandle) : undefined
  const liveBrandQuery = useApi(!sampleOn && brandHandle ? `inbox:brand:${brandHandle}` : null, () => api<{ brand: { id: string; name: string } }>(`/api/catalog/storefronts/${encodeURIComponent(brandHandle!)}`), { revalidateOnFocus: false })
  const brand: { id: string; name: string } | undefined = sampleBrand ?? (liveBrandQuery.data ? { id: liveBrandQuery.data.brand.id, name: liveBrandQuery.data.brand.name } : undefined)
  const { data: byBrand, error: byBrandError, revalidate: retryByBrand } = useApi(brand && !thread && session.shopper ? `inbox:by-brand:${brand.id}` : null, () => conversationByBrand(brand!.id), { revalidateOnFocus: false })

  // An existing conversation with the brand opens as itself (keeping any product or order chip).
  useEffect(() => {
    if (byBrand?.conversation && !thread) writeParams({ thread: byBrand.conversation.id, brand: null })
  }, [byBrand, thread])

  const onSelect = useCallback(
    (c: ConversationSummary) => {
      remember(c.id, c.brand.id)
      writeParams({ thread: c.id, brand: null, product: null, variant: null, order: null })
    },
    [remember],
  )
  const onConversation = useCallback((c: ConversationSummary) => remember(c.id, c.brand.id), [remember])
  const brandId = brand?.id
  const onCreated = useCallback(
    (id: string) => {
      if (brandId) remember(id, brandId)
      writeParams({ thread: id, brand: null })
    },
    [brandId, remember],
  )
  const back = useCallback(() => writeParams({ thread: null, brand: null, product: null, variant: null, order: null }), [])

  if (session.status === "loading" || (session.status === "ready" && !session.shopper)) {
    // Signed in on this device but the server session is still being restored (SessionSync).
    return <InboxSkeleton />
  }
  if (session.status === "error") {
    return (
      <EmptyState
        icon={LockKeyIcon}
        title="Couldn't reach Yard"
        body="Your messages live on Yard's server, which didn't answer. Check your connection, then try again."
        action={
          <Button variant="secondary" onClick={() => void refreshServerSession()}>
            <ArrowCounterClockwiseIcon /> Try again
          </Button>
        }
      />
    )
  }

  const threadBrandId = thread ? (known[thread] ?? (byBrand?.conversation?.id === thread ? byBrand.conversation.brand.id : null)) : (brand?.id ?? null)
  const unknownBrand = !!brandHandle && !brand && !thread && (sampleOn || !!liveBrandQuery.error)
  // A stale ?brand= link says so in the pane (desktop) or the phone layer, never fails silently.
  const open = !!thread || !!brand || unknownBrand

  let threadView: React.ReactNode = null
  if (unknownBrand) {
    threadView = (
      <div className="flex h-full flex-col">
        {phone ? (
          <div className="flex h-16 shrink-0 items-center px-2 pt-[env(safe-area-inset-top)]">
            <button type="button" onClick={back} aria-label="Back to conversations" className="glass inline-flex size-10 items-center justify-center rounded-full text-ink focus-visible:outline-2 focus-visible:outline-violet">
              <ArrowLeftIcon className="size-5" />
            </button>
          </div>
        ) : null}
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={ChatsCircleIcon}
            title="We couldn't find that brand"
            body="The link may be out of date. Pick a conversation, or message a brand from its storefront."
            action={
              <Button variant="secondary" onClick={back}>
                Back to your inbox
              </Button>
            }
          />
        </div>
      </div>
    )
  } else if (thread) {
    threadView = threadBrandId ? (
      <ShopperThread key={thread} conversationId={thread} brandId={threadBrandId} initialProduct={productParam ? { productId: productParam, variantId: variantParam } : null} onCreated={onCreated} onBack={phone ? back : undefined} onConversation={onConversation} layer={phone} />
    ) : (
      <ThreadLoader id={thread} onResolved={(b) => remember(thread, b)} onBack={phone ? back : undefined} />
    )
  } else if (brand) {
    threadView = byBrandError ? (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
        <p className="text-sm text-ink">Couldn&apos;t open your conversation with {brand.name}.</p>
        <p className="text-xs text-ink-2">{errorMessage(byBrandError)}</p>
        <Button size="sm" variant="secondary" onClick={() => void retryByBrand()}>
          <ArrowCounterClockwiseIcon /> Retry
        </Button>
      </div>
    ) : !byBrand ? (
      <div className="p-4">
        <ListSkeleton rows={2} />
      </div>
    ) : (
      <ShopperThread
        key={`new:${brand.id}`}
        conversationId={null}
        brandId={brand.id}
        newThreadInteraction={byBrand.canMessage ? { canSend: true } : ({ canSend: false, reason: byBrand.reason === "blocked" ? "blocked_by_them" : byBrand.reason, until: byBrand.until ?? null } as Interaction)}
        initialProduct={productParam ? { productId: productParam, variantId: variantParam } : null}
        initialOrder={orderParam ? { orderId: orderParam, reference: orderParam } : null}
        onCreated={onCreated}
        onBack={phone ? back : undefined}
        layer={phone}
      />
    )
  }

  const list = (
    <ConversationList
      selected={thread}
      onSelect={onSelect}
      filter={filter}
      onFilter={(f) => writeParams({ filter: f })}
      q={qParam}
      onQuery={(q) => writeParams({ q: q || null })}
      className="h-full"
    />
  )

  if (phone) {
    return (
      <>
        <div className="min-h-[60dvh] pb-28">{list}</div>
        {open && typeof document !== "undefined"
          ? createPortal(
              <div className="fixed inset-0 z-50 flex flex-col bg-obsidian" role="dialog" aria-modal="true" aria-label="Conversation">
                {threadView}
              </div>,
              document.body,
            )
          : null}
      </>
    )
  }

  return (
    <div className="grid h-[calc(100dvh-13rem)] min-h-[520px] grid-cols-[360px_minmax(0,1fr)] gap-6">
      <div className="min-h-0">{list}</div>
      <div className="min-h-0 overflow-hidden rounded-[20px] border border-white/[0.06] bg-surface">
        {open ? (
          threadView
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <span className="mb-2 inline-flex size-12 items-center justify-center rounded-full border border-line">
              <ChatsCircleIcon className="size-6 text-ink-2" />
            </span>
            <p className="text-sm text-ink">Pick a conversation</p>
            <p className="max-w-sm text-sm text-ink-2">Or message a brand from its storefront or a product page.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/** A thread opened by link (a notification): learn its brand first. */
function ThreadLoader({ id, onResolved, onBack }: { id: string; onResolved: (brandId: string) => void; onBack?: () => void }) {
  const { data, error, revalidate } = useApi(`inbox:conv:${id}`, () => api<{ conversation: ConversationSummary }>(`/api/inbox/conversations/${encodeURIComponent(id)}`), { revalidateOnFocus: false })
  useEffect(() => {
    if (data?.conversation) onResolved(data.conversation.brand.id)
  }, [data, onResolved])
  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
        <p className="text-sm text-ink">Couldn&apos;t load this conversation.</p>
        <p className="max-w-xs text-xs text-ink-2">{errorMessage(error)}</p>
        <div className="flex gap-2">
          {onBack ? (
            <Button size="sm" variant="ghost" onClick={onBack}>
              Back
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => void revalidate()}>
            <ArrowCounterClockwiseIcon /> Retry
          </Button>
        </div>
      </div>
    )
  return (
    <div className="p-4">
      <div className="flex h-12 items-center gap-3">
        <Bone className="size-9 rounded-md" />
        <Bone className="h-4 w-32" />
      </div>
    </div>
  )
}
