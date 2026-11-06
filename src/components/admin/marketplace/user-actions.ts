"use client"

import { toast } from "sonner"
import { ProhibitIcon, ArrowCounterClockwiseIcon, ShieldWarningIcon } from "@phosphor-icons/react"
import { decide } from "@/lib/api/admin"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix } from "@/lib/api/use-api"
import type { PlatformUser } from "@/lib/data/admin"
import { canAdmin, needsRole } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import { useAdmin } from "@/lib/stores/admin"
import { pushAudit } from "@/components/admin/trust/shared"
import type { Decision } from "./decision"

export type UserActionKey = "restrict" | "suspend" | "reinstate"
type Status = PlatformUser["status"]

/**
 * Account status is enforced on the server (§8.2): each decision calls set-user-status, which
 * writes the status, ends a suspended account's sessions and writes the audit row. The result is
 * then mirrored into this browser's store so the existing pages agree.
 */
export const userActions: Record<UserActionKey, { label: string; to: Status; icon: React.ComponentType<{ className?: string }>; button: "primary" | "secondary" | "destructive"; destructive: boolean; means: string; done: string }> = {
  restrict: {
    label: "Restrict",
    to: "restricted",
    icon: ShieldWarningIcon,
    button: "secondary",
    destructive: true,
    means: "Restricted accounts can still sign in and browse. To pause messaging, uploads or reports, add that restriction under Users › Abuse. Checkout and drops still run in this browser, so the status doesn't block them yet.",
    done: "restricted",
  },
  suspend: {
    label: "Suspend",
    to: "suspended",
    icon: ProhibitIcon,
    button: "destructive",
    destructive: true,
    means: "Suspended accounts are signed out everywhere at once and can't sign in until they're reinstated. Open orders still ship.",
    done: "suspended",
  },
  reinstate: {
    label: "Reinstate",
    to: "active",
    icon: ArrowCounterClockwiseIcon,
    button: "primary",
    destructive: false,
    means: "Reinstating lets the account sign in and use Yard again.",
    done: "reinstated",
  },
}

export const userAllowed: Record<Status, UserActionKey[]> = {
  active: ["restrict", "suspend"],
  restricted: ["reinstate", "suspend"],
  suspended: ["reinstate"],
}

/** Why the status actions are unavailable here, or undefined when this admin can take them. */
export const NO_ADMIN_SESSION = "Sign in with a demo admin account. Yard enforces account status on the server."
export function useUserStatusBlock() {
  const admin = useServerSession((s) => s.admin)
  const loading = useServerSession((s) => s.status === "loading")
  if (loading) return "Checking your admin session."
  if (!admin) return NO_ADMIN_SESSION
  return canAdmin(admin.role, "users.restrict") ? undefined : needsRole("users.restrict")
}

/** Mirrors the server's status into this browser's store (status only: the audit row is the server's). */
export function mirrorUserStatus(id: string, status: Status) {
  useAdmin.setState((s) => (s.users.some((u) => u.id === id && u.status !== status) ? { users: s.users.map((u) => (u.id === id ? { ...u, status } : u)) } : s))
}

const plural = (n: number) => `${n} ${n === 1 ? "account" : "accounts"}`

const statusWord: Record<Status, string> = { active: "active", restricted: "restricted", suspended: "suspended" }

/**
 * Why a bulk action changed nothing, for when none of the selected accounts is in a status it
 * applies to ("None of the 2 selected accounts is restricted or suspended, so nothing was reinstated.").
 */
export function userNothingApplies(key: UserActionKey, count: number) {
  const from = (Object.keys(userAllowed) as Status[]).filter((s) => userAllowed[s].includes(key)).map((s) => statusWord[s])
  const states = from.length > 1 ? `${from.slice(0, -1).join(", ")} or ${from.at(-1)}` : from[0]
  const done = userActions[key].done
  return count === 1 ? `The selected account isn't ${states}, so nothing was ${done}.` : `None of the ${count} selected accounts is ${states}, so nothing was ${done}.`
}

/** One account or several; a bulk action skips accounts whose status it doesn't apply to. */
export function userDecision(key: UserActionKey, list: PlatformUser[], { announce = true }: { announce?: boolean } = {}): Decision | null {
  const def = userActions[key]
  const users = list.filter((u) => userAllowed[u.status].includes(key))
  if (!users.length) return null
  const one = users.length === 1 ? users[0] : null
  const skipped = list.length - users.length
  return {
    title: one ? `${def.label} ${one.name}?` : `${def.label} ${plural(users.length)}?`,
    description: [
      def.means,
      one ? `Account ${one.email}.` : null,
      skipped ? `${plural(skipped)} selected ${skipped === 1 ? "is" : "are"} already in a status this doesn't apply to and ${skipped === 1 ? "is" : "are"} left as ${skipped === 1 ? "it is" : "they are"}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    fieldLabel: "Reason, for the audit log",
    confirmLabel: one ? `${def.label} account` : `${def.label} ${plural(users.length)}`,
    destructive: def.destructive,
    run: async (reason) => {
      // One server decision per account, in turn. Those that went through are mirrored even
      // when a later one fails, so this browser never shows a status the server doesn't have.
      let done = 0
      let failure: unknown = null
      for (const u of users) {
        try {
          const r = await decide("set-user-status", { id: u.id, status: def.to, reason })
          pushAudit(r.audit)
          mirrorUserStatus(u.id, def.to)
          done++
        } catch (e) {
          failure = e
          break
        }
      }
      revalidatePrefix("admin:")
      if (failure && !done) throw failure
      if (failure) toast.error(`${plural(done)} ${def.done}; the rest didn't go through`, { description: errorMessage(failure) })
      else if (announce) toast.success(one ? `${one.name} ${def.done}` : `${plural(done)} ${def.done}`, { description: "Recorded in the audit log with your reason." })
    },
  }
}
