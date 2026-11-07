"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  BellSlashIcon,
  CalendarDotsIcon,
  DotsThreeIcon,
  FlagIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  ProhibitIcon,
  ReceiptIcon,
  RulerIcon,
  SealCheckIcon,
  StorefrontIcon,
  TagIcon,
  TruckIcon,
} from "@phosphor-icons/react"
import { BrandMark } from "@/components/market/brand-mark"
import { ReportSheet } from "@/components/report/report-sheet"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SampleChip } from "@/components/ui/sample-chip"
import type { ConversationSummary, Interaction, MessageDto, SendMessageBody } from "@/lib/api/contracts/inbox"
import { errorMessage } from "@/lib/api/errors"
import { blockBrand, patchConversation, sendMessage } from "@/lib/api/inbox"
import { revalidatePrefix } from "@/lib/api/use-api"
import { brandById } from "@/lib/data/brands"
import { productById, products, variantLabel } from "@/lib/data/products"
import { countries } from "@/config/markets"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import { Composer, type ComposerApi, type OrderChip, type ProductChip } from "./composer"
import { DeliveryEstimateCard, NextDrop, OrderHelp, ProductPicker, QuickActionRail } from "./extras"
import { MessageList, ThreadSkeleton } from "./messages"
import { sentence, shortDate } from "./format"
import { ConnectionChip, ThreadScroller, type ScrollerApi } from "./thread-scroller"
import { SearchBar, useThreadSearch } from "./thread-search"
import { useThread, type DraftPayload } from "./use-thread"

const circle = "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-violet"

/** The disabled-composer line for a shopper (§6.2). */
export function shopperDisabledReason(i: Interaction | undefined, brand: string) {
  if (!i || i.canSend) return null
  switch (i.reason) {
    case "blocked_by_them":
      return sentence(`You can't message ${brand}`)
    case "blocked_by_me":
      return `${sentence(`You blocked ${brand}`)} Unblock them from the menu to send a message.`
    case "restricted":
      return i.until ? `Messaging is paused on your account until ${shortDate(i.until)}.` : "Messaging is paused on your account."
    case "locked":
      return "This conversation was closed by Yard."
    case "brand_unavailable":
      return `${brand} isn't taking messages right now.`
    default:
      return "You can't send messages here right now."
  }
}

function chipFor(productId: string | null | undefined, variantId?: string | null): ProductChip | null {
  const p = productId ? productById.get(productId) : undefined
  if (!p) return null
  const v = variantId ? p.variants.find((x) => x.id === variantId) : undefined
  return { productId: p.id, variantId: v?.id, name: p.name, variantLabel: v ? variantLabel(v.options) : undefined, price: { amount: p.price, currency: p.currency } }
}

type Props = {
  conversationId: string | null
  brandId: string
  /** A new thread's composer state when it can't send (from by-brand). */
  newThreadInteraction?: Interaction
  initialProduct?: { productId: string; variantId?: string | null } | null
  initialOrder?: OrderChip | null
  onCreated: (id: string) => void
  onBack?: () => void
  onConversation?: (c: ConversationSummary) => void
  /** True on phones, where the thread is a full-screen layer. */
  layer?: boolean
}

