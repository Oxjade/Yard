"use client"

import { useEffect, useState } from "react"
import { CaretLeftIcon, ListIcon, XIcon } from "@phosphor-icons/react"
import { AnimatePresence, motion } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { NotificationBell } from "@/components/feedback/notification-bell"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import { CommandPalette, usePaletteHotkeys } from "./shell/command-palette"
import { NavList } from "./shell/nav-list"
import { NavScroller } from "./shell/nav-scroller"
import { useModKey } from "./shell/platform"
import { AccountRow, StatusCard } from "./shell/status-card"
import { SearchTrigger, TopBar } from "./shell/top-bar"
import type { ShellAccount, ShellNavGroup, ShellSearch, ShellStatus, ShellWorkspace } from "./shell/types"
import { useSidebarCollapsed } from "./shell/use-sidebar"
import { WorkspaceMenu } from "./shell/workspace-menu"

export type { ShellAccount, ShellNavGroup, ShellNavItem, ShellSearch, ShellStatus, ShellWorkspace, WorkspaceMenuItem } from "./shell/types"

type Density = "comfortable" | "dense"

type PanelProps = {
  root: string
  groups: ShellNavGroup[]
  density: Density
  workspace?: ShellWorkspace
  header?: React.ReactNode
  footer?: React.ReactNode
  status?: ShellStatus
  account?: ShellAccount
}

