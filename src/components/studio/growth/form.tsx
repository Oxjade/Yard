"use client"

import { createContext, useContext, useId } from "react"
import { motion } from "motion/react"
import { CheckIcon as Check, MinusIcon as Minus, PlusIcon as Plus } from "@phosphor-icons/react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { Label } from "@/components/ui/label"
import { PageHeader } from "@/components/dashboard/page-header"
import { Bone } from "@/components/feedback/skeletons"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"

/* ---------- Panel ---------- */

/** The Studio panel: a quiet card with a small title and sub-copy. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  id,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
  id?: string
}) {
  const auto = useId()
  const titleId = `${id ?? auto}-title`
  return (
    <section id={id} aria-labelledby={titleId} className={cn("rounded-lg border border-line-soft bg-card p-4 md:p-5", className)}>
      <div className={cn("flex items-start justify-between gap-3", children ? "mb-4" : undefined)}>
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-medium text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-2">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/* ---------- Fields ---------- */

/** Accessible wiring for a control: id, aria-invalid and the message it's described by. */
export function control(id: string, error?: string, hint?: boolean) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  } as const
}

export function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: React.ReactNode }) {
  if (error) return <p id={`${id}-error`} className="text-xs text-danger">{error}</p>
  if (hint) return <p id={`${id}-hint`} className="text-xs text-ink-3">{hint}</p>
  return null
}

export function Field({
  id,
  label,
  hint,
  error,
  optional,
  aside,
  className,
  children,
  as = "label",
}: {
  id: string
  label: string
  hint?: React.ReactNode
  error?: string
  optional?: boolean
  aside?: React.ReactNode
  className?: string
  children: React.ReactNode
  /** "legend" for groups of controls (radio cards, checkbox lists) that have no single input. */
  as?: "label" | "legend"
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)} role={as === "legend" ? "group" : undefined} aria-labelledby={as === "legend" ? `${id}-label` : undefined}>
      <div className="flex min-h-4 items-baseline justify-between gap-3">
        {as === "label" ? (
          <Label htmlFor={id} className="text-[13px] text-ink">{label}</Label>
        ) : (
          <p id={`${id}-label`} className="text-[13px] font-medium text-ink">{label}</p>
        )}
        {optional ? <span className="text-xs text-ink-3">Optional</span> : aside}
      </div>
      {children}
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  )
}

/** Thumb-friendly on phones, standard on desktop. */
export const inputClass = "h-11 md:h-9"
export const selectClass = "w-full data-[size=default]:h-11 md:data-[size=default]:h-9"

/* ---------- Segmented control (radio group, purple-ringed selection that slides) ---------- */

export function Segmented<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  className,
  error,
  size = "default",
}: {
  id: string
  label: string
  value: T | null
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode; disabled?: boolean }[]
  className?: string
  error?: string
  size?: "sm" | "default"
}) {
  return (
    <RadioGroupPrimitive.Root
      id={id}
      value={value ?? ""}
      onValueChange={(v) => onChange(v as T)}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      orientation="horizontal"
      className={cn("flex w-full gap-1 rounded-md border border-line bg-surface p-0.5 sm:w-fit", error && "border-danger/60", className)}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <RadioGroupPrimitive.Item
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className={cn(
              "relative flex-1 rounded-[5px] px-3 text-xs whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-40 sm:flex-none",
              size === "sm" ? "h-8" : "h-9 md:h-8",
              on ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {on ? <motion.span layoutId={`${id}-pill`} aria-hidden className="absolute inset-0 rounded-[5px] bg-purple" transition={spring.indicator} /> : null}
            <span className="relative inline-flex items-center gap-1.5">{o.label}</span>
          </RadioGroupPrimitive.Item>
        )
      })}
    </RadioGroupPrimitive.Root>
  )
}

/* ---------- Choice cards (a radio group that looks like tiles) ---------- */

const ChoiceContext = createContext<{ value: string | null; layoutId: string }>({ value: null, layoutId: "choice" })

export function ChoiceGroup({ value, onValueChange, label, error, className, children, id }: { value: string | null; onValueChange: (v: string) => void; label: string; error?: string; className?: string; children: React.ReactNode; id: string }) {
  return (
    <ChoiceContext.Provider value={{ value, layoutId: `${id}-ring` }}>
      <RadioGroupPrimitive.Root
        id={id}
        value={value ?? ""}
        onValueChange={onValueChange}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn("grid gap-2", className)}
      >
        {children}
      </RadioGroupPrimitive.Root>
    </ChoiceContext.Provider>
  )
}

