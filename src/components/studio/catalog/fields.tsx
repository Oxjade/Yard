"use client"

import { useCallback, useId, useLayoutEffect, useRef } from "react"
import { motion } from "motion/react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/* ---------- Panel and field ---------- */

/** The Studio panel: a quiet card with a small title. */
export function Panel({ title, description, action, children, className, id }: { title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  const auto = useId()
  const titleId = `${id ?? auto}-title`
  const hasBody = children !== null && children !== undefined && children !== false
  return (
    <section id={id} aria-labelledby={titleId} className={cn("scroll-mt-20 rounded-lg border border-line-soft bg-card p-4 md:p-5", className)}>
      <div className={cn("flex items-start justify-between gap-3", hasBody && "mb-4")}>
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
}: {
  id: string
  label: string
  hint?: React.ReactNode
  error?: string
  optional?: boolean
  aside?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)}>
      <div className="flex min-h-4 items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-[13px] text-ink">{label}</Label>
        {optional && aside ? (
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-ink-3">Optional</span>
            {aside}
          </span>
        ) : optional ? (
          <span className="text-xs text-ink-3">Optional</span>
        ) : (
          aside
        )}
      </div>
      {children}
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  )
}

/** Thumb-friendly on phones, standard on desktop. */
export const inputClass = "h-11 md:h-9"
export const selectClass = "w-full data-[size=default]:h-11 md:data-[size=default]:h-9"

/* ---------- Segmented control ---------- */

export function Segmented<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  className,
  error,
  labelledBy,
}: {
  id: string
  label: string
  value: T | null
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode }[]
  className?: string
  error?: string
  /** id of a visible label: a radio group can't be the target of <label htmlFor>. */
  labelledBy?: string
}) {
  return (
    <RadioGroupPrimitive.Root
      id={id}
      value={value ?? ""}
      onValueChange={(v) => onChange(v as T)}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      orientation="horizontal"
      className={cn("flex w-full gap-1 rounded-lg border border-line bg-surface/50 p-1", error && "border-danger/60", className)}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <RadioGroupPrimitive.Item
            key={o.value}
            value={o.value}
            className={cn("relative h-9 flex-1 rounded-md px-3 text-[13px] whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet md:h-8", on ? "text-ink" : "text-ink-2 hover:text-ink")}
          >
            {on ? <motion.span layoutId={`${id}-pill`} aria-hidden className="absolute inset-0 rounded-md bg-purple" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
            <span className="relative inline-flex items-center gap-1.5">{o.label}</span>
          </RadioGroupPrimitive.Item>
        )
      })}
    </RadioGroupPrimitive.Root>
  )
}

/* ---------- Returning focus ---------- */

/** What can take focus back: still on the page, enabled, visible, and not inside something closing. */
function canTakeFocus(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected || (el as HTMLButtonElement).disabled) return false
  if (el.closest('[data-leaving], [role="menu"], [role="dialog"][data-state="closed"]')) return false
  return el.getClientRects().length > 0
}

/** The control that opened an overlay. An item in a closing menu stands for that menu's trigger. */
function openerOf(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement) || el === document.body) return null
  const menu = el.closest('[role="menu"]')
  const trigger = menu?.getAttribute("aria-labelledby")
  return (trigger ? document.getElementById(trigger) : null) ?? el
}

/**
 * Radix returns focus only to a DialogTrigger, so a dialog or sheet opened from code would
 * drop focus on <body> when it closes. This remembers what had focus as `open` turns true
 * (a layout effect, before the dialog moves focus inside) and hands back an
 * `onCloseAutoFocus` that returns there, or to `fallback` when that control has gone, is
 * disabled, or sits inside something that is closing (a confirmed row that left the list).
 */
export function useReturnFocus(open: boolean, fallback?: () => HTMLElement | null | undefined) {
  const opener = useRef<HTMLElement | null>(null)
  const fallbackRef = useRef(fallback)
  useLayoutEffect(() => {
    fallbackRef.current = fallback
  })
  useLayoutEffect(() => {
    if (open) opener.current = openerOf(document.activeElement)
  }, [open])
  return useCallback((e: Event) => {
    e.preventDefault()
    const from = opener.current
    opener.current = null
    const target = canTakeFocus(from) ? from : fallbackRef.current?.()
    if (canTakeFocus(target)) target.focus()
  }, [])
}

/** The selected tab of a StatusTabs list, by the region it controls: a steady place to land. */
export const selectedTabFor = (controls: string) => () => document.querySelector<HTMLElement>(`[role="tab"][aria-selected="true"][aria-controls="${controls}"]`)

/* ---------- Confirm dialog ---------- */

/** Every destructive or bulk action asks first, naming exactly what will happen. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  tone = "destructive",
  returnFocus,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  tone?: "destructive" | "primary" | "secondary"
  /** Where focus goes on close when the control that opened the dialog is gone or disabled. */
  returnFocus?: () => HTMLElement | null | undefined
  children?: React.ReactNode
}) {
  const onCloseAutoFocus = useReturnFocus(open, returnFocus)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-ink-2">{body}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={tone}
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
