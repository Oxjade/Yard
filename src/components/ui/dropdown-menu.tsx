"use client"

import * as React from "react"
import { cn } from "cn"
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui"
import { CheckIcon, CaretRightIcon as ChevronRightIcon } from "@phosphor-icons/react"

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

/* ---------- Focus hand-off between menus and the dialogs they open ---------- */

/** Open modal overlays built on the Radix Dialog primitive (Dialog, Sheet, the bag drawer). Popovers are role="dialog" too, but never modal. */
function openDialogs(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"]')).filter((d) => !d.closest("[data-radix-popper-content-wrapper]"))
}

/** The trigger a dropdown's content is labelled by (Radix points aria-labelledby at it). */
function triggerOf(content: Element | null): HTMLElement | null {
  const id = content?.getAttribute("aria-labelledby")
  return id ? document.getElementById(id) : null
}

/**
 * The menu that is open, or that closed a moment ago, and its trigger. A dialog opened from
 * a menu item outlives the item, so it falls back to this trigger when it closes. "A moment"
 * covers dialogs that wait for the menu to leave before opening (one second at most).
 */
let lastMenu: { trigger: HTMLElement | null; closedAt: number | null } | null = null
const RECENT_MS = 1000

/**
 * The trigger of the dropdown menu `el` sits in (an item, or the menu itself on touch), else
 * of the menu that is open or has just closed. Used by DialogContent and SheetContent when
 * they open, so they can return focus there once the item is gone.
 */
export function menuTriggerFor(el: Element | null): HTMLElement | null {
  const own = triggerOf(el instanceof Element ? el.closest('[role="menu"]') : null)
  if (own) return own
  if (!lastMenu?.trigger) return null
  const recent = lastMenu.closedAt === null || performance.now() - lastMenu.closedAt < RECENT_MS
  return recent && lastMenu.trigger.isConnected ? lastMenu.trigger : null
}

/** Sets a ref of any kind (callback or object) passed in by a caller. */
function setRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value)
  else if (ref) (ref as React.RefObject<T | null>).current = value
}

/**
 * Closing a menu sends focus back to its trigger. When the item that closed it opened a
 * dialog or sheet, that dialog already holds focus, and pulling it back to the trigger would
 * blur the dialog's first field (flagging a reason as missing before anyone typed). So the
 * hand-back is skipped whenever a dialog opened while the menu was open; the dialog returns
 * focus to the trigger itself when it closes. A caller's onCloseAutoFocus runs first, and
 * calling preventDefault() there opts out of all of this.
 */
function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 4,
  ref,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  // Dialogs that were already open when the menu opened (a menu inside a sheet): they don't count.
  const before = React.useRef<HTMLElement[]>([])
  // The caller's ref, kept in a ref so `track` stays stable: a new callback would re-run it
  // on every render and take a fresh snapshot after an item had opened a dialog.
  const outer = React.useRef(ref)
  React.useLayoutEffect(() => {
    outer.current = ref
  })
  const track = React.useCallback((node: HTMLDivElement | null) => {
    setRef(outer.current, node)
    if (!node) return
    before.current = openDialogs()
    const entry = { trigger: triggerOf(node), closedAt: null as number | null }
    lastMenu = entry
    return () => {
      entry.closedAt = performance.now()
      setRef(outer.current, null)
    }
  }, [])
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
          collisionPadding={8}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn("z-50 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg glass-strong p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:duration-200 data-closed:duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:overflow-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.98]", className )}
        {...props}
        ref={track}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e)
          if (e.defaultPrevented) return
          const opened = openDialogs().some((d) => !before.current.includes(d))
          if (opened) e.preventDefault()
        }}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

/**
 * Leaving an item hands focus to the menu itself. When the item has just opened a dialog, the
 * dialog's overlay slides under a resting mouse and the item gets a pointerleave, which would
 * pull focus out of the dialog for a moment (and blur its first field). A closing menu skips it.
 */
function stayOutOfClosingMenu<E extends HTMLElement>(handler?: React.PointerEventHandler<E>): React.PointerEventHandler<E> {
  return (event) => {
    handler?.(event)
    if (event.currentTarget.closest('[role="menu"]')?.getAttribute("data-state") === "closed") event.preventDefault()
  }
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  onPointerLeave,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      onPointerLeave={stayOutOfClosingMenu(onPointerLeave)}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-2 py-2 text-sm outline-hidden select-none transition-colors duration-150 focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  onPointerLeave,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      onPointerLeave={stayOutOfClosingMenu(onPointerLeave)}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-2 pr-8 pl-2 text-sm transition-colors duration-150 outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon
          />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  onPointerLeave,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      onPointerLeave={stayOutOfClosingMenu(onPointerLeave)}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-2 pr-8 pl-2 text-sm transition-colors duration-150 outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon
          />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-2 py-2 text-sm outline-hidden select-none transition-colors duration-150 focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn("z-50 min-w-[96px] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-lg glass-strong p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 data-open:duration-200 data-closed:duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.98]", className )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
