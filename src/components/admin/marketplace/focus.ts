"use client"

/*
 * Focus return for the Control Center's overlays that aren't opened by a Radix trigger (a
 * record sheet opened from a name button, a row menu, a link or the URL; a dialog opened
 * from a callout). Radix only returns focus to its own trigger, so without this focus
 * drops to <body> and a keyboard user loses their place.
 */

/** Overlay surfaces whose controls are never the place to return to. */
const OVERLAY = '[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"],[data-radix-popper-content-wrapper]'

let lastOutside: HTMLElement | null = null
if (typeof document !== "undefined") {
  // The last control focused outside any overlay: for a row menu that's its trigger, for the
  // command palette whatever had focus before it opened.
  document.addEventListener(
    "focusin",
    (e) => {
      const t = e.target
      if (t instanceof HTMLElement && t !== document.body && !t.closest(OVERLAY)) lastOutside = t
    },
    true,
  )
}

/** The control that is opening an overlay right now. */
export function currentOpener(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null
  if (a && a !== document.body && !a.closest(OVERLAY)) return a
  // An item in a row menu: the menu names its trigger (a pointer press never focuses it).
  const menu = a?.closest<HTMLElement>('[role="menu"]')
  const trigger = menu?.getAttribute("aria-labelledby") ? document.getElementById(menu.getAttribute("aria-labelledby")!) : null
  return trigger ?? lastOutside
}

const usable = (el?: HTMLElement | null): el is HTMLElement => !!el && el.isConnected && !el.closest("[inert]") && el.getClientRects().length > 0

/** The page's own landmark for focus: the selected tab of the main view, else its heading. */
export function pageFocusTarget(): HTMLElement | null {
  const tab = Array.from(document.querySelectorAll<HTMLElement>('main [role="tab"][aria-selected="true"]')).find(usable)
  return tab ?? Array.from(document.querySelectorAll<HTMLElement>("main h1")).find(usable) ?? null
}

/** Focuses `opener` if it's still on the page, else `fallback`, else the page's landmark. */
export function focusBack(opener: HTMLElement | null, fallback?: () => HTMLElement | null | undefined) {
  const target = usable(opener) ? opener : [fallback?.()].find(usable) ?? pageFocusTarget()
  if (!target) return
  if (!target.matches("a[href],button,input,select,textarea,[tabindex]")) target.setAttribute("tabindex", "-1")
  target.focus({ preventScroll: true })
}
