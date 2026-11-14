"use client"

import { Fragment, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowCounterClockwiseIcon, CaretLeftIcon, CaretRightIcon, CopyIcon, DotsThreeIcon, FlagIcon, HeartIcon, ProhibitInsetIcon, ShieldWarningIcon, XIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { StatusBadge, orderStatusMeta } from "@/components/dashboard/status-badge"
import { OrderStatusBadge } from "@/components/market/account/order-status"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { MessageDto } from "@/lib/api/contracts/inbox"
import { safetyCopy } from "@/lib/api/contracts/inbox"
import { productById } from "@/lib/data/products"
import type { MerchantOrderStatus } from "@/lib/data/types"
import type { CurrencyCode } from "@/config/markets"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { dayLabel, heldExplanation, sameDay, seenLabel, shortDate, timeLabel } from "./format"
import type { Pending, ThreadSide } from "./use-thread"

/**
 * The chat itself (§6.2, inspiration zfVzXZ3Wj): date pills, bubbles grouped by sender within
 * 5 minutes (sent on the right in a lighter grey with a faint ring, received on the left in
 * bg-card with a hairline), a 6 px tail corner on the last bubble of a group, product and order cards, photo
 * grids with a lightbox, held, removed and safety states, ♥ reactions, the Seen receipt and the
 * typing row. Pending sends sit at the end at 60 % until the server answers.
 */

const GROUP_MS = 5 * 60_000

type Item = { kind: "message"; m: MessageDto } | { kind: "pending"; p: Pending }

function money(amount: number, currency: string) {
  try {
    return formatMoney(amount, currency as CurrencyCode)
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`
  }
}

/** Highlights `q` (case-insensitive) in plain text. */
function Highlight({ text, q }: { text: string; q?: string }) {
  const terms = (q ?? "")
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}'-]/gu, ""))
    .filter((t) => t.length > 1)
  if (!terms.length) return <>{text}</>
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi")
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-[3px] bg-purple/45 px-0.5 text-ink">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  )
}

export function DatePill({ iso }: { iso: string }) {
  return (
    <div className="flex justify-center py-3" role="separator" aria-label={dayLabel(iso)}>
      <span className="rounded-full bg-white/[0.05] px-3 py-1 text-xs text-ink-2">{dayLabel(iso)}</span>
    </div>
  )
}

export function TypingRow({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-2 text-xs text-ink-2" aria-live="polite">
      <span className="inline-flex h-7 items-center gap-1 rounded-[14px] rounded-bl-[6px] border border-line bg-card px-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 rounded-full bg-ink-2 motion-safe:animate-pulse" style={{ animationDelay: `${i * 0.16}s` }} />
        ))}
      </span>
      <span>{name} is typing…</span>
    </div>
  )
}

function ProductCard({ m, href }: { m: NonNullable<MessageDto["product"]>; href: string }) {
  const p = productById.get(m.productId)
  const image = p?.images[0]
  return (
    <div className="w-[min(15rem,72vw)]">
      <Link href={href} className="group/pc block overflow-hidden rounded-xl bg-card ring-1 ring-white/[0.06] focus-visible:outline-2 focus-visible:outline-violet">
        <div className="relative aspect-[4/5] w-full bg-surface">
          {image ? <Image src={image.src} alt={image.alt} fill sizes="240px" className="object-cover transition-transform duration-300 ease-out-quint motion-safe:group-hover/pc:scale-[1.02]" /> : null}
        </div>
      </Link>
      <div className="mt-2 flex items-start justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <p className="truncate text-sm text-ink">{m.name}</p>
          {m.variantLabel ? <p className="truncate text-xs text-ink-2">{m.variantLabel}</p> : null}
          <p className="mt-0.5 text-xs text-ink-2">
            <span className="text-ink tabular">{money(m.price.amount, m.price.currency)}</span> <span className="text-ink-3">price when shared</span>
          </p>
        </div>
        <Button asChild size="sm" variant="secondary" className="shrink-0">
          <Link href={href}>View</Link>
        </Button>
      </div>
    </div>
  )
}

function OrderCard({ o, side }: { o: NonNullable<MessageDto["order"]>; side: ThreadSide }) {
  const href = side === "customer" ? `/you/orders/${o.orderId}` : side === "support" ? `/admin/orders?order=${encodeURIComponent(o.orderId)}` : `/studio/orders/${o.orderId}`
  const status = o.status as MerchantOrderStatus
  return (
    <div className="w-[min(17rem,74vw)] rounded-xl border border-line-soft bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink tabular">{o.reference}</p>
        {side === "customer" ? <OrderStatusBadge status={status} /> : <StatusBadge tone={orderStatusMeta[o.status]?.tone ?? "neutral"}>{orderStatusMeta[o.status]?.label ?? o.status}</StatusBadge>}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-ink-3">Placed</dt>
        <dd className="text-right text-ink-2">{shortDate(o.placedAt)}</dd>
        <dt className="text-ink-3">Items</dt>
        <dd className="text-right text-ink-2 tabular">{o.itemCount}</dd>
        <dt className="text-ink-3">Total</dt>
        <dd className="text-right text-ink tabular">{money(o.total.amount, o.total.currency)}</dd>
      </dl>
      <Button asChild size="sm" variant="secondary" className="mt-3 w-full">
        <Link href={href}>Open order</Link>
      </Button>
    </div>
  )
}

function Photos({ items, onOpen }: { items: { src: string; width: number | null; height: number | null }[]; onOpen?: (i: number) => void }) {
  const one = items.length === 1
  return (
    <div className={cn("grid gap-1 overflow-hidden rounded-xl", one ? "w-[min(15rem,70vw)] grid-cols-1" : "w-[min(17rem,74vw)] grid-cols-2")}>
      {items.map((a, i) => (
        <button
          key={a.src}
          type="button"
          onClick={() => onOpen?.(i)}
          disabled={!onOpen}
          aria-label={`Open photo ${i + 1} of ${items.length}`}
          className={cn("relative block overflow-hidden bg-surface focus-visible:outline-2 focus-visible:outline-violet", one ? "aspect-[4/5]" : "aspect-square", items.length === 3 && i === 0 && "col-span-2 aspect-[2/1]")}
        >
          {/* Private media through the authorising route: a plain img (the optimiser drops cookies). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.src} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        </button>
      ))}
    </div>
  )
}

/** Photo zoom: the one overlay the chat uses (AGENTS-style lightbox). */
export function Lightbox({ items, index, onClose }: { items: { src: string }[]; index: number | null; onClose: () => void }) {
  const [i, setI] = useState(index ?? 0)
  const [shown, setShown] = useState(index)
  if (index !== shown) {
    setShown(index)
    setI(index ?? 0)
  }
  const open = index !== null && items.length > 0
  const step = (d: number) => setI((x) => (x + d + items.length) % items.length)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[100dvh] max-h-none w-screen max-w-none items-center justify-center rounded-none border-0 bg-obsidian/95 p-0 sm:max-w-none"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1)
          if (e.key === "ArrowLeft") step(-1)
        }}
      >
        <DialogTitle className="sr-only">Photo {i + 1} of {items.length}</DialogTitle>
        {open ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={items[i]?.src} alt="" className="max-h-[88dvh] max-w-[94vw] rounded-lg object-contain" />
        ) : null}
        <button type="button" onClick={onClose} aria-label="Close photo" className="glass absolute top-4 right-4 inline-flex size-10 items-center justify-center rounded-full text-ink">
          <XIcon className="size-5" />
        </button>
        {items.length > 1 ? (
          <>
            <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="glass absolute left-4 inline-flex size-10 items-center justify-center rounded-full text-ink">
              <CaretLeftIcon className="size-5" />
            </button>
            <button type="button" onClick={() => step(1)} aria-label="Next photo" className="glass absolute right-4 inline-flex size-10 items-center justify-center rounded-full text-ink">
              <CaretRightIcon className="size-5" />
            </button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

type ListProps = {
  /** "support": an admin reading a Yard Support thread. */
  side: ThreadSide
  messages: MessageDto[]
  pending: Pending[]
  /** The other party's display name (typing row). */
  otherName: string
  theyreTyping: boolean
  receipts: { theirs: { upToSeq: number; at: string | null } | null; enabled: boolean }
  canInteract: boolean
  onRetry: (clientId: string) => void
  onDiscard: (clientId: string) => void
  /** Absent: no ♥ reactions (Yard Support threads). */
  onReact?: (m: MessageDto) => void
  /** Absent: no Report action (Yard Support's own messages can't be reported). */
  onReport?: (m: MessageDto) => void
  highlight?: string
  matchSeqs?: Set<number>
  activeSeq?: number | null
  productHref?: (slug: string) => string
  /** Admin views of Yard Support threads: name the admin under each "support" message. */
  showAuthor?: boolean
}

export function MessageList({ side, messages, pending, otherName, theyreTyping, receipts, canInteract, onRetry, onDiscard, onReact, onReport, highlight, matchSeqs, activeSeq, productHref = (slug) => `/products/${slug}`, showAuthor }: ListProps) {
  const [lightbox, setLightbox] = useState<{ items: { src: string }[]; index: number } | null>(null)
  const items: Item[] = useMemo(() => [...messages.map((m) => ({ kind: "message" as const, m })), ...pending.map((p) => ({ kind: "pending" as const, p }))], [messages, pending])
  // The newest own delivered message carries the Seen receipt.
  const newestOwn = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].side === side && messages[i].status === "sent") return messages[i]
    return null
  }, [messages, side])
  const seen = receipts.enabled && newestOwn && receipts.theirs && receipts.theirs.upToSeq >= newestOwn.seq ? receipts.theirs : null

  const at = (it: Item) => (it.kind === "message" ? it.m.createdAt : it.p.createdAt)
  const who = (it: Item) => (it.kind === "message" ? it.m.side : side)

  return (
    <div className="flex flex-col">
      {items.map((it, idx) => {
        const prev = items[idx - 1]
        const next = items[idx + 1]
        const showDate = !prev || !sameDay(at(prev), at(it))
        const sideOf = who(it)
        const startsGroup = showDate || !prev || who(prev) !== sideOf || who(prev) === "system" || Date.parse(at(it)) - Date.parse(at(prev)) > GROUP_MS
        const endsGroup = !next || who(next) !== sideOf || !sameDay(at(next), at(it)) || Date.parse(at(next)) - Date.parse(at(it)) > GROUP_MS
        const key = it.kind === "message" ? it.m.id : `p:${it.p.clientId}`
        return (
          <Fragment key={key}>
            {showDate ? <DatePill iso={at(it)} /> : null}
            {sideOf === "system" && it.kind === "message" ? (
              <p className="py-2 text-center text-xs text-ink-3">{it.m.body}</p>
            ) : it.kind === "message" ? (
              <Bubble
                m={it.m}
                side={side}
                own={it.m.side === side}
                startsGroup={startsGroup}
                endsGroup={endsGroup}
                canInteract={canInteract}
                onReact={onReact}
                onReport={onReport}
                onPhotos={(index) => setLightbox({ items: it.m.attachments, index })}
                highlight={matchSeqs?.has(it.m.seq) ? highlight : undefined}
                active={activeSeq === it.m.seq}
                showAuthor={showAuthor}
                productHref={productHref}
                seen={newestOwn?.id === it.m.id ? seen : null}
              />
            ) : (
              <PendingBubble p={it.p} startsGroup={startsGroup} endsGroup={endsGroup} onRetry={onRetry} onDiscard={onDiscard} />
            )}
          </Fragment>
        )
      })}
      {theyreTyping ? <TypingRow name={otherName} /> : null}
      <Lightbox items={lightbox?.items ?? []} index={lightbox?.index ?? null} onClose={() => setLightbox(null)} />
    </div>
  )
}

const bubbleBase = "max-w-full px-3.5 py-2 text-[0.9375rem] leading-snug break-words whitespace-pre-wrap"
/**
 * Sent: a clearly lighter grey (ink at 14 % over the black page, about #292929; white text at
 * about 13:1) with a faint ring, so it reads as yours without relying on its side. Received:
 * near-black card with a hairline, the quieter of the two, as in the chat pin.
 */
const ownBubble = "bg-ink/[0.14] text-ink ring-1 ring-ink/[0.08]"
const theirBubble = "border border-line bg-card text-ink"
const radius = (own: boolean, endsGroup: boolean) => cn("rounded-[18px]", endsGroup && (own ? "rounded-br-[6px]" : "rounded-bl-[6px]"))

function Bubble({
  m,
  side,
  own,
  startsGroup,
  endsGroup,
  canInteract,
  onReact,
  onReport,
  onPhotos,
  highlight,
  active,
  productHref,
  seen,
  showAuthor,
}: {
  m: MessageDto
  side: ThreadSide
  own: boolean
  startsGroup: boolean
  endsGroup: boolean
  canInteract: boolean
  onReact?: (m: MessageDto) => void
  onReport?: (m: MessageDto) => void
  onPhotos: (i: number) => void
  highlight?: string
  active: boolean
  productHref: (slug: string) => string
  seen: { upToSeq: number; at: string | null } | null
  showAuthor?: boolean
}) {
  const [menu, setMenu] = useState(false)
  // On touch, a tap on the bubble reveals its actions; a long press reacts.
  const [revealed, setRevealed] = useState(false)
  const press = useRef<number | undefined>(undefined)
  const longPressed = useRef(false)
  const removed = m.status === "removed"
  const held = m.status === "held"
  const canReact = !!onReact && !own && !removed && !held && m.status === "sent" && canInteract
  const text = m.body ?? ""

  const startPress = () => {
    longPressed.current = false
    if (!canReact) return
    press.current = window.setTimeout(() => {
      press.current = undefined
      longPressed.current = true
      onReact?.(m)
    }, 520)
  }
  const endPress = (e?: React.PointerEvent) => {
    window.clearTimeout(press.current)
    press.current = undefined
    if (e?.type === "pointerup" && e.pointerType === "touch" && !longPressed.current) setRevealed((v) => !v)
  }

  return (
    <div data-seq={m.seq} className={cn("group/msg flex flex-col", own ? "items-end" : "items-start", startsGroup ? "mt-3" : "mt-1")}>
      {m.safetyNotice && !own ? (
        <p className="mb-1.5 flex max-w-[min(32rem,85%)] items-start gap-1.5 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs text-ink">
          <ShieldWarningIcon className="mt-px size-3.5 shrink-0 text-ink-2" aria-hidden />
          {side === "support" ? safetyCopy.brand : safetyCopy[side]}
        </p>
      ) : null}
      <div className={cn("flex w-full items-end gap-1.5", own ? "flex-row-reverse" : "flex-row")}>
        <div className={cn("relative flex min-w-0 max-w-[min(32rem,80%)] flex-col gap-1.5", own ? "items-end" : "items-start")}>
          {m.product && !removed ? <ProductCard m={m.product} href={productHref(m.product.slug)} /> : null}
          {m.order && !removed ? <OrderCard o={m.order} side={side} /> : null}
          {m.attachments.length && !removed ? <Photos items={m.attachments} onOpen={onPhotos} /> : null}
          {removed ? (
            <div className={cn(bubbleBase, radius(own, endsGroup), "inline-flex items-center gap-1.5 border border-dashed border-line text-ink-3 italic")}>
              <ProhibitInsetIcon className="size-3.5 not-italic" aria-hidden /> Message removed by Yard.
            </div>
          ) : held ? (
            <div className={cn(bubbleBase, radius(own, endsGroup), "border border-dashed border-line bg-transparent text-ink-2")}>
              <span className="mb-1 inline-flex h-5 items-center rounded-[4px] border border-white/10 px-1.5 text-[10px] text-ink-2">Held for review</span>
              {text ? <span className="block">{text}</span> : null}
              <span className="mt-1 block text-xs text-ink-3">{heldExplanation(side === "support" ? "brand" : side)}</span>
            </div>
          ) : text ? (
            <div
              className={cn(bubbleBase, radius(own, endsGroup), own ? ownBubble : theirBubble, active && "ring-2 ring-violet")}
              onDoubleClick={() => canReact && onReact?.(m)}
              onPointerDown={startPress}
              onPointerUp={endPress}
              onPointerLeave={() => endPress()}
              onContextMenu={(e) => {
                if (press.current !== undefined || canReact) e.preventDefault()
              }}
            >
              <Highlight text={text} q={highlight} />
            </div>
          ) : null}
          {m.reaction?.mine || m.reaction?.theirs ? (
            <span
              className={cn("absolute -bottom-2 inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-full border border-obsidian bg-elevated px-1", own ? "-left-2" : "-right-2")}
              aria-label={m.reaction.mine && m.reaction.theirs ? "You both loved this" : m.reaction.mine ? "You loved this" : own ? "They loved this" : "Loved"}
            >
              <HeartIcon weight="fill" className={cn("size-3", m.reaction.mine ? "text-violet" : "text-ink")} />
            </span>
          ) : null}
        </div>
        {!removed && !held ? (
          <DropdownMenu open={menu} onOpenChange={setMenu}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Message actions"
                className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink-3 opacity-0 transition-opacity group-hover/msg:opacity-100 hover:bg-white/[0.06] hover:text-ink focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:size-10", revealed || menu ? "pointer-coarse:opacity-100" : "pointer-coarse:hidden")}
              >
                <DotsThreeIcon className="size-4" weight="bold" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={own ? "end" : "start"} className="min-w-40">
              {canReact ? (
                <DropdownMenuItem onSelect={() => onReact?.(m)}>
                  <HeartIcon weight={m.reaction?.mine ? "fill" : "regular"} /> {m.reaction?.mine ? "Remove ♥" : "React ♥"}
                </DropdownMenuItem>
              ) : null}
              {text ? (
                <DropdownMenuItem
                  onSelect={() => {
                    void navigator.clipboard
                      ?.writeText(text)
                      .then(() => toast("Copied"))
                      .catch(() => toast.error("Couldn't copy. Select the text instead."))
                  }}
                >
                  <CopyIcon /> Copy
                </DropdownMenuItem>
              ) : null}
              {!own && onReport ? (
                <DropdownMenuItem onSelect={() => onReport(m)}>
                  <FlagIcon /> Report
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {endsGroup || seen ? (
        <p className={cn("mt-1 px-1 text-[11px] text-ink-3", m.reaction?.mine || m.reaction?.theirs ? "mt-2.5" : "")}>
          <time dateTime={m.createdAt}>{timeLabel(m.createdAt)}</time>
          {showAuthor && m.author ? <span className="ml-2">{m.author.name}</span> : null}
          {m.quickReply ? <span className="ml-2">Quick reply</span> : null}
          {seen ? <span className="ml-2 text-ink-2">{seenLabel(seen.at, m.createdAt)}</span> : null}
        </p>
      ) : null}
    </div>
  )
}

function PendingBubble({ p, startsGroup, endsGroup, onRetry, onDiscard }: { p: Pending; startsGroup: boolean; endsGroup: boolean; onRetry: (id: string) => void; onDiscard: (id: string) => void }) {
  const failed = p.status === "failed"
  const text = p.payload.body ?? ""
  return (
    <div className={cn("flex flex-col items-end", startsGroup ? "mt-3" : "mt-1")} aria-busy={!failed}>
      <div className={cn("flex max-w-[min(32rem,80%)] flex-col items-end gap-1.5", !failed && "opacity-60")}>
        {p.preview.product ? (
          <div className="rounded-xl border border-line-soft bg-card px-3 py-2 text-sm text-ink">
            {p.preview.product.name}
            {p.preview.product.variantLabel ? <span className="block text-xs text-ink-2">{p.preview.product.variantLabel}</span> : null}
          </div>
        ) : null}
        {p.preview.order ? <div className="rounded-xl border border-line-soft bg-card px-3 py-2 text-sm text-ink tabular">Order {p.preview.order.reference}</div> : null}
        {p.preview.images?.length ? <Photos items={p.preview.images} /> : null}
        {text ? <div className={cn(bubbleBase, radius(true, endsGroup), ownBubble, failed && "ring-danger/40")}>{text}</div> : null}
      </div>
      {failed ? (
        <div className="mt-1 flex flex-wrap items-center justify-end gap-x-1 gap-y-1 text-[11px]" role="alert">
          <span className="text-danger">{p.error ?? "Not sent."}</span>
          <Button size="sm" variant="ghost" onClick={() => onRetry(p.clientId)} className="text-ink">
            <ArrowCounterClockwiseIcon /> Retry
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDiscard(p.clientId)}>
            Discard
          </Button>
        </div>
      ) : (
        <p className="mt-1 px-1 text-[11px] text-ink-3">Sending…</p>
      )}
    </div>
  )
}

/** Alternating bubble bones, shaped like a conversation. */
export function ThreadSkeleton() {
  const rows = [
    ["start", "w-48"],
    ["start", "w-64"],
    ["end", "w-56"],
    ["start", "w-40"],
    ["end", "w-72"],
    ["end", "w-36"],
    ["start", "w-60"],
  ] as const
  return (
    <div role="status" aria-label="Loading messages" className="flex flex-col gap-2.5 px-4 py-6">
      <div className="mb-2 flex justify-center">
        <Bone className="h-6 w-20 rounded-full" />
      </div>
      {rows.map(([align, w], i) => (
        <div key={i} className={cn("flex", align === "end" ? "justify-end" : "justify-start")}>
          <Bone className={cn("h-10 rounded-[18px]", w)} />
        </div>
      ))}
    </div>
  )
}
