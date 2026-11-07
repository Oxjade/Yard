"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  FlagIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  ProhibitIcon,
  ReceiptIcon,
  TagIcon,
  TruckIcon,
  UserIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { Composer, type ComposerApi, type ProductChip } from "@/components/inbox/composer"
import { ProductPicker, QuickActionRail } from "@/components/inbox/extras"
import { monthYear, sentence, shortDate } from "@/components/inbox/format"
import { MessageList, ThreadSkeleton } from "@/components/inbox/messages"
import { ConnectionChip, ThreadScroller, type ScrollerApi } from "@/components/inbox/thread-scroller"
import { SearchBar, useThreadSearch } from "@/components/inbox/thread-search"
import { useThread, type DraftPayload } from "@/components/inbox/use-thread"
import { Bone } from "@/components/feedback/skeletons"
import { Initials } from "@/components/studio/business/shared"
import { ReportSheet } from "@/components/report/report-sheet"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SampleChip } from "@/components/ui/sample-chip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { countries, countryCodes, type CountryCode } from "@/config/markets"
import { api } from "@/lib/api/client"
import type { BrandProfile } from "@/lib/api/contracts/session"
import type { ConversationSummary, CustomerContextDto, Interaction, MessageDto, QuickReplyDto } from "@/lib/api/contracts/inbox"
import { errorMessage } from "@/lib/api/errors"
import { blockCustomer, patchStudioConversation, sendStudioMessage } from "@/lib/api/inbox"
import { products } from "@/lib/data/products"
import { needsRole, teamRoleLabels } from "@/lib/permissions"
import { formatShortRange } from "@/lib/shipping/format"
import { useAsyncAction } from "@/hooks/use-async-action"
import { cn } from "@/lib/utils"

const circle = "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-violet"
const REFUND = /refund|return|cancel|missing|never arrived/i

export function studioDisabledReason(i: Interaction | undefined, ctx: { customer: string; brand: string; role: string }) {
  if (!i || i.canSend) return null
  switch (i.reason) {
    case "role":
      return `Your role (${ctx.role}) can read messages but not reply.`
    case "blocked_by_them":
      return `${ctx.customer} isn't accepting messages from you.`
    case "blocked_by_me":
      return `${sentence(`You blocked ${ctx.customer}`)} Unblock them from the menu to reply.`
    case "restricted":
      if (i.scope === "account") return i.until ? `Messaging is paused on your account until ${shortDate(i.until)}.` : "Messaging is paused on your account."
      return i.until ? `Yard paused replies from ${ctx.brand} until ${shortDate(i.until)}.` : `Yard has restricted ${ctx.brand}, so publishing and replies are paused.`
    case "locked":
      return "This conversation was closed by Yard."
    default:
      return "You can't reply here right now."
  }
}

type Props = {
  conversationId: string
  summary: ConversationSummary | null
  session: BrandProfile
  quickReplies: QuickReplyDto[] | undefined
  context: CustomerContextDto | undefined
  onOpenContext?: () => void
  /** "Their orders": the Customer sheet below xl, the context pane's orders at xl. */
  onShowOrders?: () => void
  onBack?: () => void
  /** Closes the thread (after Mark unread, so it stays unread). */
  onClose?: () => void
  onConversation?: (c: ConversationSummary) => void
  onChanged?: () => void
}

