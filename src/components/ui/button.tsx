import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"
import { CheckIcon as Check, CircleNotchIcon as Loader2 } from "@phosphor-icons/react/ssr"

/**
 * Buttons. Colour budget: `primary` (acid) is the one high-impact action on a view;
 * `secondary` (outline) is everything else. Purple is for selected states, not buttons,
 * so the `brand` variant is used sparingly (e.g. Follow).
 *
 * Feedback: colours ease in 150ms; a press compresses in ~120ms; `loading` swaps the
 * label for a compact spinner without changing the button's width; `success` shows a
 * check for confirmation. Pair with `useAsyncAction` so these states reflect the real
 * operation — never a timer.
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-medium whitespace-nowrap select-none transition-[background-color,border-color,color,transform,box-shadow,opacity] duration-150 ease-out-quint outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian active:not-aria-[haspopup]:scale-[0.97] active:duration-100 disabled:pointer-events-none disabled:opacity-40 aria-busy:cursor-progress aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-acid text-obsidian hover:bg-acid/85",
        secondary: "border-line bg-transparent text-ink hover:border-ink-2/50 hover:bg-elevated",
        brand: "bg-purple text-ink hover:bg-purple/85",
        ghost: "text-ink-2 hover:bg-elevated hover:text-ink",
        glass: "glass text-ink hover:bg-[var(--glass-bg-strong)]",
        destructive: "border-danger/40 bg-danger/12 text-danger hover:border-danger/70 hover:bg-danger/20",
        "destructive-solid": "bg-danger text-obsidian hover:bg-danger/85",
        link: "h-auto px-0 text-violet underline-offset-4 hover:underline",
        // shadcn aliases so generated components keep working
        default: "bg-acid text-obsidian hover:bg-acid/85",
        outline: "border-line bg-transparent text-ink hover:bg-elevated",
      },
      size: {
        xs: "h-7 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 px-3 text-[0.8125rem]",
        default: "h-10 px-4 text-sm",
        lg: "h-12 px-5 text-[0.9375rem]",
        xl: "h-14 px-7 text-base",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "secondary",
  size = "default",
  asChild = false,
  loading = false,
  success = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** The operation is running: shows a spinner, keeps the width, blocks repeat clicks. */
    loading?: boolean
    /** The operation just succeeded: shows a check in place of the label. */
    success?: boolean
  }) {
  if (asChild) {
    return (
      <Slot.Root data-slot="button" data-variant={variant} data-size={size} className={cn(buttonVariants({ variant, size, className }))} {...props}>
        {children}
      </Slot.Root>
    )
  }

  const overlay = loading || success
  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-state={loading ? "loading" : success ? "success" : undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {/* The label stays in the layout (invisible) so the width never jumps. */}
      {overlay ? <span className="inline-flex items-center justify-center gap-2 opacity-0">{children}</span> : children}
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <Loader2 className="size-4 animate-spin" />
        </span>
      ) : success ? (
        <span className="absolute inset-0 flex animate-in items-center justify-center duration-150 zoom-in-75 fade-in-0" aria-hidden>
          <Check className="size-4" />
        </span>
      ) : null}
      {loading ? <span className="sr-only">Working</span> : success ? <span className="sr-only">Done</span> : null}
    </button>
  )
}

export { Button, buttonVariants }
