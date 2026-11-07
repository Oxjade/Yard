"use client"

import { toast } from "sonner"
import { ProhibitIcon, CheckIcon, ArrowCounterClockwiseIcon, ShieldWarningIcon, ShieldCheckIcon } from "@phosphor-icons/react"
import { pushAudit } from "@/components/admin/trust/shared"
import { decide } from "@/lib/api/admin"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix } from "@/lib/api/use-api"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"
import type { BrandApplication, BrandReviewStatus } from "@/lib/data/admin"
import { canAdmin, needsRole } from "@/lib/permissions"
import { useServerSession } from "@/lib/session/use-server-session"
import { useAdmin } from "@/lib/stores/admin"
import type { Decision } from "./decision"
import { kycMeta } from "./meta"
import { audienceLine, notifyBrandDecision } from "./notify"
import { NO_ADMIN_SESSION } from "./user-actions"

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
    warn: (a) => (a.kyc === "failed" ? "The last identity check failed. Make sure a new check has passed first." : unverifiedKyc(a)),
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
    // Local sample applications only; a server brand goes back to the status it had before (below).
    to: "verified",
    icon: ArrowCounterClockwiseIcon,
    button: "primary",
    destructive: false,
    means: "Reinstating restores the storefront and listings. Held payouts are released once the standard reserve period has passed.",
    confirm: "Reinstate",
    done: "reinstated",
  },
}

const unverifiedKyc = (a: BrandApplication) => (a.kyc !== "verified" ? `The identity check is ${kycMeta[a.kyc].label.toLowerCase()}, so this lets the brand sell as verified before KYC is complete.` : null)

/** Only the transitions a brand's current status allows. */
export const brandAllowed: Record<BrandReviewStatus, BrandActionKey[]> = {
  pending_review: ["approve", "restrict", "suspend"],
  verified: ["restrict", "suspend"],
  restricted: ["reinstate", "verify", "suspend"],
  suspended: ["reinstate"],
}

const plural = (n: number) => `${n} ${n === 1 ? "brand" : "brands"}`

/**
 * Brands with a record on Yard's server (every brand in the catalogue) change status through the
 * set-brand-status decision (§8.2): the server writes the status, signs a suspended brand's
 * members out, takes its posts and places off the marketplace and audits it. Applications that
 * exist only as sample data in this browser (no brandId) keep the local decision.
 */
export const onServer = (a: BrandApplication) => !!a.brandId

/** Why this admin can't change a server brand's status here, or undefined when they can. */
export function useBrandStatusBlock() {
  const admin = useServerSession((s) => s.admin)
  const loading = useServerSession((s) => s.status === "loading")
  return (a: BrandApplication) => {
    if (!onServer(a)) return undefined
    if (loading) return "Checking your admin session."
    if (!admin) return NO_ADMIN_SESSION
    return canAdmin(admin.role, "brands.restrict") ? undefined : needsRole("brands.restrict")
  }
}

/** Mirrors the server's status into this browser's store (status only: the audit row is the server's). */
export function mirrorBrandStatus(appId: string, status: BrandReviewStatus) {
  useAdmin.setState((s) => (s.applications.some((a) => a.id === appId && a.status !== status) ? { applications: s.applications.map((a) => (a.id === appId ? { ...a, status } : a)) } : s))
}

const serverMeans: Partial<Record<BrandActionKey, string>> = {
  restrict: "Yard's server pauses its publishing and replies, and takes its posts and places off the marketplace until it's verified again.",
  suspend: "Yard's server signs its members out of Studio at once and takes its posts, places and chart entries off the marketplace.",
}

/**
 * The decision for one brand or several (a bulk action applies one reason to each, and
 * skips any brand whose status doesn't allow it). The Studio brand's merchant is told.
 */
