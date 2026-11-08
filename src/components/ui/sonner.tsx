"use client"

import { useEffect } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CheckCircleIcon as CircleCheckIcon, InfoIcon, WarningIcon as TriangleAlertIcon, XCircleIcon as OctagonXIcon, CircleNotchIcon as Loader2Icon } from "@phosphor-icons/react"
import { duration, ease } from "@/lib/motion"

/* ---------- Keeping toasts clear of sticky action bars ---------- */

/** Sonner's own layout: toasts are 356px wide, and phones (600px and narrower) span the screen. */
const TOAST_WIDTH = 356
const MOBILE_MAX = 600
const DESKTOP_OFFSET = { bottom: 24, right: 24 }
/** The comic tail (a 14px square turned 45deg, hung 9px below the box) and the offset shadow reach this far below the toast's box. */
const TAIL = 12
/** Space between a bar's top edge and the tip of the bubble's tail. */
const GAP = 8
/** A bar counts when its bottom edge is this close to the bottom of the screen (it is anchored there). */
const ANCHOR_SLACK = 160
/** After a change, keep measuring for this long so bars that slide in or out are followed. */
const FOLLOW_MS = 500

/**
 * Bars to stay above: anything marked `data-toast-avoid` (the Studio save bar, the storefront
 * editor and drop builder phone bars, SheetFooter, the bag drawer's footer), and for an open
 * element marked `data-toast-avoid="footer"` (SheetContent) the action bar along its bottom
 * edge: the direct child that ends where it ends and is short enough to be a bar, not a body.
 */
function avoidedRects(): DOMRect[] {
  const rects: DOMRect[] = []
  for (const el of document.querySelectorAll<HTMLElement>("[data-toast-avoid]")) {
    // Leaving: a save bar sliding away, an overlay on its way out.
    if (el.closest('[data-leaving],[role="dialog"][data-state="closed"]')) continue
    if (el.dataset.toastAvoid !== "footer") {
      if (el.getClientRects().length) rects.push(el.getBoundingClientRect())
      continue
    }
    const box = el.getBoundingClientRect()
    for (const child of el.children) {
      if (!(child instanceof HTMLElement) || !child.getClientRects().length) continue
      const position = getComputedStyle(child).position
      if (position === "absolute" || position === "fixed") continue
      const r = child.getBoundingClientRect()
      if (r.height > 0 && r.bottom >= box.bottom - 2 && r.height <= box.height * 0.45) rects.push(r)
    }
  }
  return rects
}

/**
 * How far toasts must rise to clear whatever bar sits at the bottom of the screen under them,
 * written to `--toast-lift` on <html>. Measured when the page changes (bars mount, sheets
 * open or close), scrolls (sticky bars) or resizes, and for a moment after each change so a
 * bar that slides in is followed. Nothing runs between changes.
 */
function useToastLift(mobileBottom: number) {
  useEffect(() => {
    const root = document.documentElement
    let frame = 0
    let followUntil = 0
    let lift = -1
    const resize = new ResizeObserver(() => schedule())
    let observed: Element[] = []

    function measure() {
      frame = 0
      const width = window.innerWidth
      const height = window.innerHeight
      const mobile = width <= MOBILE_MAX
      const base = mobile ? mobileBottom : DESKTOP_OFFSET.bottom
      // The strip toasts occupy: the full width on phones, the bottom-right column otherwise.
      const left = mobile ? 0 : width - DESKTOP_OFFSET.right - TOAST_WIDTH
      const right = mobile ? width : width - DESKTOP_OFFSET.right
      const rects = avoidedRects()
      let clearance = 0
      for (const r of rects) {
        if (r.right <= left || r.left >= right) continue
        if (r.top >= height || r.bottom < height - ANCHOR_SLACK) continue
        clearance = Math.max(clearance, height - r.top + TAIL + GAP)
      }
      const next = Math.round(Math.min(Math.max(0, clearance - base), height * 0.6))
      if (next !== lift) {
        lift = next
        if (next) root.style.setProperty("--toast-lift", `${next}px`)
        else root.style.removeProperty("--toast-lift")
      }
      // Watch the bars themselves for size changes (an error line, the sidebar collapsing).
      const els = Array.from(document.querySelectorAll("[data-toast-avoid]"))
      if (els.length !== observed.length || els.some((el, i) => el !== observed[i])) {
        resize.disconnect()
        els.forEach((el) => resize.observe(el))
        observed = els
      }
      if (rects.length && performance.now() < followUntil) frame = requestAnimationFrame(measure)
    }

    function schedule() {
      followUntil = performance.now() + FOLLOW_MS
      if (!frame) frame = requestAnimationFrame(measure)
    }

    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-toast-avoid", "data-state", "data-leaving", "hidden"] })
    window.addEventListener("scroll", schedule, { capture: true, passive: true })
    window.addEventListener("resize", schedule)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
      window.removeEventListener("scroll", schedule, { capture: true })
      window.removeEventListener("resize", schedule)
      root.style.removeProperty("--toast-lift")
    }
  }, [mobileBottom])
}

