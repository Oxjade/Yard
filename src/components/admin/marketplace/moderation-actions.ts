"use client"

import { toast } from "sonner"
import { GavelIcon, ArrowCounterClockwiseIcon, TrashIcon, XCircleIcon } from "@phosphor-icons/react"
import { brandById, productById } from "@/lib/data"
import type { ModerationItem } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import type { Decision } from "./decision"
import { audienceLine, isStudioBrand, listingSharesReason, notifyListingDecision } from "./notify"

type Status = ModerationItem["status"]
export type ModActionKey = "remove" | "dismiss" | "escalate" | "reopen"

export const modActions: Record<ModActionKey, { label: string; to: Status; icon: React.ComponentType<{ className?: string }>; button: "secondary" | "destructive"; destructive: boolean; means: (m: ModerationItem | null) => string; done: string; outcome: "removed" | "dismissed" | "escalated" | "reopened" }> = {
  remove: {
    label: "Remove listing",
    to: "removed",
    icon: TrashIcon,
    button: "destructive",
    destructive: true,
    means: () => "Removed listings can't be bought. If one was removed in error, reopen its case from the Removed tab.",
    done: "removed",
    outcome: "removed",
  },
  dismiss: {
    label: "Dismiss",
    to: "dismissed",
    icon: XCircleIcon,
    button: "secondary",
    destructive: false,
    means: () => "Closes the case with no action. The listing stays up.",
    done: "dismissed",
    outcome: "dismissed",
  },
  escalate: {
    label: "Escalate to legal",
    to: "escalated",
    icon: GavelIcon,
    button: "secondary",
    destructive: false,
    means: () => "Passes the case and its evidence to legal review. The listing stays up until legal decides, unless you remove it.",
    done: "escalated to legal",
    outcome: "escalated",
  },
  reopen: {
    label: "Reopen case",
    to: "open",
    icon: ArrowCounterClockwiseIcon,
    button: "secondary",
    destructive: false,
    means: (m) =>
      m?.status === "removed"
        ? `Moves the case back to the open queue and the listing can be bought again while it's reviewed.${m.reason === "counterfeit" || m.reason === "ip_complaint" ? " It was removed for a counterfeit or IP report, so check the evidence before it goes back on sale." : ""}`
        : "Moves the case back to the open queue for another review.",
    done: "reopened",
    outcome: "reopened",
  },
}

/** Only the transitions a case's status allows. */
export const modAllowed: Record<Status, ModActionKey[]> = {
  open: ["remove", "escalate", "dismiss"],
  escalated: ["remove", "dismiss"],
  dismissed: ["reopen"],
  removed: ["reopen"],
}

const plural = (n: number) => `${n} ${n === 1 ? "case" : "cases"}`

export function modDecision(key: ModActionKey, list: ModerationItem[], { announce = true }: { announce?: boolean } = {}): Decision | null {
  const def = modActions[key]
  const items = list.filter((m) => modAllowed[m.status].includes(key))
  if (!items.length) return null
  const one = items.length === 1 ? items[0] : null
  const skipped = list.length - items.length
  const brandOf = (m: ModerationItem) => {
    const p = m.productId ? productById.get(m.productId) : undefined
    return { id: p?.brandId, name: p ? (brandById.get(p.brandId)?.name ?? m.brandName) : m.brandName }
  }
  // The Studio brand's merchant is the one reader outside the Control Center in this build.
  const studio = items.map(brandOf).find(isStudioBrand)
  // Titles that already open with a quote ("“Designer-inspired” belt") aren't wrapped again.
  const subject = one ? (/^[“"‘]/.test(one.title) ? one.title : `“${one.title}”`) : plural(items.length)
  return {
    title: {
      remove: one ? `Remove ${subject}?` : `Remove the listings in ${subject}?`,
      dismiss: one ? `Dismiss the report on ${subject}?` : `Dismiss ${subject}?`,
      escalate: one ? `Escalate ${subject} to legal?` : `Escalate ${subject} to legal?`,
      reopen: one ? `Reopen the case on ${subject}?` : `Reopen ${subject}?`,
    }[key],
    description: [def.means(one), studio ? audienceLine(studio.name, "in Studio", listingSharesReason[def.outcome]) : null, skipped ? `${plural(skipped)} selected ${skipped === 1 ? "isn't" : "aren't"} in a status this applies to and ${skipped === 1 ? "is" : "are"} left as ${skipped === 1 ? "it is" : "they are"}.` : null].filter(Boolean).join(" "),
    confirmLabel: one ? def.label : { remove: `Remove ${items.length} listings`, dismiss: `Dismiss ${plural(items.length)}`, escalate: `Escalate ${plural(items.length)}`, reopen: `Reopen ${plural(items.length)}` }[key],
    destructive: def.destructive,
    run: (reason) => {
      const set = useAdmin.getState().setModerationStatus
      for (const m of items) {
        set(m.id, def.to, reason)
        notifyListingDecision(brandOf(m), m.title, def.outcome, reason)
      }
      if (announce) toast.success(one ? `Case ${def.done}` : `${plural(items.length)} ${def.done}`, { description: one ? `${one.title}. Recorded in the audit log.` : "Recorded in the audit log with your reason." })
    },
  }
}