export function ChoiceCard({ value, className, children, disabled, "aria-label": ariaLabel }: { value: string; className?: string; children: React.ReactNode; disabled?: boolean; "aria-label"?: string }) {
  const ctx = useContext(ChoiceContext)
  const on = ctx.value === value
  return (
    <RadioGroupPrimitive.Item
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        "group/choice relative flex flex-col items-stretch justify-start rounded-lg border text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian disabled:cursor-not-allowed disabled:opacity-45",
        on ? "border-transparent bg-purple/10" : "border-line bg-surface/40 hover:border-ink-2/40 hover:bg-elevated/60",
        className,
      )}
    >
      {children}
      {on ? <motion.span layoutId={ctx.layoutId} aria-hidden className="pointer-events-none absolute -inset-px rounded-[inherit] border-2 border-purple" transition={spring.indicator} /> : null}
    </RadioGroupPrimitive.Item>
  )
}

/** The small check that marks a selected card. */
export function ChoiceTick({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors", on ? "border-purple bg-purple text-ink" : "border-line text-transparent")}>
      <Check className="size-3" />
    </span>
  )
}

/* ---------- Toggle chips (multi-select) ---------- */

export function ChipToggle({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-40 md:h-8",
        on ? "border-purple bg-purple text-ink" : "border-line text-ink-2 hover:border-ink-2/50 hover:text-ink",
      )}
    >
      {on ? <Check className="size-3.5" /> : null}
      {children}
    </button>
  )
}

/* ---------- Number stepper ---------- */

export function NumberStepper({
  id,
  label,
  value,
  onChange,
  min = 0,
  max = 100_000,
  step = 1,
  invalid,
  describedBy,
  suffix,
  disabled,
}: {
  id: string
  /** The field's name, so each button is announced as "Decrease quantity", not just "Decrease". */
  label: string
  value: string
  onChange: (v: string) => void
  min?: number
  max?: number
  step?: number
  invalid?: boolean
  describedBy?: string
  suffix?: string
  disabled?: boolean
}) {
  const n = Number(value)
  const set = (next: number) => onChange(String(Math.min(max, Math.max(min, next))))
  return (
    <div className={cn("flex h-11 w-full items-stretch overflow-hidden rounded-lg border border-input bg-input/30 md:h-9 md:w-44", invalid && "border-destructive/50 ring-3 ring-destructive/20", disabled && "opacity-50")}>
      <button type="button" disabled={disabled || !Number.isFinite(n) || n <= min} onClick={() => set((Number.isFinite(n) ? n : min) - step)} className="inline-flex w-11 items-center justify-center text-ink-2 hover:bg-elevated hover:text-ink disabled:opacity-40 md:w-9" aria-label={`Decrease ${label}`}>
        <Minus className="size-4" />
      </button>
      <div className="relative flex min-w-0 flex-1 items-center border-x border-input">
        <input
          id={id}
          inputMode="numeric"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-full w-full min-w-0 bg-transparent px-2 text-center text-base text-ink tabular outline-none md:text-sm"
        />
        {suffix ? <span className="pointer-events-none pr-2.5 text-xs text-ink-3">{suffix}</span> : null}
      </div>
      <button type="button" disabled={disabled || (Number.isFinite(n) && n >= max)} onClick={() => set((Number.isFinite(n) ? n : min) + step)} className="inline-flex w-11 items-center justify-center text-ink-2 hover:bg-elevated hover:text-ink disabled:opacity-40 md:w-9" aria-label={`Increase ${label}`}>
        <Plus className="size-4" />
      </button>
    </div>
  )
}

/* ---------- Loading ---------- */

/**
 * Mirrors a Studio list page (header, tiles, a DataTable) while saved data loads. With a
 * title the real header renders, so the route's loading state and the page line up exactly.
 */
