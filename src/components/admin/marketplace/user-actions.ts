"use client"

import { toast } from "sonner"
import { ProhibitIcon, ArrowCounterClockwiseIcon, ShieldWarningIcon } from "@phosphor-icons/react"
import type { PlatformUser } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import type { Decision } from "./decision"

export type UserActionKey = "restrict" | "suspend" | "reinstate"
type Status = PlatformUser["status"]

export const userActions: Record<UserActionKey, { label: string; to: Status; icon: React.ComponentType<{ className?: string }>; button: "primary" | "secondary" | "destructive"; destructive: boolean; means: string; done: string }> = {
  restrict: {
    label: "Restrict",
    to: "restricted",
    icon: ShieldWarningIcon,
    button: "secondary",
    destructive: true,
    means: "Restricted accounts can sign in and browse, but can't check out, enter drops or message brands. Orders already placed still ship. The restriction is recorded now; blocking checkout, drops and messages starts once the accounts backend is connected.",
    done: "restricted",
  },
  suspend: {
    label: "Suspend",
    to: "suspended",
    icon: ProhibitIcon,
    button: "destructive",
    destructive: true,
    means: "Suspended accounts are signed out and can't sign in. Open orders still ship and refunds still go back to the original payment method. The suspension is recorded now; signing the shopper out and blocking sign-in start once the accounts backend is connected.",
    done: "suspended",
  },
  reinstate: {
    label: "Reinstate",
    to: "active",
    icon: ArrowCounterClockwiseIcon,
    button: "primary",
    destructive: false,
    means: "Reinstating gives the account full access again. It's recorded now and reaches the shopper's sign-in once the accounts backend is connected.",
    done: "reinstated",
  },
}

export const userAllowed: Record<Status, UserActionKey[]> = {
  active: ["restrict", "suspend"],
  restricted: ["reinstate", "suspend"],
  suspended: ["reinstate"],
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
    confirmLabel: one ? `${def.label} account` : `${def.label} ${plural(users.length)}`,
    destructive: def.destructive,
    run: (reason) => {
      const set = useAdmin.getState().setUserStatus
      for (const u of users) set(u.id, def.to, reason)
      if (announce) toast.success(one ? `${one.name} ${def.done}` : `${plural(users.length)} ${def.done}`, { description: "Recorded in the audit log with your reason." })
    },
  }
}
