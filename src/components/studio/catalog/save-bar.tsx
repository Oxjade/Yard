"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion, useIsPresent } from "motion/react"
import { Button } from "@/components/ui/button"
import { spring } from "@/lib/motion"
import { ConfirmDialog } from "./fields"

/**
 * Shopify-style save bar: floats at the bottom of the work area whenever the form has
 * unsaved changes. Glass, because it floats over content. It sits beside the Studio sidebar
 * from lg (260px, or 84px collapsed: dashboard/app-shell.tsx) and spans the screen below.
 */
export function SaveBar({
  visible,
  label,
  onSave,
  onDiscard,
  saving,
  blocked,
  saveLabel = "Save",
}: {
  visible: boolean
  label: string
  onSave: () => void
  onDiscard: () => void
  /** The save is running: Save shows its spinner and both buttons wait. */
  saving?: boolean
  /** Save can't run yet (photos still being prepared); the label says why. */
  blocked?: boolean
  saveLabel?: string
}) {
  return (
    <AnimatePresence>
      {visible ? <SaveBarPanel key="save-bar" label={label} onSave={onSave} onDiscard={onDiscard} saving={saving} blocked={blocked} saveLabel={saveLabel} /> : null}
    </AnimatePresence>
  )
}

function SaveBarPanel({ label, onSave, onDiscard, saving, blocked, saveLabel }: { label: string; onSave: () => void; onDiscard: () => void; saving?: boolean; blocked?: boolean; saveLabel: string }) {
  // Marked while it slides away, so a dialog opened from it (Discard) returns focus elsewhere.
  const present = useIsPresent()
  return (
    <motion.div
      data-leaving={present ? undefined : ""}
      initial={{ y: 96, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 96, opacity: 0 }}
      transition={spring.drawer}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:left-[260px] sidebar-collapsed:left-[84px]"
    >
      <div role="region" aria-label="Unsaved changes" className="glass-strong glass-sheen pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-2xl py-2 pr-2 pl-4 sm:gap-3">
        <span className="size-2 shrink-0 rounded-full bg-acid" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm text-ink" aria-live="polite">{label}</p>
        <Button type="button" variant="secondary" size="sm" className="h-10 sm:h-8" onClick={onDiscard} disabled={saving}>Discard</Button>
        <Button type="button" variant="primary" size="sm" className="h-10 sm:h-8" onClick={onSave} loading={saving} disabled={blocked}>
          {saveLabel}
        </Button>
      </div>
    </motion.div>
  )
}

/**
 * While `dirty`, asks before the page is left: the browser's own prompt on reload or close,
 * and a dialog for in-app links (sidebar, breadcrumbs). Returns the dialog to render and a
 * `leave(href)` for buttons that navigate.
 *
 * Browser Back and Forward are not intercepted. Guarding them means pushing a history entry
 * of our own, which fights the App Router's history state. Nothing is lost when they're
 * used: Next keeps the page alive while hidden, so Forward, or opening the product again in
 * this session, brings the unsaved edits and the save bar back.
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