export function ListSkeleton({ tiles = 4, rows = 4, title, description, tabs = 3 }: { tiles?: number; rows?: number; title?: string; description?: string; tabs?: number }) {
  return (
    <div className="grid gap-6" role="status" aria-label="Loading">
      {title ? (
        <PageHeader title={title} description={description} actions={<Bone className="h-8 w-36" />}>
          <Bone className="mt-3 h-6 w-64 max-w-full" />
        </PageHeader>
      ) : (
        <div className="border-b border-line-soft pb-5">
          <Bone className="h-7 w-40" />
          <Bone className="mt-2 h-4 w-72 max-w-full" />
        </div>
      )}
      {tiles ? (
        <div className={cn("grid grid-cols-2 gap-3", tiles === 5 ? "md:grid-cols-3 xl:grid-cols-5" : "md:grid-cols-4")}>
          {Array.from({ length: tiles }, (_, i) => (
            <div key={i} className="h-[106px] rounded-lg border border-line-soft bg-card p-4">
              <Bone className="h-3 w-20" />
              <Bone className="mt-3 h-7 w-16" />
              <Bone className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4">
        {tabs ? (
          <div className="flex gap-1 border-b border-line-soft">
            {Array.from({ length: tabs }, (_, i) => (
              <div key={i} className="flex h-10 items-center px-3">
                <Bone className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        ) : null}
        <div className="overflow-hidden rounded-lg border border-line-soft bg-card">
          <div className="flex gap-4 border-b border-line-soft bg-[#111111] px-4 py-3">
            {[0, 1, 2, 3].map((i) => (
              <Bone key={i} className={cn("h-3 flex-1", i > 1 && "hidden md:block")} />
            ))}
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex h-[68px] items-center gap-3 border-b border-line-soft px-4 last:border-0">
              <Bone className="size-11 shrink-0" />
              <Bone className="h-3.5 max-w-48 flex-1" />
              <Bone className="ml-auto hidden h-5 w-20 md:block" />
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line-soft px-4 py-3">
            <Bone className="h-3 w-20" />
            <Bone className="h-6 w-28" />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Mirrors an editor page (back link, header, form column, preview column). */
export function EditorSkeleton({ aside = true }: { aside?: boolean }) {
  return (
    <div className="grid gap-6" role="status" aria-label="Loading">
      <div className="grid gap-2">
        <Bone className="h-3 w-16" />
        <div className="flex flex-col gap-4 border-b border-line-soft pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Bone className="h-7 w-48" />
            <Bone className="mt-2 h-4 w-80 max-w-full" />
          </div>
          <Bone className="h-8 w-56" />
        </div>
      </div>
      <div className={cn("grid gap-6", aside && "xl:grid-cols-[minmax(0,1fr)_380px]")}>
        <div className="grid gap-6">
          <div className="h-48 rounded-lg border border-line-soft bg-card p-4 md:p-5">
            <Bone className="h-4 w-24" />
            <Bone className="mt-2 h-3 w-64 max-w-full" />
            <Bone className="mt-5 h-10 w-full" />
            <Bone className="mt-4 h-16 w-full" />
          </div>
          <div className="h-64 rounded-lg border border-line-soft bg-card p-4 md:p-5">
            <Bone className="h-4 w-28" />
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Bone key={i} className="h-14" />
              ))}
            </div>
          </div>
        </div>
        {aside ? <Bone className="hidden h-[460px] rounded-lg xl:block" /> : null}
      </div>
    </div>
  )
}

/** Mirrors the campaign wizard: step list on the left, the step panel on the right. */
export function WizardSkeleton() {
  return (
    <div className="grid gap-6" role="status" aria-label="Loading">
      <div className="grid gap-2">
        <Bone className="h-3 w-20" />
        <div className="border-b border-line-soft pb-5">
          <Bone className="h-7 w-52" />
          <Bone className="mt-2 h-4 w-96 max-w-full" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="hidden gap-1 lg:grid lg:content-start">
          {Array.from({ length: 10 }, (_, i) => (
            <Bone key={i} className="h-10" />
          ))}
        </div>
        <div className="grid content-start gap-6">
          <Bone className="h-10 lg:hidden" />
          <div className="rounded-lg border border-line-soft bg-card p-4 md:p-5">
            <Bone className="h-4 w-36" />
            <Bone className="mt-2 h-3 w-72 max-w-full" />
            <div className="mt-5 grid gap-2 md:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Bone key={i} className="h-28" />
              ))}
            </div>
          </div>
          <Bone className="h-12" />
        </div>
      </div>
    </div>
  )
}
