"use client"

import { CheckIcon as Check } from "@phosphor-icons/react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

export const checkoutSteps = [
  { id: "contact", label: "Contact", title: "Contact", description: "Who we send the receipt to, and who the couriers call." },
  { id: "address", label: "Delivery", title: "Delivery address", description: "Where every brand in this checkout ships to." },
  { id: "shipping", label: "Shipping", title: "Shipping", description: "Each brand ships its own parcel, so choose a speed for each one." },
  { id: "payment", label: "Payment", title: "Payment", description: "One payment covers every brand in this checkout." },
  { id: "review", label: "Review", title: "Review", description: "Check the details, then place your order." },
] as const

/** A real sequence, so it is numbered. The active segment slides between steps. */
export function StepIndicator({ current, canJump, onJump }: { current: number; canJump: (step: number) => boolean; onJump: (step: number) => void }) {
  return (
    <nav aria-label="Checkout progress">
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {checkoutSteps.map((s, i) => {
          const done = i < current
          const active = i === current
          const jumpable = !active && canJump(i)
          const body = (
            <>
              <span className="relative block h-0.5 overflow-hidden rounded-full bg-line">
                {done ? <span className="absolute inset-0 bg-violet/55" /> : null}
                {active ? <motion.span layoutId="checkout-step-bar" className="absolute inset-0 bg-purple" transition={{ type: "spring", stiffness: 380, damping: 36 }} /> : null}
              </span>
              <span className="mt-2.5 flex min-w-0 items-center gap-1.5 text-xs">
                <span
                  aria-hidden
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular transition-colors",
                    active ? "border-purple bg-purple text-ink" : done ? "border-violet/50 text-violet" : "border-line text-ink-3",
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={2.5} /> : i + 1}
                </span>
                <span className={cn("sr-only sm:not-sr-only sm:truncate", active ? "text-ink" : done ? "text-ink-2" : "text-ink-3")}>
                  <span className="sr-only">Step {i + 1}, </span>
                  {s.label}
                  {done ? <span className="sr-only">, done</span> : null}
                </span>
              </span>
            </>
          )
          return (
            <li key={s.id} aria-current={active ? "step" : undefined} className="min-w-0">
              {jumpable ? (
                <button type="button" onClick={() => onJump(i)} className="group block w-full rounded-sm text-left">
                  {body}
                </button>
              ) : (
                <div>{body}</div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
