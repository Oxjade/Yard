"use client"

import * as React from "react"
import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { cn } from "cn"

const inputClass =
  "h-10 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base transition-[border-color,box-shadow,background-color] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] outline-none hover:border-ink-2/40 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"

/** A password field with a show/hide (eye) button, so people can check what they typed. */
function PasswordInput({ className, disabled, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  const [shown, setShown] = React.useState(false)
  return (
    <div className="relative w-full min-w-0">
      <input type={shown ? "text" : "password"} data-slot="input" disabled={disabled} className={cn(inputClass, "pr-11", className)} {...props} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-ink-3 transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none disabled:pointer-events-none [&_svg]:size-[18px]"
      >
        {shown ? <EyeSlashIcon aria-hidden /> : <EyeIcon aria-hidden />}
      </button>
    </div>
  )
}

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  if (type === "password") return <PasswordInput className={className} {...props} />
  return <input type={type} data-slot="input" className={cn(inputClass, className)} {...props} />
}

export { Input }
