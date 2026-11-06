"use client"

import { useState } from "react"
import { ArrowDownIcon, ArrowUpIcon, LightningIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { EmptyState } from "@/components/dashboard/empty-state"
import { ListSkeleton } from "@/components/feedback/skeletons"
import { useBelowLg } from "@/components/inbox/hooks"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { MAX_QUICK_REPLIES, type QuickReplyDto } from "@/lib/api/contracts/inbox"
import { errorMessage, fieldErrors } from "@/lib/api/errors"
import { createQuickReply, deleteQuickReply, reorderQuickReplies, updateQuickReply } from "@/lib/api/inbox"
import { useAsyncAction } from "@/hooks/use-async-action"
import { needsRole } from "@/lib/permissions"
import { cn } from "@/lib/utils"

type Draft = { id: string | null; title: string; shortcut: string; body: string }
const blank: Draft = { id: null, title: "", shortcut: "", body: "" }

/**
 * Quick replies (§6.2): the brand's saved answers, in order. Add, edit, reorder and delete need
 * inbox.manage; anyone who can read the inbox can use them in the composer by typing "/".
 */
export function QuickRepliesSheet({ open, onOpenChange, items, loading, error, onRetry, onChanged, canManage }: { open: boolean; onOpenChange: (o: boolean) => void; items: QuickReplyDto[] | undefined; loading: boolean; error: unknown; onRetry: () => void; onChanged: (items: QuickReplyDto[]) => void; canManage: boolean }) {
  const phone = useBelowLg()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const list = items ?? []

  const save = useAsyncAction(
    async () => {
      if (!draft) return
      setErrors({})
      const body = { title: draft.title.trim(), body: draft.body.trim(), shortcut: draft.shortcut.trim() ? draft.shortcut.trim().toLowerCase() : null }
      try {
        const r = draft.id ? await updateQuickReply(draft.id, body) : await createQuickReply(body)
        onChanged(draft.id ? list.map((q) => (q.id === r.item.id ? r.item : q)) : [...list, r.item])
        setDraft(null)
        return r.item
      } catch (e) {
        setErrors(fieldErrors(e))
        throw e
      }
    },
    { errorToast: true, error: "Couldn't save the quick reply. Check the fields and try again.", success: "Quick reply saved" },
  )

  async function move(i: number, d: number) {
    const ids = list.map((q) => q.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    const before = list
    onChanged(ids.map((id) => list.find((q) => q.id === id)!))
    try {
      onChanged((await reorderQuickReplies(ids)).items)
    } catch (e) {
      onChanged(before)
      toast.error(errorMessage(e))
    }
  }

  async function remove(q: QuickReplyDto) {
    const before = list
    onChanged(list.filter((x) => x.id !== q.id))
    try {
      await deleteQuickReply(q.id)
      toast(`Deleted “${q.title}”`)
    } catch (e) {
      onChanged(before)
      toast.error(errorMessage(e))
    }
  }

  const reason = canManage ? undefined : needsRole("inbox.manage")
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setDraft(null)
          setErrors({})
        }
      }}
    >
      <SheetContent side={phone ? "bottom" : "right"} className={cn("gap-0", phone ? "max-h-[88dvh] rounded-t-[20px]" : "data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]")}>
        <SheetHeader className="border-b border-line-soft">
          <SheetTitle>Quick replies</SheetTitle>
          <SheetDescription>Type / in a reply to use one. The text stays editable before you send.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {draft ? (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                void save.run()
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="qr-title">Title</Label>
                <Input id="qr-title" value={draft.title} maxLength={40} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-invalid={!!errors.title} placeholder="Sizing" />
                {errors.title ? <p className="text-xs text-danger">{errors.title}</p> : <p className="text-xs text-ink-3">{draft.title.length} / 40</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="qr-shortcut">Shortcut (optional)</Label>
                <Input id="qr-shortcut" value={draft.shortcut} maxLength={21} onChange={(e) => setDraft({ ...draft, shortcut: e.target.value.startsWith("/") || !e.target.value ? e.target.value : `/${e.target.value}` })} aria-invalid={!!errors.shortcut} placeholder="/size" />
                {errors.shortcut ? <p className="text-xs text-danger">{errors.shortcut}</p> : <p className="text-xs text-ink-3">A slash, then 2–20 lower-case letters, numbers or dashes.</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="qr-body">Reply</Label>
                <Textarea id="qr-body" value={draft.body} maxLength={1000} rows={6} onChange={(e) => setDraft({ ...draft, body: e.target.value })} aria-invalid={!!errors.body} />
                {errors.body ? <p className="text-xs text-danger">{errors.body}</p> : <p className="text-xs text-ink-3">{draft.body.length} / 1,000</p>}
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={save.pending} disabled={!draft.title.trim() || !draft.body.trim()}>
                  {draft.id ? "Save changes" : "Save quick reply"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : loading ? (
            <ListSkeleton rows={4} />
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
              <p className="text-sm text-ink">Couldn&apos;t load your quick replies.</p>
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Retry
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-2">
                <p className="text-xs text-ink-3 tabular">
                  {list.length} of {MAX_QUICK_REPLIES}
                </p>
                <Button size="sm" variant="secondary" disabled={!canManage || list.length >= MAX_QUICK_REPLIES} title={reason ?? (list.length >= MAX_QUICK_REPLIES ? "Delete one to add another." : undefined)} onClick={() => setDraft(blank)}>
                  <PlusIcon /> Add quick reply
                </Button>
              </div>
              {reason ? <p className="mb-3 text-xs text-ink-2">{reason} to add, edit or reorder quick replies. You can still use them.</p> : null}
              {!list.length ? (
                <EmptyState icon={LightningIcon} title="No quick replies yet" body="Save answers you type often — sizing, delivery times, restocks." />
              ) : (
                <ul className="grid gap-2">
                  {list.map((q, i) => (
                    <li key={q.id} className="rounded-lg border border-line-soft bg-card p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-sm text-ink">
                            {q.title}
                            {q.shortcut ? <span className="text-xs text-ink-3">{q.shortcut}</span> : null}
                          </p>
                          <p className="mt-1 line-clamp-3 text-xs text-ink-2">{q.body}</p>
                          <p className="mt-1 text-[11px] text-ink-3">Used {q.usageCount === 1 ? "once" : `${q.usageCount} times`}</p>
                        </div>
                        <div className="flex shrink-0 items-center">
                          <Button size="icon-sm" variant="ghost" aria-label={`Move ${q.title} up`} disabled={!canManage || i === 0} onClick={() => void move(i, -1)} className="pointer-coarse:size-10">
                            <ArrowUpIcon />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label={`Move ${q.title} down`} disabled={!canManage || i === list.length - 1} onClick={() => void move(i, 1)} className="pointer-coarse:size-10">
                            <ArrowDownIcon />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label={`Edit ${q.title}`} disabled={!canManage} onClick={() => setDraft({ id: q.id, title: q.title, shortcut: q.shortcut ?? "", body: q.body })} className="pointer-coarse:size-10">
                            <PencilSimpleIcon />
                          </Button>
                          <Button size="icon-sm" variant="ghost" aria-label={`Delete ${q.title}`} disabled={!canManage} onClick={() => void remove(q)} className="text-danger hover:text-danger pointer-coarse:size-10">
                            <TrashIcon />
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
