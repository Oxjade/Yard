"use client"

import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { ArrowUpIcon, ImageIcon, LightningIcon, PlusIcon, ReceiptIcon, TagIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react"
import { uploadErrorCopy, uploadRetryable } from "@/components/media/media-uploader"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { QuickReplyDto } from "@/lib/api/contracts/inbox"
import { apiUpload, type UploadTarget } from "@/lib/api/upload"
import { prepareImage, imageTypeProblem } from "@/lib/media/prepare-image"
import { cn } from "@/lib/utils"
import { useBelowLg, useMedia } from "./hooks"
import type { DraftPayload, PendingPreview } from "./use-thread"

/**
 * The pill composer (§6.2, inspiration zfVzXZ3Wj): a + button (Photo, Product, Order), the
 * pending chips above the pill, a textarea that grows from 1 to 5 lines (2,000 characters, with a
 * counter from 1,800) and a 40 px send circle: grey and disabled when empty, acid when ready.
 * Enter sends with a keyboard and mouse; on touch, Enter is a newline. In Studio, typing "/"
 * opens the quick replies; choosing one inserts its text, which stays editable.
 */

export type ComposerApi = {
  /** Replaces the draft with `text`; `caret` places the cursor (e.g. on a blank to fill in). */
  insert: (text: string, opts?: { caret?: number; topic?: DraftPayload["topic"] }) => void
  focus: () => void
}

export type ProductChip = { productId: string; variantId?: string; name: string; variantLabel?: string; price?: { amount: number; currency: string } }
export type OrderChip = { orderId: string; reference: string }

type Upload = { localId: string; previewUrl: string; progress: number; status: "uploading" | "done" | "error"; mediaId?: string; width: number | null; height: number | null; error?: string; retryable?: boolean; file: File; abort?: () => void }

type Props = {
  apiRef?: React.RefObject<ComposerApi | null>
  /** A line of text in place of the input when the composer can't send. */
  disabledReason?: string | null
  onSend: (payload: DraftPayload, preview: PendingPreview) => void
  onTyping?: () => void
  /** Where photos upload; null when uploads aren't possible here. */
  uploadTarget: UploadTarget | null
  product?: ProductChip | null
  onClearProduct?: () => void
  order?: OrderChip | null
  onClearOrder?: () => void
  onPickProduct?: () => void
  onPickOrder?: () => void
  quickReplies?: QuickReplyDto[]
  placeholder?: string
  /** Shown above the pill (Studio's refunds hint). */
  hint?: React.ReactNode
  className?: string
}

const MAX = 2000
const MAX_PHOTOS = 4

export function Composer({ apiRef, disabledReason, onSend, onTyping, uploadTarget, product, onClearProduct, order, onClearOrder, onPickProduct, onPickOrder, quickReplies, placeholder = "Write a message", hint, className }: Props) {
  const [text, setText] = useState("")
  const [topic, setTopic] = useState<DraftPayload["topic"]>()
  const [quickReplyId, setQuickReplyId] = useState<string | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [sheet, setSheet] = useState(false)
  const [qrIndex, setQrIndex] = useState(0)
  const [qrDismissed, setQrDismissed] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const pill = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const phone = useBelowLg()
  const fine = useMedia("(pointer: fine)")
  // On a phone the quick-reply hint would wrap the empty pill onto two lines; the rail card says it.
  const narrow = useMedia("(max-width: 639.98px)")
  const uploadsRef = useRef(uploads)
  useEffect(() => {
    uploadsRef.current = uploads
  })
  useEffect(
    () => () => {
      for (const u of uploadsRef.current) URL.revokeObjectURL(u.previewUrl)
    },
    [],
  )

  // Autosize: 1 to 5 lines.
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = "auto"
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22
    el.style.height = `${Math.min(el.scrollHeight, line * 5 + 16)}px`
  }, [text])

  useImperativeHandle(apiRef, () => ({
    insert(t, opts) {
      // Focus first, so moving focus into the pill can't dismiss the quick-reply list it opens.
      area.current?.focus()
      setText(t.slice(0, MAX))
      setQuickReplyId(null)
      setQrDismissed(false)
      setQrIndex(0)
      if (opts?.topic) setTopic(opts.topic)
      requestAnimationFrame(() => {
        const el = area.current
        if (!el) return
        el.focus()
        const at = opts?.caret ?? t.length
        el.setSelectionRange(at, at)
      })
    },
    focus() {
      area.current?.focus()
    },
  }))

  // Quick replies: "/" at the start opens the list, filtered by shortcut and title.
  const slash = quickReplies && text.startsWith("/") && !text.includes("\n") && !qrDismissed ? text.slice(1).toLowerCase() : null
  const qrMatches = useMemo(
    () => (slash === null || !quickReplies ? [] : quickReplies.filter((q) => (q.shortcut ?? "").slice(1).startsWith(slash) || q.title.toLowerCase().includes(slash)).slice(0, 8)),
    [slash, quickReplies],
  )
  const qrOpen = slash !== null && !!quickReplies
  const chooseQuickReply = (q: QuickReplyDto) => {
    setText(q.body.slice(0, MAX))
    setQuickReplyId(q.id)
    setQrIndex(0)
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(q.body.length, q.body.length)
    })
  }

  const done = uploads.filter((u) => u.status === "done")
  const uploading = uploads.some((u) => u.status === "uploading")
  const ready = !uploading && (text.trim().length > 0 || !!product || !!order || done.length > 0) && text.length <= MAX

  function startUpload(u: Upload) {
    if (!uploadTarget) return
    const handle = apiUpload(u.file, uploadTarget, (f) => setUploads((list) => list.map((x) => (x.localId === u.localId ? { ...x, progress: f } : x))))
    setUploads((list) => list.map((x) => (x.localId === u.localId ? { ...x, status: "uploading", progress: 0, error: undefined, abort: handle.abort } : x)))
    handle.promise
      .then((m) => setUploads((list) => list.map((x) => (x.localId === u.localId ? { ...x, status: "done", progress: 1, mediaId: m.id, width: m.width ?? x.width, height: m.height ?? x.height } : x))))
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return
        setUploads((list) => list.map((x) => (x.localId === u.localId ? { ...x, status: "error", error: uploadErrorCopy(e, "image", "inbox_attachment"), retryable: uploadRetryable(e) } : x)))
      })
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length || !uploadTarget) return
    const room = MAX_PHOTOS - uploads.length
    for (const f of [...files].slice(0, Math.max(0, room))) {
      const problem = imageTypeProblem(f)
      const localId = Math.random().toString(36).slice(2)
      if (problem) {
        setUploads((list) => [...list, { localId, previewUrl: "", progress: 0, status: "error", error: problem.message, retryable: false, width: null, height: null, file: f }])
        continue
      }
      try {
        const prepared = await prepareImage(f)
        const u: Upload = { localId, previewUrl: URL.createObjectURL(prepared), progress: 0, status: "uploading", width: null, height: null, file: prepared }
        setUploads((list) => [...list, u])
        startUpload(u)
      } catch (e) {
        setUploads((list) => [...list, { localId, previewUrl: "", progress: 0, status: "error", error: uploadErrorCopy(e, "image", "inbox_attachment"), retryable: false, width: null, height: null, file: f }])
      }
    }
    if (file.current) file.current.value = ""
  }

  function removeUpload(id: string) {
    setUploads((list) => {
      const u = list.find((x) => x.localId === id)
      u?.abort?.()
      if (u?.previewUrl) URL.revokeObjectURL(u.previewUrl)
      return list.filter((x) => x.localId !== id)
    })
  }

  function submit() {
    if (!ready) return
    const body = text.trim() ? text.trim() : undefined
    const attachmentIds = done.map((u) => u.mediaId!).filter(Boolean)
    const kind: DraftPayload["kind"] = attachmentIds.length ? "image" : product ? "product" : order ? "order" : "text"
    onSend(
      { kind, body, productId: product?.productId, variantId: product?.variantId, orderRefId: order?.orderId, attachmentIds: attachmentIds.length ? attachmentIds : undefined, quickReplyId: quickReplyId ?? undefined, topic },
      {
        product: product ? { productId: product.productId, name: product.name, variantLabel: product.variantLabel, price: product.price } : undefined,
        order: order ? { orderId: order.orderId, reference: order.reference } : undefined,
        images: done.map((u) => ({ src: u.previewUrl, width: u.width, height: u.height })),
      },
    )
    setText("")
    setQuickReplyId(null)
    setTopic(undefined)
    setUploads([])
    onClearProduct?.()
    onClearOrder?.()
    area.current?.focus()
  }

  if (disabledReason) {
    return (
      <div className={cn("px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)}>
        <p className="flex min-h-12 items-center justify-center rounded-[24px] border border-dashed border-line px-4 py-3 text-center text-sm text-ink-2" role="status">
          {disabledReason}
        </p>
      </div>
    )
  }

  const menuItems = [
    uploadTarget ? { key: "photo", label: "Photo", icon: ImageIcon, onSelect: () => file.current?.click(), disabled: uploads.length >= MAX_PHOTOS } : null,
    onPickProduct ? { key: "product", label: "Product", icon: TagIcon, onSelect: onPickProduct, disabled: false } : null,
    onPickOrder ? { key: "order", label: "Order", icon: ReceiptIcon, onSelect: onPickOrder, disabled: false } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x)

  const plusButton = (
    <button type="button" aria-label="Add a photo, product or order" disabled={!menuItems.length} className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-violet disabled:opacity-40" onClick={phone ? () => setSheet(true) : undefined}>
      <PlusIcon className="size-5" />
    </button>
  )

  return (
    <div className={cn("px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)} data-toast-avoid="">
      {hint}
      {product || order || uploads.length ? (
        <div className="mb-2 flex flex-wrap gap-2 px-1" aria-label="Attached to this message">
          {product ? (
            <Chip onRemove={onClearProduct} label={`Remove ${product.name}`}>
              <TagIcon className="size-3.5 text-ink-2" aria-hidden />
              <span className="max-w-48 truncate">{product.name}</span>
              {product.variantLabel ? <span className="text-ink-3">{product.variantLabel}</span> : null}
            </Chip>
          ) : null}
          {order ? (
            <Chip onRemove={onClearOrder} label={`Remove order ${order.reference}`}>
              <ReceiptIcon className="size-3.5 text-ink-2" aria-hidden />
              <span className="tabular">Order {order.reference}</span>
            </Chip>
          ) : null}
          {uploads.map((u) => (
            <div key={u.localId} className="relative">
              <div className={cn("relative size-14 overflow-hidden rounded-lg border bg-surface", u.status === "error" ? "border-danger/50" : "border-line-soft")}>
                {u.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.previewUrl} alt="" className="size-full object-cover" />
                ) : (
                  <WarningCircleIcon className="m-auto mt-4 size-5 text-danger" aria-hidden />
                )}
                {u.status === "uploading" ? (
                  <span className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-black/60" role="progressbar" aria-label="Uploading photo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(u.progress * 100)}>
                    <span className="block h-full bg-ink" style={{ width: `${Math.round(u.progress * 100)}%` }} />
                  </span>
                ) : null}
              </div>
              <button type="button" onClick={() => removeUpload(u.localId)} aria-label="Remove photo" className="absolute -top-2 -right-2 inline-flex size-6 items-center justify-center rounded-full border border-line bg-elevated text-ink-2 hover:text-ink pointer-coarse:size-8 pointer-coarse:after:absolute pointer-coarse:after:-inset-1">
                <XIcon className="size-3" />
              </button>
              {u.status === "error" ? (
                <p className="mt-1 w-40 text-[11px] leading-tight text-danger" role="alert">
                  {u.error}{" "}
                  {u.retryable ? (
                    <button type="button" className="text-ink underline underline-offset-2" onClick={() => startUpload(u)}>
                      Retry
                    </button>
                  ) : null}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <Popover open={qrOpen} onOpenChange={(o) => !o && setQrDismissed(true)}>
        <PopoverAnchor asChild>
          <div ref={pill} className="flex items-end gap-1 rounded-[24px] border border-line-soft bg-card p-1 focus-within:border-white/15">
            {phone || !menuItems.length ? (
              plusButton
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>{plusButton}</DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="min-w-40">
                  {menuItems.map((i) => (
                    <DropdownMenuItem key={i.key} disabled={i.disabled} onSelect={i.onSelect}>
                      <i.icon /> {i.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <label className="sr-only" htmlFor="inbox-composer">
              Message
            </label>
            <textarea
              id="inbox-composer"
              ref={area}
              rows={1}
              value={text}
              maxLength={MAX}
              placeholder={quickReplies && !narrow ? `${placeholder}, or type / for quick replies` : placeholder}
              onChange={(e) => {
                setText(e.target.value)
                setQrDismissed(false)
                if (!e.target.value) setQuickReplyId(null)
                if (e.target.value.trim()) onTyping?.()
              }}
              onKeyDown={(e) => {
                if (qrOpen && qrMatches.length) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault()
                    return setQrIndex((i) => (i + 1) % qrMatches.length)
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault()
                    return setQrIndex((i) => (i - 1 + qrMatches.length) % qrMatches.length)
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault()
                    return chooseQuickReply(qrMatches[Math.min(qrIndex, qrMatches.length - 1)])
                  }
                }
                if (e.key === "Escape" && qrOpen) {
                  e.preventDefault()
                  return setQrDismissed(true)
                }
                if (e.key === "Enter" && !e.shiftKey && fine && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
              aria-describedby={text.length >= 1800 ? "inbox-composer-count" : undefined}
              className="max-h-[8.5rem] min-h-10 flex-1 resize-none bg-transparent px-1.5 py-2.5 text-[0.9375rem] leading-[1.375rem] text-ink outline-none placeholder:text-ink-3"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!ready}
              aria-label="Send message"
              className={cn("inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-150 active:scale-95 focus-visible:outline-2 focus-visible:outline-violet", ready ? "bg-acid text-obsidian hover:bg-acid/85" : "bg-white/[0.08] text-ink-3")}
            >
              <ArrowUpIcon className="size-5" weight="bold" />
            </button>
          </div>
        </PopoverAnchor>
        <PopoverContent
          side="top"
          align="start"
          className="w-[min(26rem,calc(100vw-2rem))] p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Focus or clicks in the pill (the textarea the list belongs to) never close the list.
          onFocusOutside={(e) => {
            if (pill.current?.contains(e.target as Node)) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (pill.current?.contains(e.target as Node)) e.preventDefault()
          }}
        >
          <p className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[11px] text-ink-3">
            <LightningIcon className="size-3" aria-hidden /> Quick replies
          </p>
          {qrMatches.length ? (
            <ul role="listbox" aria-label="Quick replies">
              {qrMatches.map((q, i) => (
                <li key={q.id} role="option" aria-selected={i === qrIndex}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chooseQuickReply(q)}
                    className={cn("flex w-full flex-col items-start rounded-md px-2 py-2 text-left", i === qrIndex ? "bg-purple/20" : "hover:bg-white/[0.05]")}
                  >
                    <span className="flex w-full items-center justify-between gap-2 text-sm text-ink">
                      {q.title}
                      {q.shortcut ? <span className="text-xs text-ink-3">{q.shortcut}</span> : null}
                    </span>
                    <span className="line-clamp-1 text-xs text-ink-2">{q.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 pb-2 text-xs text-ink-2">{quickReplies?.length ? "No quick reply matches that shortcut." : "No quick replies yet. Save some from Quick replies."}</p>
          )}
        </PopoverContent>
      </Popover>
      {text.length >= 1800 ? (
        <p id="inbox-composer-count" className={cn("mt-1 px-3 text-right text-[11px] tabular", text.length >= MAX ? "text-danger" : "text-ink-3")}>
          {text.length.toLocaleString("en-GB")} / 2,000
        </p>
      ) : null}
      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="bottom" className="rounded-t-[20px] pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>Add to your message</SheetTitle>
            <SheetDescription className="sr-only">Attach a photo, a product or an order.</SheetDescription>
          </SheetHeader>
          <div className="grid gap-1 px-4 pb-2">
            {menuItems.map((i) => (
              <button
                key={i.key}
                type="button"
                disabled={i.disabled}
                onClick={() => {
                  setSheet(false)
                  // Let the sheet close before the file picker or the next sheet opens.
                  window.setTimeout(i.onSelect, 120)
                }}
                className="flex h-12 items-center gap-3 rounded-lg px-3 text-left text-[0.9375rem] text-ink hover:bg-white/[0.05] disabled:opacity-40"
              >
                <i.icon className="size-5 text-ink-2" /> {i.label}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove?: () => void; label: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-soft bg-card pr-1 pl-3 text-xs text-ink">
      {children}
      {onRemove ? (
        // `relative` keeps the touch hit area (::after) on the button: without it the pseudo-element
        // sized itself to the full-screen thread layer and every tap removed the chip.
        <button type="button" onClick={onRemove} aria-label={label} className="relative inline-flex size-6 items-center justify-center rounded-full text-ink-2 hover:bg-white/[0.08] hover:text-ink pointer-coarse:size-8 pointer-coarse:after:absolute pointer-coarse:after:-inset-1">
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
