import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

/**
 * Buttons. Colour budget: `primary` (acid) is the one high-impact action on a view;
 * `secondary` (outline) is everything else. Purple is for selected states, not buttons,
 * so the `brand` variant is used sparingly (e.g. Follow).
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-medium whitespace-nowrap select-none transition-[background-color,border-color,color,transform,box-shadow] duration-200 ease-out-quint outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian active:not-aria-[haspopup]:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-danger [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-acid text-obsidian hover:bg-acid/85",
        secondary: "border-line bg-transparent text-ink hover:border-ink-2/50 hover:bg-elevated",
        brand: "bg-purple text-ink hover:bg-purple/85",
        ghost: "text-ink-2 hover:bg-elevated hover:text-ink",
        glass: "glass text-ink hover:bg-[var(--glass-bg-strong)]",
        destructive: "bg-danger/12 text-danger hover:bg-danger/20 border-danger/25",
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
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
