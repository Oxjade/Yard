"use client"

import { useCallback, useRef, useState } from "react"
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
 * - returns focus to the control that asked, or, when the decision removed that control (the
 *   row left the tab, a menu item closed), to `fallback` (or the nearest panel heading).
 */
export function useDecision(fallback?: () => HTMLElement | null | undefined) {
  const [state, setState] = useState<{ d: Decision; n: number; open: boolean } | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  const ask = useCallback((d: Decision) => {
    const open = () => {
      opener.current = document.activeElement as HTMLElement | null
      setState((s) => ({ d, n: (s?.n ?? 0) + 1, open: true }))
    }
    // Asked from a row menu: open once the menu has gone and handed focus back to its trigger.
    // Opening alongside it, the menu's focus return would land after the dialog took focus,
    // pulling focus out of the reason field, and the control to return to on close would be
    // the menu item that's about to unmount.
    if (!(document.activeElement as HTMLElement | null)?.closest('[role="menu"]')) return open()
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
  }, [])

  const restore = useCallback(
    (e: Event) => {
      e.preventDefault()
      // A decision taken in a detail sheet that's still open lands back in the sheet.
      const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-content"][data-state="open"]')
      const target = opener.current?.isConnected && !opener.current.closest("[inert]") ? opener.current : (sheet ?? fallback?.() ?? Array.from(document.querySelectorAll<HTMLElement>("main h1")).find((h) => h.offsetParent !== null))
      if (target && !target.hasAttribute("tabindex") && !target.matches("a,button,input,select,textarea,[tabindex]")) target.setAttribute("tabindex", "-1")
      target?.focus({ preventScroll: true })
    },
    [fallback],
  )

  const dialog = (
    <ReasonDialog
      key={state?.n ?? 0}
      open={!!state?.open}
      onOpenChange={(open) => setState((s) => (s ? { ...s, open } : s))}
      title={state?.d.title ?? ""}
      description={state?.d.description ?? ""}
      confirmLabel={state?.d.confirmLabel ?? "Confirm"}
      destructive={state?.d.destructive}
      fieldLabel={state?.d.fieldLabel}
      presets={state?.d.presets}
      facts={state?.d.facts}
      warning={state?.d.warning}
      onConfirm={(reason) => state?.d.run(reason)}
      onCloseAutoFocus={restore}
    />
  )

  return { ask, dialog }
}
