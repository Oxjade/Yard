"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bell, Menu, Search, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

export type ShellNavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string | number }
export type ShellNavGroup = { label?: string; items: ShellNavItem[] }

function active(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`)
}

function NavList({ groups, root, density, onNavigate }: { groups: ShellNavGroup[]; root: string; density: "comfortable" | "dense"; onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <nav aria-label="Sections" className="flex flex-col gap-5">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.label ? <p className="mb-1.5 px-3 text-[11px] text-ink-3">{g.label}</p> : null}
          <ul className="grid gap-0.5">
            {g.items.map((item) => {
              const on = active(pathname, item.href, root)
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "relative isolate flex items-center gap-3 rounded-md px-3 transition-colors",
                      density === "dense" ? "h-8 text-[13px]" : "h-9 text-sm",
                      on ? "text-ink" : "text-ink-2 hover:bg-white/4 hover:text-ink",
                    )}
                  >
                    {on ? <motion.span layoutId={`${root}-nav-active`} className="absolute inset-0 -z-10 rounded-md bg-purple" /> : null}
                    <Icon className={cn("size-4 shrink-0", on ? "text-ink" : "text-ink-3")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge !== undefined ? <span className="rounded-[4px] bg-acid px-1.5 text-[10px] font-semibold leading-4 text-obsidian tabular">{item.badge}</span> : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

/**
 * The operating shell shared by Brand Studio and the Admin Control Center: a solid sidebar
 * (no glass — these are work surfaces), a slim top bar, and a phone drawer.
 */
export function AppShell({
  root,
  groups,
  header,
  footer,
  topbar,
  density = "comfortable",
  children,
  surface,
}: {
  root: string
  groups: ShellNavGroup[]
  header: React.ReactNode
  footer?: React.ReactNode
  topbar?: React.ReactNode
  density?: "comfortable" | "dense"
  children: React.ReactNode
  surface: "studio" | "admin"
}) {
  const [open, setOpen] = useState(false)
  return (
    <div data-surface={surface} className={cn("min-h-dvh bg-obsidian", density === "dense" ? "text-[13px]" : "text-sm")}>
      <aside className={cn("fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-sidebar-border bg-sidebar lg:flex", density === "dense" ? "w-56" : "w-60")}>
        <div className="border-b border-sidebar-border p-3">{header}</div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavList groups={groups} root={root} density={density} />
        </div>
        {footer ? <div className="border-t border-sidebar-border p-3">{footer}</div> : null}
      </aside>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open ? (
            <DialogPrimitive.Portal forceMount>
              <DialogPrimitive.Overlay asChild forceMount>
                <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
                <motion.div className="glass-strong fixed inset-y-2 left-2 z-50 flex w-72 flex-col overflow-hidden rounded-2xl lg:hidden" initial={{ x: "-105%" }} animate={{ x: 0 }} exit={{ x: "-105%" }} transition={{ type: "spring", stiffness: 380, damping: 36 }}>
                  <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
                  <div className="flex items-center justify-between border-b border-white/8 p-3">
                    <div className="min-w-0 flex-1">{header}</div>
                    <DialogPrimitive.Close className="ml-2 inline-flex size-8 items-center justify-center rounded-md text-ink-2 hover:bg-white/6" aria-label="Close navigation">
                      <X className="size-4" />
                    </DialogPrimitive.Close>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3">
                    <NavList groups={groups} root={root} density={density} onNavigate={() => setOpen(false)} />
                  </div>
                  {footer ? <div className="border-t border-white/8 p-3">{footer}</div> : null}
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          ) : null}
        </AnimatePresence>
      </DialogPrimitive.Root>

      <div className={cn(density === "dense" ? "lg:pl-56" : "lg:pl-60")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line-soft bg-obsidian/85 px-4 backdrop-blur-xl md:px-6">
          <button type="button" onClick={() => setOpen(true)} className="inline-flex size-9 items-center justify-center rounded-md border border-line text-ink-2 lg:hidden" aria-label="Open navigation">
            <Menu className="size-4" />
          </button>
          <label className="relative hidden max-w-sm flex-1 md:block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
            <input type="search" placeholder="Search orders, products, customers" className="h-9 w-full rounded-md border border-line bg-surface pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-violet" />
          </label>
          <div className="ml-auto flex items-center gap-2">
            {topbar}
            <button type="button" className="relative inline-flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-white/5 hover:text-ink" aria-label="Notifications">
              <Bell className="size-4" />
              <span className="absolute top-2 right-2 size-1.5 rounded-full bg-acid" aria-hidden />
            </button>
          </div>
        </header>
        <main id="main" className={cn("mx-auto w-full max-w-[1400px]", density === "dense" ? "px-4 py-5 md:px-5" : "px-4 py-6 md:px-8 md:py-8")}>{children}</main>
      </div>
    </div>
  )
}
