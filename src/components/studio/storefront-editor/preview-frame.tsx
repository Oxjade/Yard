"use client"

import { forwardRef, memo } from "react"
import { toast } from "sonner"
import { StorefrontRenderer, type StorefrontRendererProps } from "@/components/storefront/storefront-renderer"
import type { StorefrontSection } from "@/lib/data/types"
import { cn } from "@/lib/utils"

export type Device = "desktop" | "mobile"

/** Re-renders only when what it shows changes, not when a panel row is hovered. */
const Renderer = memo(StorefrontRenderer)

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
 * The live preview: the real storefront renderer in draft mode, inside a frame that eases
 * between the editor pane's width and a 390px phone. Links don't navigate and shopping
 * buttons are off, with a short note saying so.
 */
export const PreviewFrame = forwardRef<HTMLDivElement, Props>(function PreviewFrame({ device, highlight, contained = true, className, ...renderer }, ref) {
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
    if (target.closest("article button")) {
      e.preventDefault()
      e.stopPropagation()
      toast("Shopping is off in the preview", { id: "sf-preview-shop", description: "Bag and wishlist work on your live storefront." })
    }
  }

  return (
    <div
      ref={ref}
      data-sf-preview=""
      onClickCapture={onClickCapture}
      className={cn(
        "relative mx-auto w-full bg-obsidian transition-[max-width,border-color] duration-500 ease-out-quint motion-reduce:transition-none",
        // Clip sideways overflow so the pane never scrolls horizontally.
        contained ? "h-full overflow-x-hidden overflow-y-auto overscroll-contain" : "overflow-x-clip",
        device === "mobile" ? "max-w-[390px] border-x border-line" : "max-w-full border-x border-transparent",
        className,
      )}
    >
      {highlight ? (
        <style>{`[data-sf-preview] #${CSS.escape(highlight)}{outline:2px solid var(--color-violet);outline-offset:-2px}`}</style>
      ) : null}
      <Renderer {...renderer} preview />
    </div>
  )
})
