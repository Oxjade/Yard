import * as React from "react"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * Liquid Glass, the one floating surface (styles in globals.css, "Liquid Glass").
 *
 * - `bar`: floating navigation (header groups, search capsule, the phone home bar, floating
 *   action buttons). Rounded by the caller, usually `rounded-full`.
 * - `panel`: popovers and panels (notifications, the search overlay, filter panels).
 * - `menu`: dropdowns, selects, command menus.
 * - `sheet`: dialogs, drawers and sheets.
 *
 * Only on things that float over content, never on page sections or cards in the flow.
 * `sheen` brightens the top edge for the largest surfaces.
 */
export type GlassVariant = "bar" | "panel" | "menu" | "sheet"

export function glass(variant: GlassVariant = "panel", { sheen = false }: { sheen?: boolean } = {}) {
  return cn(`glass-${variant}`, sheen && "glass-sheen")
}

export function GlassSurface({
  variant = "panel",
  sheen = false,
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { variant?: GlassVariant; sheen?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return <Comp data-glass={variant} className={cn(glass(variant, { sheen }), className)} {...props} />
}