/** Everything inside the panel; shared by the desktop rail and the phone drawer. */
function PanelBody({ variant, collapsed = false, onNavigate, headerAction, ...p }: PanelProps & { variant: "rail" | "drawer"; collapsed?: boolean; onNavigate?: () => void; headerAction?: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-2 px-[13px] pt-2.5 pb-2">
        <div className="min-w-0 flex-1">{p.workspace ? <WorkspaceMenu workspace={p.workspace} collapsed={collapsed} tooltip={variant === "rail"} onNavigate={onNavigate} /> : p.header}</div>
        {headerAction}
      </div>
      <div aria-hidden className="mx-[13px] h-px shrink-0 bg-white/[0.06]" />
      <NavScroller>
        <NavList groups={p.groups} root={p.root} density={p.density} variant={variant} collapsed={collapsed} onNavigate={onNavigate} />
      </NavScroller>
      {p.footer || p.status || p.account ? (
        <div className="grid shrink-0 gap-2 px-[13px] pt-1 pb-2.5">
          {p.footer}
          {p.status ? <StatusCard status={p.status} tooltip={variant === "rail"} collapsed={collapsed} compact={variant === "drawer"} onNavigate={onNavigate} /> : null}
          {p.account ? (
            // On short desktop windows the comfortable (Studio) panel drops the account row,
            // which there only repeats the workspace header, so every section still fits.
            <div className={cn("grid gap-2", p.density === "comfortable" && "sidebar-short:hidden")}>
              <div aria-hidden className="h-px bg-white/[0.06]" />
              <AccountRow account={p.account} />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

/** The collapse toggle: a small knob straddling the panel's edge at the header, in both states. */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const mod = useModKey()
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-keyshortcuts="Meta+B Control+B"
          className="absolute top-[19px] -right-3.5 z-10 inline-flex size-7 items-center justify-center rounded-full border border-white/10 bg-[#151515] text-ink-3 shadow-[0_2px_10px_rgba(0,0,0,0.55)] transition-colors duration-150 hover:border-white/20 hover:text-ink"
        >
          <CaretLeftIcon aria-hidden weight="bold" className="size-3 transition-[rotate] duration-(--shell-spring-duration) ease-(--shell-spring) sidebar-collapsed:rotate-180" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="gap-2">
        {collapsed ? "Expand sidebar" : "Collapse sidebar"}
        <span className="text-black/55">{mod === "⌘" ? "⌘B" : "Ctrl B"}</span>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The operating shell shared by Brand Studio and the Admin Control Center: a floating,
 * collapsible panel (an icon rail when collapsed, persisted with no layout shift), a top bar
 * with the command palette, and a phone drawer with the same panel content.
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
  workspace,
  status,
  account,
  search,
}: {
  root: string
  groups: ShellNavGroup[]
  /** Legacy header slot, used when no `workspace` is given. */
  header?: React.ReactNode
  /** Extra content above the status card. */
  footer?: React.ReactNode
  topbar?: React.ReactNode
  density?: Density
  children: React.ReactNode
  surface: "studio" | "admin"
  workspace?: ShellWorkspace
  status?: ShellStatus
  account?: ShellAccount
  search?: ShellSearch
}) {
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const { collapsed, toggle } = useSidebarCollapsed()
  usePaletteHotkeys(palette, setPalette)

  // The drawer only exists below lg. If the window widens past it while the drawer is open
  // (a tablet rotating, a window resized), close it, or its hidden dialog would keep the page inert.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 64rem)")
    const close = () => {
      if (mq.matches) setDrawer(false)
    }
    mq.addEventListener("change", close)
    return () => mq.removeEventListener("change", close)
  }, [])

  const panel: PanelProps = { root, groups, density, workspace, header, footer, status, account }
  const pad = density === "dense" ? "px-4 md:px-6" : "px-4 md:px-8"

  return (
    <div data-surface={surface} className={cn("flex min-h-dvh", surface === "admin" ? "bg-[#080808]" : "bg-obsidian", density === "dense" ? "text-[13px]" : "text-sm")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-full focus:bg-acid focus:px-4 focus:py-2 focus:text-obsidian">
        Skip to content
      </a>
      {/* Desktop: the floating panel and the gap it keeps in the layout (both animate width together). */}
      <aside aria-label="Workspace" className="fixed top-3 bottom-3 left-3 z-30 hidden w-[248px] transition-[width] duration-(--shell-spring-duration) ease-(--shell-spring) lg:block sidebar-collapsed:w-[72px]">
        {/* The panel is not positioned, so the toggle (absolute to the aside) escapes its clipping. */}
        <div className="shell-panel flex h-full flex-col overflow-hidden rounded-[24px]">
          <PanelBody variant="rail" collapsed={collapsed} headerAction={<CollapseToggle collapsed={collapsed} onToggle={toggle} />} {...panel} />
        </div>
      </aside>
      <div aria-hidden className="hidden w-[260px] shrink-0 transition-[width] duration-(--shell-spring-duration) ease-(--shell-spring) lg:block sidebar-collapsed:w-[84px]" />

      <DialogPrimitive.Root open={drawer} onOpenChange={setDrawer}>
        <AnimatePresence>
          {drawer ? (
            <DialogPrimitive.Portal forceMount>
              <DialogPrimitive.Overlay asChild forceMount>
                <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              </DialogPrimitive.Overlay>
              <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className={cn("shell-panel fixed inset-y-2 left-2 z-50 flex w-[min(296px,calc(100vw-16px))] flex-col overflow-hidden rounded-[24px] outline-none lg:hidden", density === "dense" ? "text-[13px]" : "text-sm")}
                  initial={{ x: "-108%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-108%" }}
                  transition={spring.drawer}
                >
                  <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
                  <PanelBody
                    variant="drawer"
                    onNavigate={() => setDrawer(false)}
                    headerAction={
                      <DialogPrimitive.Close className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-white/10 text-ink-2 transition-colors hover:text-ink" aria-label="Close navigation">
                        <XIcon className="size-4" />
                      </DialogPrimitive.Close>
                    }
                    {...panel}
                  />
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          ) : null}
        </AnimatePresence>

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            surface={surface}
            padding={pad}
            menu={
              <DialogPrimitive.Trigger asChild>
                <button type="button" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.025] text-ink-2 transition-colors hover:text-ink lg:hidden" aria-label="Open navigation">
                  <ListIcon className="size-[18px]" />
                </button>
              </DialogPrimitive.Trigger>
            }
            search={search ? <SearchTrigger placeholder={search.placeholder} onOpen={() => setPalette(true)} /> : null}
            actions={
              <>
                {topbar}
                <NotificationBell audience={surface === "admin" ? "admin" : "merchant"} className="size-10 border border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.06]" />
              </>
            }
          />
          <main id="main" className={cn("mx-auto w-full max-w-[1400px]", pad, density === "dense" ? "pt-4 pb-6" : "pt-5 pb-8 md:pb-10")}>
            {children}
          </main>
        </div>
      </DialogPrimitive.Root>

      {search ? <CommandPalette open={palette} onOpenChange={setPalette} groups={groups} search={search} /> : null}
    </div>
  )
}
