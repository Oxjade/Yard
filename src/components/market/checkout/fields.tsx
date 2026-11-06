"use client"

import { Info } from "lucide-react"
import { motion } from "motion/react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/** aria wiring for a control inside <Field>. */
export function describedBy(id: string, error?: string, hint?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const
}

/** Label, control, then either the error (validated on continue) or a hint. */
export function Field({
  id,
  label,
  optional,
  hint,
  error,
  className,
  children,
}: {
  id: string
  label: string
  optional?: boolean
  hint?: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="font-normal text-ink-3">(optional)</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export const inputClass = "h-11"

/** A radio group whose options are cards; the selection ring slides between them. */
export function OptionGroup({
  value,
  onValueChange,
  label,
  className,
  children,
}: {
  value: string
  onValueChange: (v: string) => void
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <RadioGroupPrimitive.Root value={value} onValueChange={onValueChange} aria-label={label} className={cn("grid gap-3", className)}>
      {children}
    </RadioGroupPrimitive.Root>
  )
}

export function OptionCard({
  value,
  checked,
  ringId,
  icon,
  title,
  description,
  aside,
}: {
  value: string
  checked: boolean
  /** Shared by the options of one group so the ring animates between them. */
  ringId: string
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      className={cn(
        "relative flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian",
        checked ? "border-transparent bg-purple/8" : "border-line bg-card hover:border-ink-3/60",
      )}
    >
      {checked ? (
        <motion.span layoutId={ringId} aria-hidden className="pointer-events-none absolute inset-0 rounded-lg border-2 border-violet" transition={{ type: "spring", stiffness: 520, damping: 40 }} />
      ) : null}
      <span
        aria-hidden
        className={cn("mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors", checked ? "border-violet" : "border-ink-3")}
      >
        <span className={cn("size-2 rounded-full bg-violet transition-transform duration-200", checked ? "scale-100" : "scale-0")} />
      </span>
      {icon ? <span className={cn("mt-px shrink-0 transition-colors", checked ? "text-violet" : "text-ink-2")}>{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description ? <span className="mt-0.5 block text-xs leading-relaxed text-ink-2">{description}</span> : null}
      </span>
      {aside ? <span className="shrink-0 text-sm text-ink tabular">{aside}</span> : null}
    </RadioGroupPrimitive.Item>
  )
}

/** A quiet bordered note for facts the shopper should not miss. */
export function Notice({ children, className, icon: Icon = Info }: { children: React.ReactNode; className?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className={cn("flex gap-2.5 rounded-lg border border-line-soft bg-surface px-3.5 py-3 text-xs leading-relaxed text-ink-2", className)}>
      <Icon className="mt-px size-3.5 shrink-0 text-violet" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