/** A Studio thread (§6.2): header with Resolve/Reopen and the menu, Studio quick actions, messages, composer. */
export function StudioThread({ conversationId, summary, session, quickReplies, context, onOpenContext, onShowOrders, onBack, onClose, onConversation, onChanged }: Props) {
  const [product, setProduct] = useState<ProductChip | null>(null)
  const [pickProduct, setPickProduct] = useState(false)
  const [confirm, setConfirm] = useState<"spam" | "block" | null>(null)
  const [report, setReport] = useState<{ type: "message" | "conversation"; id: string } | null>(null)
  const [countryAsk, setCountryAsk] = useState(false)
  const [country, setCountry] = useState<CountryCode | "">("")
  const composer = useRef<ComposerApi | null>(null)
  const scroller = useRef<ScrollerApi | null>(null)
  const canManage = session.permissions.includes("inbox.manage")
  const brandId = session.brand.id

  const send = useCallback((clientId: string, payload: DraftPayload) => sendStudioMessage({ conversationId, clientId, kind: payload.kind === "order" ? "text" : payload.kind, body: payload.body, productId: payload.productId, attachmentIds: payload.attachmentIds, quickReplyId: payload.quickReplyId }), [conversationId])
  const t = useThread({ side: "brand", conversationId, send, active: true, onConversation })
  const search = useThreadSearch("brand", conversationId, t, scroller)
  const conv = t.conversation ?? summary
  const customerName = conv?.customer?.name ?? "This shopper"
  const disabled = studioDisabledReason(t.conversation?.interaction, { customer: customerName, brand: session.brand.name, role: teamRoleLabels[session.role] })

  const patch = useAsyncAction(
    async (body: { status?: "open" | "resolved"; markedUnread?: boolean; spam?: boolean }) => {
      // A conversation marked unread must not be read again by this open thread.
      if (body.markedUnread) t.suppressAutoRead()
      const r = await patchStudioConversation(conversationId, body).catch((e: unknown) => {
        if (body.markedUnread) t.resumeAutoRead()
        throw e
      })
      t.setConversation(r.conversation)
      onChanged?.()
      if (body.status === "resolved") toast("Resolved", { description: `It reopens if ${customerName} writes again.` })
      if (body.status === "open") toast("Reopened")
      if (body.markedUnread) {
        toast("Marked unread", { description: "It stays unread until you open it again." })
        onClose?.()
      }
      if (body.spam === true) toast("Marked as spam", { description: r.alertRaised ? "Several brands marked this shopper, so Yard's trust and safety team was alerted." : "It left Open. Find it under Spam." })
      if (body.spam === false) toast("No longer marked as spam")
      return r
    },
    { error: "That didn't go through. Try again." },
  )
  const block = useAsyncAction(
    async (on: boolean) => {
      if (!conv?.customer) return
      await blockCustomer(conv.customer.id, on)
      await t.refresh()
      onChanged?.()
      toast(on ? `Blocked ${customerName}` : `Unblocked ${customerName}`, { description: on ? "They can't message you. Find them under Blocked." : undefined })
    },
    { error: "That didn't go through. Try again." },
  )

  // Delivery estimate: the country of the customer's latest order with you, else ask (never guess).
  const latest = context?.orders[0]
  const knownCountry = (context?.customer.lastShipToCountry as CountryCode | null | undefined) ?? null
  const estimate = useAsyncAction(
    async (to: CountryCode) => {
      const productId = latest?.items[0]?.productId ?? product?.productId ?? products.find((p) => p.brandId === brandId && p.status === "published")?.id
      if (!productId) throw new Error("no product")
      const r = await api<{ options: { available: boolean; service: string; transit: [number, number]; estimate?: { arrivalFrom?: string; arrivalTo?: string } }[] }>("/api/shipping/estimate", { query: { product: productId, to } })
      const o = r.options.find((x) => x.available && x.service === "standard") ?? r.options.find((x) => x.available)
      const name = countries[to]?.name ?? to
      if (!o) {
        toast(`${session.brand.name} doesn't list delivery to ${name}`, { description: "Add it in Shipping & fulfilment to quote it here." })
        return
      }
      const range = o.estimate?.arrivalFrom && o.estimate.arrivalTo ? formatShortRange(o.estimate.arrivalFrom, o.estimate.arrivalTo) : `${o.transit[0]}–${o.transit[1]} days in transit`
      composer.current?.insert(`Yard estimates delivery to ${name} at ${range}. It's an estimate, not a guarantee.`)
      setCountryAsk(false)
    },
    { error: "Couldn't load Yard's delivery estimate. Try again." },
  )

  const actions = [
    { key: "qr", label: "Quick replies", icon: LightningIcon, disabled: !!disabled, onClick: () => composer.current?.insert("/") },
    { key: "product", label: "Share a product", icon: TagIcon, disabled: !!disabled, onClick: () => setPickProduct(true) },
    { key: "orders", label: "Their orders", icon: ReceiptIcon, onClick: () => (onShowOrders ?? onOpenContext)?.() },
    { key: "delivery", label: "Delivery estimate", icon: TruckIcon, disabled: !!disabled, pressed: countryAsk, onClick: () => (knownCountry ? void estimate.run(knownCountry) : setCountryAsk((v) => !v)) },
  ]

  const items = useMemo(() => [...t.messages.map((m) => ({ key: m.id, own: m.side === "brand" })), ...t.pending.map((p) => ({ key: p.clientId, own: true }))], [t.messages, t.pending])
  const last = items[items.length - 1]
  const latestCustomer = [...t.messages].reverse().find((m) => m.side === "customer" && m.status === "sent")
  const refundHint = latestCustomer?.body && REFUND.test(latestCustomer.body)

  const onReact = async (m: MessageDto) => {
    try {
      await t.toggleReaction(m)
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't react. Try again."))
    }
  }
  const manageTitle = canManage ? undefined : needsRole("inbox.manage")
  const resolved = conv?.status === "resolved"

  const header = (
    <header className="flex min-h-16 shrink-0 items-center gap-2 border-b border-line-soft px-2 py-2 md:px-4">
      {search.open ? (
        <SearchBar s={search} />
      ) : (
        <>
          {onBack ? (
            <button type="button" onClick={onBack} aria-label="Back to conversations" className={cn(circle, "glass")}>
              <ArrowLeftIcon className="size-5" />
            </button>
          ) : null}
          {conv ? <Initials name={customerName} className="size-9" /> : <Bone className="size-9 shrink-0 rounded-full" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {conv ? <span className="truncate text-[0.9375rem] font-medium text-ink">{customerName}</span> : <Bone className="h-4 w-32" />}
              {conv?.sample ? <SampleChip /> : null}
            </div>
            <p className="truncate text-xs text-ink-2">
              {context ? (context.customer.customerSince ? `Since ${monthYear(context.customer.customerSince)}, ${context.customer.ordersCount} ${context.customer.ordersCount === 1 ? "order" : "orders"}` : "No orders with you yet") : " "}
            </p>
            <ConnectionChip status={t.realtime} className="mt-1" />
          </div>
          <Button size="sm" variant="secondary" disabled={!canManage || !conv} title={manageTitle} loading={patch.pending} onClick={() => void patch.run({ status: resolved ? "open" : "resolved" })} className="hidden sm:inline-flex">
            {resolved ? <ArrowCounterClockwiseIcon /> : <CheckCircleIcon />} {resolved ? "Reopen" : "Resolve"}
          </Button>
          <button type="button" aria-label="Search this conversation" onClick={() => search.setOpen(true)} className={cn(circle, "bg-white/[0.04]")}>
            <MagnifyingGlassIcon className="size-5" />
          </button>
          {onOpenContext ? (
            <Button size="sm" variant="ghost" onClick={onOpenContext} className="hidden lg:inline-flex xl:hidden">
              <UserIcon /> Customer
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More" className={cn(circle, "bg-white/[0.04]")}>
                <DotsThreeIcon className="size-5" weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem className="sm:hidden" disabled={!canManage} title={manageTitle} onSelect={() => void patch.run({ status: resolved ? "open" : "resolved" })}>
                {resolved ? <ArrowCounterClockwiseIcon /> : <CheckCircleIcon />} {resolved ? "Reopen" : "Resolve"}
              </DropdownMenuItem>
              {onOpenContext ? (
                <DropdownMenuItem className="lg:hidden" onSelect={onOpenContext}>
                  <UserIcon /> Customer and orders
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem disabled={!canManage} title={manageTitle} onSelect={() => void patch.run({ markedUnread: true })}>
                <EnvelopeSimpleIcon /> Mark unread
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canManage} title={manageTitle} onSelect={() => (conv?.spamState === "confirmed" ? void patch.run({ spam: false }) : setConfirm("spam"))}>
                <WarningIcon /> {conv?.spamState === "confirmed" ? "Not spam" : "Mark as spam"}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canManage} title={manageTitle} onSelect={() => (conv?.blocked.byMe ? void block.run(false) : setConfirm("block"))}>
                <ProhibitIcon /> {conv?.blocked.byMe ? "Unblock customer" : "Block customer"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setReport({ type: "conversation", id: conversationId })}>
                <FlagIcon /> Report conversation
              </DropdownMenuItem>
              {!canManage ? <p className="px-2 pt-1 pb-1.5 text-[11px] text-ink-3">{manageTitle} to resolve, mark spam or block.</p> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </header>
  )

  const rail = (
    <>
      <QuickActionRail actions={actions} label={`Reply to ${customerName}`} />
      {countryAsk ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line-soft bg-card p-3">
          <p className="w-full text-xs text-ink-2">{customerName} has no orders with you yet. Which country should Yard estimate delivery to?</p>
          <Select value={country} onValueChange={(v) => setCountry(v as CountryCode)}>
            <SelectTrigger className="h-10 w-52" aria-label="Destination country">
              <SelectValue placeholder="Choose a country" />
            </SelectTrigger>
            <SelectContent>
              {countryCodes.map((c) => (
                <SelectItem key={c} value={c}>
                  {countries[c].name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="secondary" disabled={!country} loading={estimate.pending} onClick={() => country && void estimate.run(country)}>
            Insert estimate
          </Button>
        </div>
      ) : estimate.pending ? (
        <p className="mt-2 text-xs text-ink-2" role="status">
          Getting Yard&apos;s estimate…
        </p>
      ) : null}
    </>
  )

  let body: React.ReactNode
  if (t.status === "loading" || t.status === "idle") body = <ThreadSkeleton />
  else if (t.status === "error")
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" role="alert">
        <p className="text-sm text-ink">Couldn&apos;t load this conversation</p>
        <p className="max-w-xs text-xs text-ink-2">{errorMessage(t.error)}</p>
        <Button size="sm" variant="secondary" onClick={() => void t.load()}>
          <ArrowCounterClockwiseIcon /> Retry
        </Button>
      </div>
    )
  else
    body = (
      <ThreadScroller apiRef={scroller} resetKey={conversationId} firstKey={items[0]?.key} lastKey={last?.key} lastIsOwn={!!last?.own} hasMore={t.hasMore} loadingOlder={t.loadingOlder} onLoadOlder={t.loadOlder} header={rail}>
        <MessageList
          side="brand"
          messages={t.messages}
          pending={t.pending}
          otherName={customerName.split(" ")[0]}
          theyreTyping={t.theyreTyping}
          receipts={t.receipts}
          canInteract={!disabled}
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
    <section aria-label={`Conversation with ${customerName}`} className="flex h-full min-h-0 flex-col">
      {header}
      {body}
      {t.status === "ready" ? (
        <Composer
          apiRef={composer}
          disabledReason={disabled}
          onSend={(payload, preview) => void t.send(payload, preview)}
          onTyping={t.notifyTyping}
          uploadTarget={{ purpose: "inbox_attachment", as: "brand", conversationId }}
          product={product}
          onClearProduct={() => setProduct(null)}
          onPickProduct={() => setPickProduct(true)}
          quickReplies={quickReplies ?? []}
          placeholder="Write a reply"
          hint={
            refundHint ? (
              <p className="mb-2 rounded-lg border border-line-soft bg-card px-3 py-2 text-xs text-ink-2">
                Refunds, returns and delivery problems are handled in{" "}
                <Link href={latest ? `/studio/orders/${latest.id}` : "/studio/orders"} className="text-violet underline-offset-2 hover:underline">
                  Orders{latest ? ` › ${latest.reference}` : ""}
                </Link>{" "}
                so there&apos;s a record.
              </p>
            ) : null
          }
        />
      ) : null}
      <ProductPicker open={pickProduct} onOpenChange={setPickProduct} brandId={brandId} onPick={(p) => setProduct({ productId: p.id, name: p.name, price: { amount: p.price, currency: p.currency } })} />
      <ReportSheet open={!!report} onOpenChange={(o) => !o && setReport(null)} subjectType={report?.type ?? "conversation"} subjectId={report?.id ?? ""} as="brand" subjectLabel={report?.type === "message" ? "message" : "conversation"} />
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm === "spam" ? `Mark ${customerName}'s conversation as spam?` : `Block ${customerName}?`}</DialogTitle>
            <DialogDescription>
              {confirm === "spam"
                ? "It leaves Open and moves to Spam. Yard counts marks from different brands; several can put the shopper's messages to other brands on hold for review. You can undo it from the menu."
                : `${customerName} won't be able to message ${session.brand.name}. The conversation stays readable, and you can unblock from the menu or the Blocked tab.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={confirm === "spam" ? patch.pending : block.pending}
              onClick={async () => {
                if (confirm === "spam") await patch.run({ spam: true })
                else await block.run(true)
                setConfirm(null)
              }}
            >
              {confirm === "spam" ? "Mark as spam" : "Block"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
