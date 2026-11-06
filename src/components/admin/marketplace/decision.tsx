"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ReasonDialog, type ReasonFact } from "@/components/admin/ui/reason-dialog"

export type Decision = {
  title: string
  /** What confirming does, and anything to check first, in plain sentences. */
  description: string
  confirmLabel: string
  destructive?: boolean
  /**
   * The reason field's label. When it's left out, the dialog names whoever the description
   * says sees the reason (audienceLine: "Reason, shown to Lagos Static"); otherwise the reason
   * is for the audit log.
   */
  fieldLabel?: string
  /** Common reasons, offered as chips that fill the field. */
  presets?: string[]
  /** A short line of facts to check before confirming. */
  facts?: ReasonFact[]
  /** Something to know before confirming. */
  warning?: React.ReactNode
  /** Runs once the reason is valid. Recorded actions are local and finish at once. */
  run: (reason: string) => void | Promise<void>
}

/**
 * Every Control Center decision on these pages goes through the shared ReasonDialog (the same
 * one the Overview's decision queue uses). This hook keeps one dialog per view and:
 *
 * - remounts it for every new decision, so a reason typed for one record and then cancelled
 *   never carries over to the next;
 * - returns, from `ask`, a promise that resolves to true once the decision's `run` has finished
 *   and to false when the dialog closes any other way (Cancel, Escape, outside click, another
 *   decision asked first). A bulk action returns it to the DataTable, so the selection stays
 *   while the dialog is open and after a cancel, and leaves only once the decision is made;
 * - returns focus to the control that asked, or, when the decision removed that control or
 *   turned it disabled (the row left the tab, a menu item closed, a bulk action has no rows
 *   left), to `fallback` (or the nearest panel heading).
 */
export function useDecision(fallback?: () => HTMLElement | null | undefined) {
  const [state, setState] = useState<{ d: Decision; n: number; open: boolean } | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  /** Resolves the promise the open decision's `ask` returned; cleared once it has. */
  const pending = useRef<((done: boolean) => void) | null>(null)

  const settle = useCallback((done: boolean) => {
    const resolve = pending.current
    pending.current = null
    resolve?.(done)
  }, [])
  // A view that goes away with a decision still open never decided it.
  useEffect(() => () => settle(false), [settle])

  const ask = useCallback(
    (d: Decision): Promise<boolean> => {
      // A decision asked while another is still open ends that one undecided.
      settle(false)
      const result = new Promise<boolean>((resolve) => {
        pending.current = resolve
      })
      const open = () => {
        opener.current = document.activeElement as HTMLElement | null
        setState((s) => ({ d, n: (s?.n ?? 0) + 1, open: true }))
      }
      // Asked from a row menu: open once the menu has gone and handed focus back to its trigger.
      // Opening alongside it, the menu's focus return would land after the dialog took focus,
      // pulling focus out of the reason field, and the control to return to on close would be
      // the menu item that's about to unmount.
      if (!(document.activeElement as HTMLElement | null)?.closest('[role="menu"]')) {
        open()
        return result
      }
      const done = () => {
        if (document.querySelector('[role="menu"]')) return false
        observer.disconnect()
        // The menu returns focus on a zero-delay task of its own; this runs after it.
        window.setTimeout(open, 0)
        return true
      }
      const observer = new MutationObserver(done)
      observer.observe(document.body, { childList: true, subtree: true })
      done()
      return result
    },
    [settle],
  )

  const restore = useCallback(
    (e: Event) => {
      e.preventDefault()
      // A decision taken in a detail sheet that's still open lands back in the sheet.
      const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-content"][data-state="open"]')
      const back = opener.current
      // The opener only takes focus back while it can: still on the page, not in an inert
      // (leaving) region, and not disabled (a bulk action with no rows left greys out).
      const usable = !!back?.isConnected && !back.closest("[inert]") && !back.matches(":disabled")
      const target = usable ? back : (sheet ?? fallback?.() ?? Array.from(document.querySelectorAll<HTMLElement>("main h1")).find((h) => h.offsetParent !== null))
      if (target && !target.hasAttribute("tabindex") && !target.matches("a,button,input,select,textarea,[tabindex]")) target.setAttribute("tabindex", "-1")
      target?.focus({ preventScroll: true })
    },
    [fallback],
  )

  const dialog = (
    <ReasonDialog
      key={state?.n ?? 0}
      open={!!state?.open}
      onOpenChange={(open) => {
        // Confirming settles first (the dialog confirms before it closes), so this only
        // reports a close that didn't decide anything.
        if (!open) settle(false)
        setState((s) => (s ? { ...s, open } : s))
      }}
      title={state?.d.title ?? ""}
      description={state?.d.description ?? ""}
      confirmLabel={state?.d.confirmLabel ?? "Confirm"}
      destructive={state?.d.destructive}
      fieldLabel={state?.d.fieldLabel}
      presets={state?.d.presets}
      facts={state?.d.facts}
      warning={state?.d.warning}
      onConfirm={async (reason) => {
        if (!state) return
        // A failure throws on to the dialog, which keeps the reason for another try; the
        // promise stays open until that try succeeds or the dialog is closed.
        await state.d.run(reason)
        settle(true)
      }}
      onCloseAutoFocus={restore}
    />
  )

  return { ask, dialog }
}
