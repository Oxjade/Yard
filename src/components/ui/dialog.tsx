"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { menuTriggerFor } from "@/components/ui/dropdown-menu"
import { XIcon } from "@phosphor-icons/react"

/* ---------- Focus return ---------- */

/** Where focus goes when the control that opened an overlay is gone: an element, or a function that finds one at close time. */
export type ReturnFocus = HTMLElement | null | undefined | (() => HTMLElement | null | undefined)

/** Menus, listboxes, popovers and overlays on their way out: never a place to hand focus back to. */
const TRANSIENT = '[role="menu"],[role="listbox"],[data-radix-popper-content-wrapper],[role="dialog"][data-state="closed"],[role="alertdialog"][data-state="closed"]'

/** On the page, rendered, enabled, and not hidden from assistive tech or inside something closing. */
export function canTakeFocus(el: unknown): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el !== document.body &&
    el.isConnected &&
    el.getClientRects().length > 0 &&
    !el.matches(":disabled") &&
    el.getAttribute("aria-disabled") !== "true" &&
    !el.closest('[inert],[aria-hidden="true"]') &&
    !el.closest(TRANSIENT)
  )
}

/** Records what had focus as the content mounts. First child of the content, so its layout effect runs before any autoFocus field inside takes focus. */
function OpenerProbe({ capture }: { capture: () => void }) {
  React.useLayoutEffect(() => capture(), [capture])
  return null
}

/**
 * Radix returns focus only to a DialogTrigger, and most dialogs and sheets here open from
 * state, so on close focus would fall to <body>. This remembers what had focus when the
 * content opened and, on close, returns there; when that control has gone (a menu item, a
 * row that was removed) it tries `returnFocus`, then the trigger of the menu that opened the
 * overlay. The caller's own onCloseAutoFocus runs first: calling event.preventDefault()
 * there means the caller has placed focus itself, and nothing more happens.
 *
 * DialogContent and SheetContent use it already. An overlay built on the Radix Dialog
 * primitive directly renders `probe` as the content's first child and passes
 * `onCloseAutoFocus` to the content.
 */
export function useFocusReturn(returnFocus?: ReturnFocus, onCloseAutoFocus?: (event: Event) => void) {
  const opener = React.useRef<HTMLElement | null>(null)
  const menuTrigger = React.useRef<HTMLElement | null>(null)
  const capture = React.useCallback(() => {
    const active = document.activeElement
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null
    menuTrigger.current = menuTriggerFor(active)
  }, [])
  const handleClose = (event: Event) => {
    onCloseAutoFocus?.(event)
    const from = opener.current
    const menu = menuTrigger.current
    opener.current = null
    menuTrigger.current = null
    if (event.defaultPrevented) return
    const fallback = typeof returnFocus === "function" ? returnFocus() : returnFocus
    const target = [from, fallback, menu].find(canTakeFocus)
    // Nothing usable: leave it to Radix, which focuses a DialogTrigger when there is one.
    if (!target) return
    event.preventDefault()
    target.focus({ preventScroll: true })
  }
  return { probe: <OpenerProbe capture={capture} />, onCloseAutoFocus: handleClose }
}

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/55 duration-200 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  returnFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Where focus goes on close when the control that opened the dialog is gone or disabled. */
  returnFocus?: ReturnFocus
}) {
  const focus = useFocusReturn(returnFocus, onCloseAutoFocus)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl glass-strong p-6 text-sm text-popover-foreground data-open:duration-[240ms] data-closed:duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.97] data-open:slide-in-from-bottom-2 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.98]",
          className
        )}
        {...props}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        {focus.probe}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 rounded-b-2xl border-t border-white/10 bg-white/[0.02] -mx-6 -mb-6 p-4 px-6 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
