"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowSquareOutIcon, CaretUpDownIcon } from "@phosphor-icons/react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ShellWorkspace } from "./types"
import { useRailTip } from "./use-rail-tip"

/**
 * The workspace header: mark, name and one muted line, as a button that opens a menu of real
 * destinations. On the collapsed rail only the mark shows (the text is clipped and faded) and
 * the button gets a tooltip naming the workspace.
 */
export function WorkspaceMenu({ workspace, collapsed = false, tooltip = false, onNavigate }: { workspace: ShellWorkspace; collapsed?: boolean; tooltip?: boolean; onNavigate?: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [tipOpen, onTip] = useRailTip(collapsed)

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className="group/ws flex h-11 w-full min-w-0 items-center gap-3 rounded-xl pr-2 pl-1.5 text-left transition-colors duration-150 hover:bg-white/[0.04] data-[state=open]:bg-white/[0.05]"
      >
        <span className="inline-flex shrink-0">{workspace.mark}</span>
        <span className="min-w-0 flex-1 transition-opacity duration-150 sidebar-collapsed:opacity-0">
          <span className="block truncate text-sm leading-tight font-medium text-ink">{workspace.name}</span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-ink-3">{workspace.caption}</span>
        </span>
        <CaretUpDownIcon aria-hidden className="size-4 shrink-0 text-ink-3 transition-[opacity,color] duration-150 group-hover/ws:text-ink-2 sidebar-collapsed:opacity-0" />
      </button>
    </DropdownMenuTrigger>
  )

  return (
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      {tooltip ? (
        <Tooltip open={tipOpen && !menuOpen} onOpenChange={onTip} disableHoverableContent>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={22}>
            {workspace.label}
          </TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      {/* Opaque (nothing ghosts through it). Expanded: it drops under the header at the header's
          width. Collapsed: it opens beside the rail, 8px clear of the collapse knob that
          straddles the panel edge, and names the workspace, since the rail shows only the mark. */}
      <DropdownMenuContent
        side={collapsed ? "right" : "bottom"}
        align="start"
        sideOffset={collapsed ? 36 : 8}
        className={cn("rounded-2xl bg-[#111111] p-1.5 backdrop-blur-none", collapsed ? "w-60" : "w-(--radix-dropdown-menu-trigger-width)")}
      >
        {collapsed ? (
          <>
            <DropdownMenuLabel className="px-2 pt-1.5 pb-2">
              <span className="block truncate text-[13px] font-medium text-ink">{workspace.name}</span>
              <span className="mt-1 flex items-center gap-1.5 text-[11px] font-normal text-ink-3">{workspace.caption}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/[0.07]" />
          </>
        ) : null}
        {workspace.menu.map((m) => {
          const Icon = m.icon
          return (
            <div key={m.label}>
              {m.separated ? <DropdownMenuSeparator className="bg-white/[0.07]" /> : null}
              <DropdownMenuItem asChild className="gap-2.5 rounded-lg px-2 text-[13px] text-ink-2 focus:text-ink">
                <Link href={m.href} target={m.external ? "_blank" : undefined} rel={m.external ? "noopener" : undefined} onClick={onNavigate}>
                  <Icon className="size-[18px] text-ink-3" />
                  <span className="flex-1">{m.label}</span>
                  {m.external ? (
                    <>
                      <ArrowSquareOutIcon aria-hidden className="size-3.5 text-ink-3" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </>
                  ) : null}
                </Link>
              </DropdownMenuItem>
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