/**
 * Toasts pop up like comic speech bubbles from the bottom corner (above the phone home bar):
 * a quick spring pop, a tail, a hard purple offset shadow. `comic` (marketplace) is a white
 * bubble with black type; `calm` (Studio, Admin) is a dark bubble — same shape, quieter.
 * Concise, stackable (3 visible), dismissible, with actions where useful. Not for every
 * click: inline feedback is preferred when the change is visible in place.
 *
 * They never cover a sticky action bar: the stack rises above any bar marked
 * `data-toast-avoid` (and an open sheet's footer) while it is on screen, and settles back
 * when it goes.
 */
const Toaster = ({ tone = "comic", style, ...props }: ToasterProps & { tone?: "comic" | "calm" }) => {
  const comic = tone === "comic"
  // Marketplace phones: clear of the home bar and its raised Around pin (--tabbar-clear, 100px).
  const mobileBottom = comic ? 100 : 16
  useToastLift(mobileBottom)
  return (
    <Sonner
      theme={comic ? "light" : "dark"}
      position="bottom-right"
      offset={DESKTOP_OFFSET}
      mobileOffset={{ bottom: mobileBottom, left: 12, right: 12 }}
      visibleToasts={3}
      gap={14}
      closeButton
      duration={4000}
      className={`toaster group pop-toaster pop-${tone}`}
      style={{
        transform: "translateY(calc(var(--toast-lift, 0px) * -1))",
        transition: `transform ${duration.modal * 1000}ms cubic-bezier(${ease.out.join(",")})`,
        ...style,
      }}
      icons={{
        success: <CircleCheckIcon className={comic ? "size-4 text-purple" : "size-4 text-violet"} />,
        info: <InfoIcon className={comic ? "size-4 text-[#555]" : "size-4 text-ink-2"} />,
        warning: <TriangleAlertIcon className={comic ? "size-4 text-obsidian" : "size-4 text-acid"} />,
        error: <OctagonXIcon className="size-4 text-danger" />,
        loading: <Loader2Icon className={comic ? "size-4 animate-spin text-[#555]" : "size-4 animate-spin text-ink-2"} />,
      }}
      toastOptions={{
        classNames: {
          // Sonner's hover gap-filler (unlayered `[data-expanded=true]::after`) outranks the tail in
          // globals.css and stretches it into a long diagonal band while the stack is hovered.
          toast: "pop-toast font-sans data-[expanded=true]:after:bottom-[-9px]! data-[expanded=true]:after:h-[14px]! data-[expanded=true]:after:w-[14px]!",
          title: "text-[13.5px] font-semibold",
          description: "pop-desc text-[12.5px]",
          actionButton: comic ? "!bg-obsidian !text-ink !rounded-md !text-xs !font-semibold" : "!bg-ink !text-obsidian !rounded-md !text-xs !font-semibold",
          cancelButton: "!bg-transparent",
          closeButton: "pop-close",
          error: "pop-error",
          warning: "pop-warning",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
