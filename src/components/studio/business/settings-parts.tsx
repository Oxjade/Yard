"use client"

import { AnimatePresence, motion } from "motion/react"
import { CheckIcon as Check } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { spring } from "@/lib/motion"

const savedFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

/**
 * The footer of every settings section: state on the left, Discard and Save on the right.
 * Saving is confirmed here, in place: the button shows a check and the line says when it was
 * saved, so no toast is needed. `note` says what the save does and doesn't reach yet.
 */
export function SaveRow({
  dirty,
  savedAt,
  onDiscard,
  saveLabel = "Save",
  pending = false,
  succeeded = false,
  note,
}: {
  dirty: boolean
  savedAt?: string
  onDiscard: () => void
  saveLabel?: string
  pending?: boolean
  succeeded?: boolean
  note?: React.ReactNode
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line-soft pt-4">
      <span className="mr-auto min-h-4 text-xs" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {dirty ? (
            <motion.span key="dirty" initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy} className="inline-flex items-center gap-1.5 text-acid">
              <span className="size-1.5 rounded-full bg-acid" aria-hidden /> Unsaved changes
            </motion.span>
          ) : savedAt ? (
            <motion.span key={succeeded ? "just" : "saved"} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy} className="inline-flex flex-wrap items-center gap-x-1.5 text-ink-3">
              {succeeded ? <Check className="size-3.5 text-violet" aria-hidden /> : null}
              <span className={succeeded ? "text-ink-2" : undefined}>{succeeded ? "Saved" : `Saved ${savedFmt.format(new Date(savedAt))}`}</span>
              {note ? <span className="text-ink-3">{note}</span> : null}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
      {dirty ? (
        <Button type="button" size="sm" variant="ghost" onClick={onDiscard} disabled={pending}>
          Discard
        </Button>
      ) : null}
      <Button type="submit" size="sm" variant="secondary" disabled={!dirty && !pending && !succeeded} loading={pending} success={succeeded}>
        {saveLabel}
      </Button>
    </div>
  )
}