/** The shopper's thread (§6.2): header, quick-action cards, messages and the pill composer. */
export function ShopperThread({ conversationId, brandId, newThreadInteraction, initialProduct, initialOrder, onCreated, onBack, onConversation, layer }: Props) {
  const brand = brandById.get(brandId)
  const brandName = brand?.name ?? "This brand"
  const shipTo = useSession((s) => s.shipTo)
  const shipToCity = useSession((s) => s.shipToCity)
  const [product, setProduct] = useState<ProductChip | null>(() => chipFor(initialProduct?.productId, initialProduct?.variantId))
  const [order, setOrder] = useState<OrderChip | null>(initialOrder ?? null)
  const [pickProduct, setPickProduct] = useState(false)
  const [orderHelp, setOrderHelp] = useState(false)
  const [panel, setPanel] = useState<"delivery" | "drop" | null>(null)
  const [report, setReport] = useState<{ type: "message" | "conversation"; id: string } | null>(null)
  const composer = useRef<ComposerApi | null>(null)
  const scroller = useRef<ScrollerApi | null>(null)
  const createdRef = useRef<string | null>(null)

  const send = useCallback(
    async (clientId: string, payload: DraftPayload) => {
      const id = conversationId ?? createdRef.current
      const { quickReplyId: _qr, topic, ...rest } = payload
      void _qr
      const r = await sendMessage({
        ...rest,
        clientId,
        topic: topic as SendMessageBody["topic"],
        ...(id ? { conversationId: id } : { brandId, origin: initialProduct ? "product" : initialOrder ? "order" : "inbox" }),
      })
      if (!id) {
        createdRef.current = r.conversation.id
        onCreated(r.conversation.id)
      }
      return r
    },
    [conversationId, brandId, onCreated, initialProduct, initialOrder],
  )

  const t = useThread({ side: "customer", conversationId, send, active: true, onConversation })
  const search = useThreadSearch("customer", conversationId, t, scroller)
  const conv = t.conversation
  const interaction = conversationId ? conv?.interaction : newThreadInteraction
  const disabled = shopperDisabledReason(interaction, brandName)
  const canInteract = !disabled

  const sampleProduct = product ?? chipFor(products.find((p) => p.brandId === brandId && p.status === "published")?.id)
  const pieceName = product?.name ?? "this piece"
  const actions = [
    {
      disabled: !canInteract,
      key: "sizing",
      label: "Sizing",
      icon: RulerIcon,
      onClick: () => {
        const text = `Hi! What size would you recommend for ${product ? `the ${product.name}` : "this piece"}? I usually wear .`
        composer.current?.insert(text, { caret: text.length - 1, topic: "sizing" })
      },
    },
    {
      disabled: !canInteract,
      key: "stock",
      label: "In stock?",
      icon: PackageIcon,
      onClick: () =>
        composer.current?.insert(product?.variantLabel ? `Is the ${pieceName} in ${product.variantLabel} available — or coming back?` : `Is ${product ? `the ${pieceName}` : "this piece"} available in my size — or coming back?`, { topic: "availability" }),
    },
    {
      disabled: !canInteract,
      key: "delivery",
      label: "Delivery",
      icon: TruckIcon,
      pressed: panel === "delivery",
      onClick: () => {
        composer.current?.insert(`How long does delivery to ${shipToCity ? `${shipToCity}, ` : ""}${countries[shipTo]?.name ?? shipTo} usually take?`, { topic: "delivery" })
        setPanel((p) => (p === "delivery" ? null : "delivery"))
      },
    },
    {
      disabled: !canInteract,
      key: "drop",
      label: "Next drop",
      icon: CalendarDotsIcon,
      pressed: panel === "drop",
      onClick: () => {
        composer.current?.insert("When's your next drop?", { topic: "drops" })
        setPanel((p) => (p === "drop" ? null : "drop"))
      },
    },
    { key: "product", label: "Share a product", icon: TagIcon, disabled: !canInteract, onClick: () => setPickProduct(true) },
    { key: "order", label: "Order help", icon: ReceiptIcon, disabled: !canInteract, onClick: () => setOrderHelp(true) },
  ]

  const items = useMemo(() => [...t.messages.map((m) => ({ key: m.id, own: m.side === "customer" })), ...t.pending.map((p) => ({ key: p.clientId, own: true }))], [t.messages, t.pending])
  const last = items[items.length - 1]

  const archive = async (archived: boolean) => {
    if (!conv) return
    try {
      const r = await patchConversation(conv.id, { archived })
      t.setConversation(r.conversation)
      revalidatePrefix("inbox:list:")
      toast(archived ? "Archived" : "Moved back to your inbox", { description: archived ? "It comes back when either of you writes. Find it under Archived." : undefined })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const mute = async (muted: boolean) => {
    if (!conv) return
    try {
      const r = await patchConversation(conv.id, { muted })
      t.setConversation(r.conversation)
      revalidatePrefix("inbox:list:")
      toast(muted ? `Muted ${brandName}` : `Unmuted ${brandName}`, { description: muted ? "New replies won't notify you. They still show here." : undefined })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  const block = async (on: boolean) => {
    try {
      await blockBrand(brandId, on)
      await t.refresh()
      revalidatePrefix("inbox:list:")
      toast(on ? `Blocked ${brandName}` : `Unblocked ${brandName}`, { description: on ? "They can't message you. Find this conversation under Show blocked." : undefined })
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const onReact = async (m: MessageDto) => {
    try {
      await t.toggleReaction(m)
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't react. Try again."))
    }
  }

  const header = (
    <header className={cn("flex h-16 shrink-0 items-center gap-2 border-b border-line-soft px-2 md:px-4", layer && "pt-[env(safe-area-inset-top)] h-[calc(4rem+env(safe-area-inset-top))]")}>
      {search.open ? (
        <SearchBar s={search} />
      ) : (
        <>
          {onBack ? (
            <button type="button" onClick={onBack} aria-label="Back to conversations" className={cn(circle, "glass")}>
              <ArrowLeftIcon className="size-5" />
            </button>
          ) : null}
          <Link href={`/brands/${brand?.handle ?? ""}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-violet">
            {brand ? <BrandMark brand={brand} size="sm" className="size-9" /> : null}
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[0.9375rem] font-medium text-ink">{brandName}</span>
                {conv?.brand.verified ?? brand?.verified ? <SealCheckIcon weight="fill" className="size-4 shrink-0 text-violet" aria-label="Verified brand" /> : null}
                {conv?.sample ? <SampleChip /> : null}
              </span>
              {conv?.status === "resolved" ? <span className="block text-xs text-ink-3">Resolved. Writing again reopens it.</span> : null}
            </span>
          </Link>
          {conversationId ? <ConnectionChip status={t.realtime} className="hidden sm:inline-flex" /> : null}
          <button type="button" aria-label="Search this conversation" disabled={!conversationId} onClick={() => search.setOpen(true)} className={cn(circle, "bg-white/[0.04] disabled:opacity-40")}>
            <MagnifyingGlassIcon className="size-5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More" className={cn(circle, "bg-white/[0.04]")}>
                <DotsThreeIcon className="size-5" weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem asChild>
                <Link href={`/brands/${brand?.handle ?? ""}`}>
                  <StorefrontIcon /> View storefront
                </Link>
              </DropdownMenuItem>
              {conv ? (
                <>
                  <DropdownMenuItem onSelect={() => void mute(!conv.muted)}>
                    <BellSlashIcon /> {conv.muted ? "Unmute" : "Mute"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void archive(!conv.archived)}>
                    {conv.archived ? <ArrowCounterClockwiseIcon /> : <ArchiveIcon />} {conv.archived ? "Unarchive" : "Archive"}
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void block(!(conv?.blocked.byMe ?? interaction?.reason === "blocked_by_me"))}>
                <ProhibitIcon /> {conv?.blocked.byMe || interaction?.reason === "blocked_by_me" ? `Unblock ${brandName}` : `Block ${brandName}`}
              </DropdownMenuItem>
              {conv ? (
                <DropdownMenuItem onSelect={() => setReport({ type: "conversation", id: conv.id })}>
                  <FlagIcon /> Report conversation
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </header>
  )
  const chipRow = conversationId && !search.open ? <ConnectionChip status={t.realtime} className="mx-auto mt-2 sm:hidden" /> : null

  const rail = (
    <>
      <QuickActionRail actions={actions} label={`Ask ${brandName}`} />
      {panel === "delivery" ? (
        <div className="mt-2">
          <DeliveryEstimateCard productId={sampleProduct?.productId ?? null} country={shipTo} city={shipToCity} brandName={brandName} />
        </div>
      ) : panel === "drop" ? (
        <div className="mt-2">
          <NextDrop brandId={brandId} />
        </div>
      ) : null}
    </>
  )

  let body: React.ReactNode
  if (conversationId && (t.status === "loading" || t.status === "idle")) body = <ThreadSkeleton />
  else if (conversationId && t.status === "error")
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
        <p className="text-sm text-ink">Couldn&apos;t load this conversation.</p>
        <p className="max-w-xs text-xs text-ink-2">{errorMessage(t.error)}</p>
        <Button size="sm" variant="secondary" onClick={() => void t.load()}>
          <ArrowCounterClockwiseIcon /> Retry
        </Button>
      </div>
    )
  else
    body = (
      <ThreadScroller apiRef={scroller} resetKey={conversationId ?? `new:${brandId}`} firstKey={items[0]?.key} lastKey={last?.key ?? "empty"} lastIsOwn={!!last?.own} hasMore={t.hasMore} loadingOlder={t.loadingOlder} onLoadOlder={t.loadOlder} header={rail}>
        {!t.messages.length && !t.pending.length ? (
          <div className="px-2 py-10 text-center">
            <p className="text-sm text-ink">Ask {brandName} anything</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-ink-2">Sizing, stock, delivery or their next drop. Replies arrive here and in your notifications. Refunds and returns have their own steps on the order page.</p>
          </div>
        ) : null}
        <MessageList
          side="customer"
          messages={t.messages}
          pending={t.pending}
          otherName={brandName}
          theyreTyping={t.theyreTyping}
          receipts={t.receipts}
          canInteract={canInteract}
          onRetry={t.retry}
          onDiscard={t.discard}
          onReact={onReact}
          onReport={(m) => setReport({ type: "message", id: m.id })}
          highlight={search.q}
          matchSeqs={search.matchSet}
          activeSeq={search.active}
        />
      </ThreadScroller>
    )

  return (
    <section aria-label={`Conversation with ${brandName}`} className={cn("flex min-h-0 flex-col bg-obsidian", layer ? "h-full" : "h-full")}>
      {header}
      {chipRow}
      {body}
      {conversationId && t.status !== "ready" ? null : (
        <Composer
          apiRef={composer}
          disabledReason={disabled}
          onSend={(payload, preview) => {
            void t.send(payload, preview)
          }}
          onTyping={t.notifyTyping}
          uploadTarget={conversationId ? { purpose: "inbox_attachment", as: "shopper", conversationId } : { purpose: "inbox_attachment", as: "shopper", brandId }}
          product={product}
          onClearProduct={() => setProduct(null)}
          order={order}
          onClearOrder={() => setOrder(null)}
          onPickProduct={() => setPickProduct(true)}
          onPickOrder={() => setOrderHelp(true)}
          placeholder={`Message ${brandName}`}
          className={layer ? "border-t border-line-soft" : ""}
        />
      )}
      <ProductPicker open={pickProduct} onOpenChange={setPickProduct} brandId={brandId} onPick={(p) => setProduct(chipFor(p.id))} />
      <OrderHelp open={orderHelp} onOpenChange={setOrderHelp} brandId={brandId} onAttach={(o) => setOrder({ orderId: o.id, reference: o.reference })} />
      <ReportSheet open={!!report} onOpenChange={(o) => !o && setReport(null)} subjectType={report?.type ?? "conversation"} subjectId={report?.id ?? ""} as="shopper" subjectLabel={report?.type === "message" ? "message" : "conversation"} />
    </section>
  )
}
