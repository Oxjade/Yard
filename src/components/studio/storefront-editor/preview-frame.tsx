"use client"

import { forwardRef, memo, useEffect, useRef } from "react"
import { useAnimate } from "motion/react"
import { toast } from "sonner"
import { StorefrontRenderer, type StorefrontRendererProps } from "@/components/storefront/storefront-renderer"
import type { StorefrontSection } from "@/lib/data/types"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"

export type Device = "desktop" | "mobile"

/** Re-renders only when what it shows changes, not when a panel row is hovered. */
const Renderer = memo(StorefrontRenderer)

/** Everything the keyboard could stop on inside the rendered storefront. */
const TABBABLE = 'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'

/**
 * Takes the preview's links and buttons out of the Tab order (they only say "Links open on
 * your live storefront" here), while the mouse and screen readers can still reach them. It
 * re-runs whenever the deferred preview re-renders new elements.
 */
function useNoTabStops(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const mute = () => {
      root.querySelectorAll<HTMLElement>(TABBABLE).forEach((el) => {
        if (el.tabIndex !== -1) el.tabIndex = -1
      })
    }
    mute()
    const observer = new MutationObserver(mute)
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["tabindex", "href"] })
    return () => observer.disconnect()
  }, [ref])
}

/** The DOM id the renderer gives a section. */
export const sectionDomId = (section: Pick<StorefrontSection, "id" | "type">) => (section.type === "hero" ? "sf-hero" : `sf-${section.id}`)

/** Scrolls a preview container so a section sits at its top. */
export function scrollPreviewTo(frame: HTMLElement | null, domId: string, behavior: ScrollBehavior = "smooth") {
  if (!frame) return
  const el = frame.querySelector<HTMLElement>(`#${CSS.escape(domId)}`)
  if (!el) return
  const top = frame.scrollTop + el.getBoundingClientRect().top - frame.getBoundingClientRect().top
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  frame.scrollTo({ top: Math.max(0, top - 8), behavior: reduce ? "auto" : behavior })
}

type Props = Omit<StorefrontRendererProps, "preview" | "className"> & {
  device: Device
  /** Section outlined in the preview, for the row being hovered in the panel. */
  highlight?: string | null
  /** Desktop: the frame scrolls on its own. Phones: the page scrolls. */
  contained?: boolean
  className?: string
}

/**
 * The live preview: the real storefront renderer in draft mode, inside a frame that is either
 * the editor pane's width or a 390px phone. Switching sizes re-lays the storefront once and
 * fades it in (opacity only), instead of animating the width, which would re-lay the whole
 * storefront on every frame. Links don't navigate and shopping buttons are off, with a short
 * note saying so.
 */
export const PreviewFrame = forwardRef<HTMLDivElement, Props>(function PreviewFrame({ device, highlight, contained = true, className, ...renderer }, ref) {
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const shown = useRef(device)
  useEffect(() => {
    if (shown.current === device || !scope.current) return
    shown.current = device
    animate(scope.current, { opacity: [0, 1] }, { duration: duration.page, ease: ease.out })
  }, [device, animate, scope])
  useNoTabStops(scope)

  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const link = target.closest("a")
    if (link) {
      const href = link.getAttribute("href") ?? ""
      if (href.startsWith("#")) {
        scrollPreviewTo(e.currentTarget, href.slice(1))
        return
      }
      toast("Links open on your live storefront", { id: "sf-preview-link", description: "The preview stays put while you edit." })
      return
    }
    if (target.closest("article button:not([data-preview-allowed])")) {
      e.preventDefault()
      e.stopPropagation()
      toast("Shopping is off in the preview", { id: "sf-preview-shop", description: "Cart and wishlist work on your live storefront." })
    }
  }

  return (
    <div
      ref={ref}
      data-sf-preview=""
      onClickCapture={onClickCapture}
      // One Tab stop for the whole preview, so the keyboard can still scroll it with the arrow keys.
      tabIndex={contained ? 0 : undefined}
      role={contained ? "region" : undefined}
      aria-label={contained ? "Draft preview" : undefined}
      className={cn(
        "relative mx-auto w-full bg-obsidian focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-violet",
        // Clip sideways overflow so the pane never scrolls horizontally.
        contained ? "h-full overflow-x-hidden overflow-y-auto overscroll-contain" : "overflow-x-clip",
        device === "mobile" ? "max-w-[390px] border-x border-line" : "max-w-full border-x border-transparent",
        className,
      )}
    >
      {highlight ? (
        <style>{`[data-sf-preview] #${CSS.escape(highlight)}{outline:2px solid var(--color-violet);outline-offset:-2px}`}</style>
      ) : null}
      <div ref={scope}>
        <Renderer {...renderer} preview />
      </div>
    </div>
  )
})
