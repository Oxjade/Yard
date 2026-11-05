"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Toasts: concise confirmation of something that happened elsewhere on screen, or failed.
 * Not for every click — inline feedback is preferred when the change is visible in place.
 * Top-centre, below the floating header; at most three visible, the rest stack; hover to
 * expand; each can be dismissed; actions where useful ("View bag", "Undo").
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      position="top-center"
      offset={84}
      mobileOffset={76}
      visibleToasts={3}
      gap={8}
      closeButton
      duration={4000}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-violet" />,
        info: <InfoIcon className="size-4 text-ink-2" />,
        warning: <TriangleAlertIcon className="size-4 text-acid" />,
        error: <OctagonXIcon className="size-4 text-danger" />,
        loading: <Loader2Icon className="size-4 animate-spin text-ink-2" />,
      }}
      style={
        {
          "--normal-bg": "rgba(22, 22, 22, 0.94)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "rgba(255, 255, 255, 0.1)",
          "--border-radius": "12px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast backdrop-blur-xl font-sans shadow-[0_18px_40px_-20px_rgba(0,0,0,0.9)]",
          title: "text-[13px] font-medium text-ink",
          description: "text-[12.5px] text-ink-2",
          actionButton: "!bg-ink !text-obsidian !rounded-md !text-xs !font-medium",
          cancelButton: "!bg-transparent !text-ink-2",
          closeButton: "!bg-[#1b1b1b] !border-white/10 !text-ink-2 hover:!text-ink",
          error: "!border-danger/30",
          warning: "!border-acid/30",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
