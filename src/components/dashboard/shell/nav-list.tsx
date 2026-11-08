"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LayoutGroup, motion } from "motion/react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { followInPlace } from "@/hooks/use-search-param"
import { spring } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { ShellNavGroup, ShellNavItem } from "./types"
import { useRailTip } from "./use-rail-tip"

export function isActive(pathname: string, href: string, root: string) {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`)
}

type Density = "comfortable" | "dense"

/**
 * The section list. Groups are separated by hairlines; a group's label sits on its hairline
 * and fades out on the collapsed rail, so items never move vertically when the panel
 * collapses. The active item is a raised pill with a purple edge indicator; both glide
 * between items on a shared layoutId.
 */
export function NavList({
  groups,
  root,
  density,
  variant,
  collapsed = false,
  onNavigate,
}: {
  groups: ShellNavGroup[]
  root: string
  density: Density
  /** "rail": the desktop panel (collapsible). "drawer": the phone drawer (always expanded). */
  variant: "rail" | "drawer"
  collapsed?: boolean
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const ns = `${root}-${variant}`
  return (
    // A column that fills the scroller, so on the shortest windows the group rows can share out
    // whatever height is left (between 16px and 24px each) instead of sitting at their minimum.
    <nav aria-label="Sections" className="flex flex-1 flex-col">
      <LayoutGroup id={ns}>
        {groups.map((g, gi) => {
          const labelId = g.label ? `${ns}-group-${gi}` : undefined
          return (
            <div key={gi} className="contents">
              {gi > 0 ? (
                // The label sits just above its own group (not midway between groups), on a
                // hairline that runs to the column's edge, the same length as the header's.
                <div className={cn("relative flex h-7 shrink-0 items-end gap-2.5 pr-0 pb-1.5 sidebar-short:h-6 sidebar-shorter:h-4 sidebar-shorter:max-h-6 sidebar-shorter:grow sidebar-shorter:pb-0.5 sidebar-collapsed:px-0", g.label ? "pl-3" : "pl-0")} aria-hidden={g.label ? undefined : true}>
                  {g.label ? (
                    <span id={labelId} className="shrink-0 text-[11px] leading-none text-ink-3 transition-opacity duration-150 sidebar-collapsed:absolute sidebar-collapsed:opacity-0">
                      {g.label}
                    </span>
                  ) : null}
                  <span aria-hidden className="mb-[5px] h-px flex-1 bg-white/[0.06]" />
                </div>
              ) : null}
              <ul aria-labelledby={labelId} className="grid shrink-0 grid-cols-1 gap-px">
                {g.items.map((item) => (
                  <li key={item.href}>
                    <NavItem item={item} active={isActive(pathname, item.href, root)} ns={ns} density={density} tooltip={variant === "rail"} collapsed={collapsed} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </LayoutGroup>
    </nav>
  )
}

function NavItem({
  item,
  active,
  ns,
  density,
  tooltip,
  collapsed,
  onNavigate,
}: {
  item: ShellNavItem
  active: boolean
  ns: string
  density: Density
  tooltip: boolean
  collapsed: boolean
  onNavigate?: () => void
}) {
  const [tipOpen, onTip] = useRailTip(collapsed)
  const Icon = item.icon
  const attention = item.tone === "attention"
  const hasBadge = item.badge !== undefined && item.badge !== null

  const link = (
    <Link
      href={item.href}
      // The section you're on opens in its default view, from the top, without a remount; a
      // Next navigation to the same page would leave its URL-linked tab and filters showing.
      onClick={(e) => {
        followInPlace(e, item.href)
        onNavigate?.()
      }}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group/nav relative isolate flex w-full items-center gap-3 rounded-xl pr-2 pl-3 transition-colors duration-150",
        density === "dense" ? "h-9 text-[13px] sidebar-shorter:h-8" : "h-10 text-sm sidebar-short:h-9 sidebar-shorter:h-8",
        active ? "text-ink" : "text-ink-2 hover:text-ink",
      )}
    >
      {active ? (
        <>
          <motion.span layoutId={`${ns}-pill`} transition={spring.indicator} aria-hidden className="shell-pill absolute inset-0 -z-10 rounded-xl" />
          <motion.span layoutId={`${ns}-bar`} transition={spring.indicator} aria-hidden className="shell-indicator absolute top-[calc(50%-9px)] -left-[13px] h-[18px] w-[3px] rounded-r-full" />
        </>
      ) : (
        <span aria-hidden className="absolute inset-0 -z-10 rounded-xl bg-white/[0.04] opacity-0 transition-opacity duration-150 group-hover/nav:opacity-100" />
      )}
      <span className="relative inline-flex shrink-0">
        <Icon weight={active ? "fill" : "regular"} className={cn("size-5 transition-colors duration-150", active ? "text-violet" : "text-ink-3 group-hover/nav:text-ink-2")} />
        {hasBadge ? (
          <span
            aria-hidden
            className={cn(
              "absolute -top-0.5 -right-0.5 size-[7px] rounded-full opacity-0 ring-2 ring-[#0e0e0e] transition-opacity duration-150 sidebar-collapsed:opacity-100",
              attention ? "bg-ink" : "bg-violet",
            )}
          />
        ) : null}
      </span>
      <span className={cn("min-w-0 flex-1 truncate transition-opacity duration-150 sidebar-collapsed:opacity-0", active && "font-medium")}>{item.label}</span>
      {hasBadge ? (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border px-1.5 text-[11px] leading-none font-medium tabular transition-opacity duration-150 sidebar-collapsed:opacity-0",
            attention ? "border-white/35 text-ink" : "border-white/15 text-ink-2",
          )}
        >
          {item.badge}
          {item.badgeLabel ? <span className="sr-only"> {item.badgeLabel}</span> : null}
        </span>
      ) : null}
    </Link>
  )

  if (!tooltip) return link
  return (
    <Tooltip open={tipOpen} onOpenChange={onTip} disableHoverableContent>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={22} className="gap-2">
        {item.label}
        {hasBadge ? <span className="text-black/55 tabular">{item.badgeLabel ? `${item.badge} ${item.badgeLabel}` : item.badge}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}
