"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { errorMessage } from "@/lib/api/errors"
import { DemoAccountPicker, signOutDemo } from "./demo-account-picker"

/**
 * The workspace menu takes only links (dashboard/shell/types.ts), so its two account actions are
 * links to these hashes. This bridge, mounted once per shell, catches their clicks (keyboard
 * selection fires a click too) before navigation: it prevents the default, which Next's Link
 * respects, and opens the picker or signs out instead. Radix skips its own close when the click
 * was default-prevented, so the bridge closes the menu itself with an Escape on the menu (the
 * way the menu's own Escape closes it, focus returning to the trigger). Once WorkspaceMenuItem
 * takes `onSelect`, this bridge can go.
 */
export const SWITCH_ACCOUNT_HREF = "#switch-demo-account"
export const SIGN_OUT_HREF = "#sign-out-demo-account"

export function DemoAccountMenuBridge({ surface }: { surface: "studio" | "admin" }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const closeMenu = (link: Element) => {
      const menu = link.closest('[role="menu"]')
      if (menu) window.setTimeout(() => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })), 0)
    }
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]")
      const href = link?.getAttribute("href") ?? ""
      if (!link || (href !== SWITCH_ACCOUNT_HREF && href !== SIGN_OUT_HREF)) return
      e.preventDefault()
      closeMenu(link)
      if (href === SWITCH_ACCOUNT_HREF) {
        // Let the menu close and hand focus back first, then open the dialog.
        window.setTimeout(() => setOpen(true), 0)
      } else {
        signOutDemo(surface)
          .then(() => toast("Signed out of the demo account", { description: surface === "studio" ? "Pages that need Brand Studio data ask you to sign in again." : "Pages that need an admin session ask you to sign in again." }))
          .catch((err) => toast.error(errorMessage(err, "Couldn't sign out. Try again.")))
      }
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [surface])

  return <DemoAccountPicker surface={surface} open={open} onOpenChange={setOpen} />
}
