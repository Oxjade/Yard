"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/**
 * The "select all" box over a list: the shared Checkbox (same tick, focus, disabled and
 * invalid styles as the rows), plus a dash when only some rows are selected, because the
 * shared Checkbox draws a tick for that state. Once it draws the dash itself, this goes and
 * callers use Checkbox directly.
 */
export function SelectAll({ checked, onCheckedChange, className, "aria-label": label }: { checked: boolean | "indeterminate"; onCheckedChange: (on: boolean) => void; className?: string; "aria-label": string }) {
  return (
    <Checkbox
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      aria-label={label}
      className={cn(
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground dark:data-[state=indeterminate]:bg-primary",
        "data-[state=indeterminate]:[&_svg]:hidden data-[state=indeterminate]:before:absolute data-[state=indeterminate]:before:h-0.5 data-[state=indeterminate]:before:w-2 data-[state=indeterminate]:before:rounded-full data-[state=indeterminate]:before:bg-current",
        className,
      )}
    />
  )
}
