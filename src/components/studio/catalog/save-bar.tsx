"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { CircleNotchIcon as Loader2 } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "./fields"

/**
 * Shopify-style save bar: floats at the bottom of the work area whenever the form has
 * unsaved changes. Glass, because it floats over content.
 */
export function SaveBar({ visible, label, onSave, onDiscard, saving, busyLabel }: { visible: boolean; label: string; onSave: () => void; onDiscard: () => void; saving?: boolean; busyLabel?: string }) {
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="save-bar"
          initial={{ y: 96, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 96, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:left-60"
        >
          <div role="region" aria-label="Unsaved changes" className="glass-strong glass-sheen pointer-events-auto mx-auto flex max-w-3xl items-center gap-3 rounded-2xl py-2.5 pr-2.5 pl-4">
            <span className="size-2 shrink-0 rounded-full bg-acid" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm text-ink">{label}</p>
            <Button type="button" variant="secondary" size="sm" onClick={onDiscard} disabled={saving}>Discard</Button>
            <Button type="button" variant="primary" size="sm" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {saving && busyLabel ? busyLabel : "Save"}
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * While `dirty`, asks before the page is left: the browser's own prompt on reload or close,
 * and a dialog for in-app links (sidebar, breadcrumbs). Returns the dialog to render and a
 * `leave(href)` for buttons that navigate.
 */
export function useLeaveGuard(dirty: boolean, { title = "Leave without saving?", body = "Your unsaved changes will be lost.", onLeave }: { title?: string; body?: string; onLeave?: () => void } = {}) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const bypass = useRef(false)

  // Next keeps visited pages alive while hidden; ask again whenever this page is shown.
  useEffect(() => {
    bypass.current = false
  }, [])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypass.current) return
      e.preventDefault()
      e.returnValue = ""
    }
    const onClick = (e: MouseEvent) => {
      if (bypass.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      e.preventDefault()
      e.stopPropagation()
      setPending(url.pathname + url.search + url.hash)
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClick, true)
    }
  }, [dirty])

  function go(href: string) {
    bypass.current = true
    setPending(null)
    onLeave?.()
    router.push(href)
  }

  return {
    /** Navigate, asking first when there are unsaved changes. */
    leave: (href: string) => (dirty ? setPending(href) : go(href)),
    /** Navigate without asking (after a save or delete). */
    go,
    dialog: (
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={title}
        body={body}
        confirmLabel="Leave without saving"
        onConfirm={() => pending && go(pending)}
      />
    ),
  }
}
