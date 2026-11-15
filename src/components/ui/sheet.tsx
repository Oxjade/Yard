"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as SheetPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { useFocusReturn, type ReturnFocus } from "@/components/ui/dialog"
import { XIcon } from "@phosphor-icons/react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/55 duration-200 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/** Dragged further than this (px), or flicked faster than `FLICK` (px/ms), a bottom sheet closes. The same numbers as PhoneSheet. */
const DISMISS_AT = 96
const FLICK = 0.6

/**
 * Drag to dismiss for bottom sheets: the grab handle follows the finger (the sheet moves on the
 * `translate` property, so it never fights the enter/exit keyframes, which animate `transform`).
 * Let go past DISMISS_AT or with a flick and the sheet closes through its own Close (Radix runs
 * the exit from where the finger left it, down off the screen); otherwise it settles back on the
 * sheet's own transition. Upward drags are refused. Transform only, nothing reflows.
 */
function useDragToDismiss() {
  const sheet = React.useRef<HTMLDivElement | null>(null)
  const close = React.useRef<HTMLButtonElement | null>(null)
  const drag = React.useRef<{ id: number; y0: number; y: number; t: number; v: number } | null>(null)

  const end = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current
    const el = sheet.current
    drag.current = null
    if (!d || !el || d.id !== e.pointerId) return
    const dy = Math.max(0, d.y - d.y0)
    if (!cancelled && dy > 8 && (dy > DISMISS_AT || d.v > FLICK)) {
      // The exit keyframe moves `transform` the rest of the way; `translate` keeps the finger's offset.
      el.style.setProperty("--tw-exit-translate-y", "100%")
      close.current?.click()
      return
    }
    el.style.transition = ""
    el.style.translate = ""
  }

  const handle = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || !sheet.current) return
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { id: e.pointerId, y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0 }
      sheet.current.style.transition = "none"
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId || !sheet.current) return
      const dt = Math.max(1, e.timeStamp - d.t)
      d.v = (e.clientY - d.y) / dt
      d.y = e.clientY
      d.t = e.timeStamp
      sheet.current.style.translate = `0 ${Math.max(0, d.y - d.y0)}px`
    },
    onPointerUp: (e: React.PointerEvent) => end(e, false),
    onPointerCancel: (e: React.PointerEvent) => end(e, true),
  }
  return { sheet, close, handle }
}

/**
 * Focus goes back to whatever opened the sheet when it closes (see useFocusReturn in
 * dialog.tsx), or to `returnFocus` when that control is gone. `data-toast-avoid="footer"`
 * lets the Toaster lift toasts above the action bar along the sheet's bottom edge.
 *
 * Bottom sheets carry a grab handle and close when dragged down (useDragToDismiss), like the
 * marketplace's PhoneSheet. A sheet with its own handle (the Around place sheet) passes
 * `dragToDismiss={false}`. Escape, the close button and an outside press still close it.
 *
 * Content longer than the screen scrolls in an inner body (`min-h-0 flex-1 overflow-y-auto`) on
 * a sheet given `overflow-hidden`, never on SheetContent itself: the grab handle and the glass
 * rim are placed on the sheet and would scroll away with its content.
 */
function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  dragToDismiss = side === "bottom",
  opaque = false,
  returnFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  /** A grab handle that closes the sheet when dragged down (bottom sheets: on by default). */
  dragToDismiss?: boolean
  /**
   * An opaque surface instead of glass: no backdrop blur (`glass-opaque`). Pass it whenever the
   * sheet paints its own solid background (bg-surface and the like) or covers most of the screen,
   * so the blur doesn't run on every animation frame with nothing to show.
   */
  opaque?: boolean
  /** Where focus goes on close when the control that opened the sheet is gone or disabled. */
  returnFocus?: ReturnFocus
}) {
  const focus = useFocusReturn(returnFocus, onCloseAutoFocus)
  const { sheet: sheetRef, close: closeRef, handle } = useDragToDismiss()
  const draggable = dragToDismiss && side === "bottom"
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={sheetRef}
        data-slot="sheet-content"
        data-toast-avoid="footer"
        data-side={side}
        className={cn(
          "glass-sheet fixed z-50 flex flex-col gap-4 overscroll-contain text-sm text-popover-foreground transition data-open:duration-300 data-closed:duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10",
          opaque && "glass-opaque",
          className
        )}
        {...props}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        {focus.probe}
        {draggable ? (
          <>
            {/* The handle's strip spans the top edge between the corners (clear of the close
                button); it is decoration for assistive tech, which has Escape and Close. */}
            <div
              data-slot="sheet-handle"
              aria-hidden
              className="absolute inset-x-14 top-0 z-10 flex h-6 cursor-grab touch-none justify-center pt-2 select-none active:cursor-grabbing"
              {...handle}
            >
              <span className="h-1 w-10 rounded-full bg-white/20" />
            </div>
            <SheetPrimitive.Close ref={closeRef} tabIndex={-1} aria-hidden className="hidden" />
          </>
        ) : null}
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      data-toast-avoid=""
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
