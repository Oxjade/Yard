"use client"

import { useRef, useSyncExternalStore } from "react"
import { useAdmin } from "@/lib/stores/admin"
import { useNotifications } from "@/lib/stores/notifications"
import { useStudio } from "@/lib/stores/studio"

type Persisted = { persist: { onFinishHydration: (fn: () => void) => () => void; hasHydrated: () => boolean } }

/**
 * True once a persisted store has read this browser's saved state. Until then the page shows
 * skeletons in place of counts, so a seeded figure never flashes before the real one.
 */
function useStoreReady(store: Persisted) {
  return useSyncExternalStore(
    (cb) => store.persist.onFinishHydration(cb),
    () => store.persist.hasHydrated(),
    () => false,
  )
}

export const useAdminReady = () => useStoreReady(useAdmin)
export const useStudioReady = () => useStoreReady(useStudio)
export const useNotificationsReady = () => useStoreReady(useNotifications)

/**
 * Runs `open` once any open menu has finished closing. A row menu hands focus back to its
 * trigger as it unmounts; opening a dialog before then would have that focus pulled out of
 * the dialog's first field (and its blur flag a reason as missing before anyone typed).
 * This waits on the menu actually leaving the page, never on a timer, and gives up after a
 * second so a stuck menu can't swallow the action.
 */
export function afterMenusClose(open: () => void) {
  const started = performance.now()
  const tick = () => {
    if (document.querySelector('[role="menu"]') && performance.now() - started < 1000) requestAnimationFrame(tick)
    else open()
  }
  requestAnimationFrame(tick)
}

/**
 * Focus for dialogs opened from a button or a row menu: these dialogs have no Radix trigger
 * to return to, so the control that opened them is remembered and focused again on close,
 * or, when that control has gone (the row left the list), the first match of `fallback`
 * (a list is tried selector by selector, in order).
 */
export function useDialogReturn(fallback?: string | string[]) {
  const opener = useRef<HTMLElement | null>(null)
  return {
    /** Opens after any menu has closed, remembering what had focus at that moment. */
    openFrom(open: () => void) {
      afterMenusClose(() => {
        opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
        open()
      })
    },
    onCloseAutoFocus(e: Event) {
      e.preventDefault()
      const o = opener.current
      const usable = o?.isConnected && !o.matches(":disabled")
      // Fallbacks are tried in the order given, not in document order.
      const target = usable ? o : [fallback ?? []].flat().reduce<HTMLElement | null>((found, sel) => found ?? firstVisible(sel), null)
      target?.focus()
    },
  }
}

/**
 * For a control that disables itself once its action is recorded (a retry, "Mark all as
 * read"): moves focus on to the next enabled match of `selector` after it in the page, else
 * the first, else `fallback`, so keyboard focus never drops to the page body.
 */
export function focusNextEnabled(self: HTMLElement, selector: string, fallback?: string) {
  const list = [...document.querySelectorAll<HTMLElement>(selector)].filter((el) => el !== self && !el.matches(":disabled") && visible(el))
  const next = list.find((el) => self.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ?? list[0] ?? (fallback ? firstVisible(fallback) : null)
  next?.focus()
}

/** Rendered (not inside a display:none phone or desktop variant), so it can take focus. */
const visible = (el: HTMLElement) => el.getClientRects().length > 0

/** The first match of `selector` that is on screen: tables render some controls twice, one per breakpoint. */
export function firstVisible(selector: string) {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(visible) ?? null
}
