"use client"

import { AnimatePresence, motion } from "motion/react"
import { Button } from "@/components/ui/button"
import { spring } from "@/lib/motion"

const savedFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

/** The footer of every settings section: state on the left, Discard and Save on the right. */
export function SaveRow({ dirty, savedAt, onDiscard, saveLabel = "Save" }: { dirty: boolean; savedAt?: string; onDiscard: () => void; saveLabel?: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-line-soft pt-4">
      <span className="mr-auto min-h-4 text-xs" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          {dirty ? (
            <motion.span key="dirty" initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy} className="inline-flex items-center gap-1.5 text-acid">
              <span className="size-1.5 rounded-full bg-acid" aria-hidden /> Unsaved changes
            </motion.span>
          ) : savedAt ? (
            <motion.span key="saved" initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy} className="text-ink-3">
              Saved {savedFmt.format(new Date(savedAt))}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
      {dirty ? (
        <Button type="button" size="sm" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
      ) : null}
      <Button type="submit" size="sm" variant="secondary" disabled={!dirty}>
        {saveLabel}
      </Button>
    </div>
  )
}
