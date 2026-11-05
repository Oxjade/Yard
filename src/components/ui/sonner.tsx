"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CheckCircleIcon as CircleCheckIcon, InfoIcon, WarningIcon as TriangleAlertIcon, XCircleIcon as OctagonXIcon, CircleNotchIcon as Loader2Icon } from "@phosphor-icons/react"

/**
 * Toasts pop up like comic speech bubbles from the bottom corner (above the phone tab bar):
 * a quick spring pop, a tail, a hard purple offset shadow. `comic` (marketplace) is a white
 * bubble with black type; `calm` (Studio, Admin) is a dark bubble — same shape, quieter.
 * Concise, stackable (3 visible), dismissible, with actions where useful. Not for every
 * click: inline feedback is preferred when the change is visible in place.
 */
const Toaster = ({ tone = "comic", ...props }: ToasterProps & { tone?: "comic" | "calm" }) => {
  const comic = tone === "comic"
  return (
    <Sonner
      theme={comic ? "light" : "dark"}
      position="bottom-right"
      offset={{ bottom: 24, right: 24 }}
      mobileOffset={comic ? { bottom: 88, left: 12, right: 12 } : { bottom: 16, left: 12, right: 12 }}
      visibleToasts={3}
      gap={14}
      closeButton
      duration={4000}
      className={`toaster group pop-toaster pop-${tone}`}
      icons={{
        success: <CircleCheckIcon className={comic ? "size-4 text-purple" : "size-4 text-violet"} />,
        info: <InfoIcon className={comic ? "size-4 text-[#555]" : "size-4 text-ink-2"} />,
        warning: <TriangleAlertIcon className={comic ? "size-4 text-obsidian" : "size-4 text-acid"} />,
        error: <OctagonXIcon className="size-4 text-danger" />,
        loading: <Loader2Icon className={comic ? "size-4 animate-spin text-[#555]" : "size-4 animate-spin text-ink-2"} />,
      }}
      toastOptions={{
        classNames: {
          toast: "pop-toast font-sans",
          title: "text-[13.5px] font-semibold",
          description: "pop-desc text-[12.5px]",
          actionButton: comic ? "!bg-obsidian !text-ink !rounded-md !text-xs !font-semibold" : "!bg-ink !text-obsidian !rounded-md !text-xs !font-semibold",
          cancelButton: "!bg-transparent",
          closeButton: "pop-close",
          error: "pop-error",
          warning: "pop-warning",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
