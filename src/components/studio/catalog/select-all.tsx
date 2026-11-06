"use client"

import { Checkbox } from "@/components/ui/checkbox"

/**
 * The "select all" box over a list. The shared Checkbox now draws a dash for
 * checked="indeterminate" itself, so this is only a convenience that hands back a boolean.
 * New code uses Checkbox directly; this stays for callers that still import it.
 */
export function SelectAll({ checked, onCheckedChange, className, "aria-label": label }: { checked: boolean | "indeterminate"; onCheckedChange: (on: boolean) => void; className?: string; "aria-label": string }) {
  return <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} aria-label={label} className={className} />
}
