"use client"

import { toast } from "sonner"
import { ProhibitIcon, CheckIcon, ArrowCounterClockwiseIcon, ShieldWarningIcon, ShieldCheckIcon } from "@phosphor-icons/react"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"
import type { BrandApplication, BrandReviewStatus } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import type { Decision } from "./decision"
import { kycMeta } from "./meta"
import { audienceLine, notifyBrandDecision } from "./notify"

export type BrandActionKey = "approve" | "verify" | "restrict" | "suspend" | "reinstate"

type Def = {
  label: string
  /** Label in a bulk bar or a menu, where the brand isn't named. */
  verb: string
  to: BrandReviewStatus
  icon: React.ComponentType<{ className?: string }>
  button: "primary" | "secondary" | "destructive"
  destructive: boolean
  /** What the decision means, as policy. Written once for one brand and for several. */
  means: string
  confirm: string
  done: string
  warn?: (a: BrandApplication) => string | null
}

export const brandActions: Record<BrandActionKey, Def> = {
  approve: {
    label: "Approve",
    verb: "Approve",
    to: "verified",
    icon: CheckIcon,
    button: "primary",
    destructive: false,
    means: "Approved brands move to Verified: they can sell, and payouts start on the new-brand reserve.",
    confirm: "Approve",
    done: "approved",
    warn: (a) => (a.kyc !== "verified" ? `The identity check is ${kycMeta[a.kyc].label.toLowerCase()}, so approving lets the brand sell before KYC is complete.` : null),
  },
  verify: {
    label: "Verify",
    verb: "Verify",
    to: "verified",
    icon: ShieldCheckIcon,
    button: "primary",
    destructive: false,
    means: "Verifying lifts the restriction: listings can show in discovery and search again, new products can be published, and held payouts are released after the reserve.",
    confirm: "Verify",
    done: "verified",
    warn: (a) => (a.kyc === "failed" ? "The last identity check failed. Make sure a new check has passed first." : null),
  },
  restrict: {
    label: "Restrict",
    verb: "Restrict",
    to: "restricted",
    icon: ShieldWarningIcon,
    button: "secondary",
    destructive: true,
    means: "Restricted brands have their listings held back from discovery and search, can't publish new products and have payouts held. They can still fulfil open orders.",
    confirm: "Restrict",
    done: "restricted",
  },
  suspend: {
    label: "Suspend",
    verb: "Suspend",
    to: "suspended",
    icon: ProhibitIcon,
    button: "destructive",
    destructive: true,
    means: "Suspended brands have their storefront and every product hidden, checkout blocked and payouts held until they're reinstated.",
    confirm: "Suspend",
    done: "suspended",
  },
  reinstate: {
    label: "Reinstate",
    verb: "Reinstate",
    to: "verified",
    icon: ArrowCounterClockwiseIcon,
    button: "primary",
    destructive: false,
    means: "Reinstating restores the storefront and listings. Held payouts are released once the standard reserve period has passed.",
    confirm: "Reinstate",
    done: "reinstated",
  },
}

/** Only the transitions a brand's current status allows. */
export const brandAllowed: Record<BrandReviewStatus, BrandActionKey[]> = {
  pending_review: ["approve", "restrict", "suspend"],
  verified: ["restrict", "suspend"],
  restricted: ["verify", "suspend"],
  suspended: ["reinstate"],
}

const plural = (n: number) => `${n} ${n === 1 ? "brand" : "brands"}`

/**
 * The decision for one brand or several (a bulk action applies one reason to each, and
 * skips any brand whose status doesn't allow it). The Studio brand's merchant is told.
 */
export function brandDecision(key: BrandActionKey, list: BrandApplication[], { announce = true }: { announce?: boolean } = {}): Decision | null {
  const def = brandActions[key]
  const apps = list.filter((a) => brandAllowed[a.status].includes(key))
  if (!apps.length) return null
  const one = apps.length === 1 ? apps[0] : null
  const skipped = list.length - apps.length
  const warnings = apps.map((a) => def.warn?.(a)).filter(Boolean) as string[]
  const studioApp = apps.find((a) => a.brandId === STUDIO_BRAND_ID)
  return {
    title: one ? `${def.verb} ${one.brandName}?` : `${def.verb} ${plural(apps.length)}?`,
    description: [
      def.means,
      one ? warnings[0] : warnings.length ? `${warnings.length} of them ${warnings.length === 1 ? "has" : "have"} KYC that isn't verified yet.` : null,
      skipped ? `${plural(skipped)} selected ${skipped === 1 ? "isn't" : "aren't"} in a status this applies to and ${skipped === 1 ? "is" : "are"} left as ${skipped === 1 ? "it is" : "they are"}.` : null,
      studioApp ? audienceLine(studioApp.brandName, "in Studio") : null,
    ]
      .filter(Boolean)
      .join(" "),
    confirmLabel: one ? `${def.confirm} brand` : `${def.confirm} ${plural(apps.length)}`,
    destructive: def.destructive,
    run: (reason) => {
      const set = useAdmin.getState().setApplicationStatus
      for (const a of apps) {
        set(a.id, def.to, reason)
        notifyBrandDecision(a, key, reason)
      }
      if (announce) toast.success(one ? `${one.brandName} ${def.done}` : `${plural(apps.length)} ${def.done}`, { description: "Recorded in the audit log with your reason." })
    },
  }
}
