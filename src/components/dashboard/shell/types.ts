import type { Icon } from "@phosphor-icons/react"

/** A Phosphor icon component (regular weight inactive, fill when active). */
export type ShellIcon = Icon

export type ShellNavItem = {
  href: string
  label: string
  icon: ShellIcon
  /** A count shown as an outlined pill (a dot on the collapsed rail). */
  badge?: string | number
  /** What the count means, read after it by screen readers and in the collapsed tooltip, e.g. "not yet shipped". */
  badgeLabel?: string
  /** "attention": the count needs action (acid outline and dot). */
  tone?: "default" | "attention"
}

export type ShellNavGroup = { label?: string; items: ShellNavItem[] }

export type WorkspaceMenuItem = {
  label: string
  href: string
  icon: ShellIcon
  /** Opens in a new tab. */
  external?: boolean
  /** Draws a hairline above this item. */
  separated?: boolean
}

export type ShellWorkspace = {
  /** The 32px mark shown in both states. */
  mark: React.ReactNode
  name: React.ReactNode
  caption: React.ReactNode
  /** Plain-text name for the collapsed rail's tooltip, e.g. "Lagos Static". */
  label: string
  menu: WorkspaceMenuItem[]
}

/** The bottom status card. Real figures only; `value: null` while the stores load. */
export type ShellStatus = {
  icon: ShellIcon
  label: string
  value: React.ReactNode | null
  /** `value` is a calm word for the zero state (e.g. "Queue clear"), not a figure. */
  quiet?: boolean
  /** The action line, e.g. "Request payout". */
  action: string
  href: string
  /** Something here needs doing: acid arrow and dot. Otherwise purple. */
  attention: boolean
  /** Whether the collapsed tile carries a dot. */
  dot: boolean
  /** Collapsed tile tooltip and accessible name, e.g. "Available to pay out: ₦1.2M". */
  summary: string
}

export type ShellAccount = { initials: string; name: string; caption: string }

export type ShellDestination = { label: string; href: string; icon: ShellIcon; hint?: string }

/** The command palette for a surface: its placeholder and the record results it can search. */
export type ShellSearch = {
  placeholder: string
  /** Extra "Go to" destinations beyond the navigation (e.g. Notifications). */
  destinations?: ShellDestination[]
  /** Renders record groups for the query (empty string: render nothing). */
  Results: React.ComponentType<{ query: string; go: (href: string) => void }>
}