export function brandDecision(key: BrandActionKey, list: BrandApplication[], { announce = true, reinstateTo = {} }: { announce?: boolean; reinstateTo?: Record<string, "pending_review" | "verified"> } = {}): Decision | null {
  const def = brandActions[key]
  const apps = list.filter((a) => brandAllowed[a.status].includes(key))
  if (!apps.length) return null
  const one = apps.length === 1 ? apps[0] : null
  const skipped = list.length - apps.length
  // Reinstate restores what the brand had before its restriction or suspension: Yard's server reads
  // it from the audit log (review when it isn't on record), so it never verifies a brand by default.
  const backTo = (a: BrandApplication): BrandReviewStatus => (onServer(a) ? (reinstateTo[a.brandId!] ?? "pending_review") : def.to)
  const reinstating = key === "reinstate"
  const warnings = apps.map((a) => (reinstating ? (backTo(a) === "verified" ? unverifiedKyc(a) : null) : def.warn?.(a))).filter(Boolean) as string[]
  const restoreLine = reinstating
    ? one
      ? backTo(one) === "verified"
        ? `${one.brandName} goes back to Verified, the status it had before.`
        : `${one.brandName} goes back to review (pending), the status it had before or, when that isn't on record, the safe default. Approve it separately once it passes.`
      : "Each brand goes back to the status it had before: Verified only if it was verified, otherwise review."
    : null
  const studioApp = apps.find((a) => a.brandId === STUDIO_BRAND_ID)
  const server = apps.filter(onServer)
  const local = apps.filter((a) => !onServer(a))
  return {
    title: one ? `${def.verb} ${one.brandName}?` : `${def.verb} ${plural(apps.length)}?`,
    description: [
      def.means,
      restoreLine,
      server.length ? serverMeans[key] : null,
      local.length ? (one ? "This application is sample data in this browser only, with no account on Yard's server yet, so the decision is recorded here." : `${plural(local.length)} selected ${local.length === 1 ? "is" : "are"} sample applications in this browser only; ${local.length === 1 ? "its" : "their"} decision is recorded here.`) : null,
      one ? warnings[0] : warnings.length ? `${warnings.length} of them ${warnings.length === 1 ? "has" : "have"} KYC that isn't verified yet.` : null,
      skipped ? `${plural(skipped)} selected ${skipped === 1 ? "isn't" : "aren't"} in a status this applies to and ${skipped === 1 ? "is" : "are"} left as ${skipped === 1 ? "it is" : "they are"}.` : null,
      studioApp ? audienceLine(studioApp.brandName, "in Studio") : null,
    ]
      .filter(Boolean)
      .join(" "),
    confirmLabel: one ? `${def.confirm} brand` : `${def.confirm} ${plural(apps.length)}`,
    destructive: def.destructive,
    run: async (reason) => {
      let done = 0
      let failure: unknown = null
      for (const a of server) {
        try {
          const r = await decide<"set-brand-status", { status: BrandReviewStatus }>("set-brand-status", { id: a.brandId!, status: reinstating ? "reinstate" : def.to, reason })
          pushAudit(r.audit)
          mirrorBrandStatus(a.id, r.item.status)
          // The server notifies the brand on restriction and suspension; the other outcomes are told here as before.
          if (key !== "restrict" && key !== "suspend") notifyBrandDecision(a, key, reason)
          done++
        } catch (e) {
          failure = e
          break
        }
      }
      if (server.length) revalidatePrefix("admin:")
      if (failure && !done) throw failure
      const set = useAdmin.getState().setApplicationStatus
      if (!failure)
        for (const a of local) {
          set(a.id, def.to, reason)
          notifyBrandDecision(a, key, reason)
          done++
        }
      if (failure) toast.error(`${plural(done)} ${def.done}; the rest didn't go through`, { description: errorMessage(failure) })
      else if (announce) toast.success(one ? `${one.brandName} ${def.done}` : `${plural(done)} ${def.done}`, { description: "Recorded in the audit log with your reason." })
    },
  }
}
