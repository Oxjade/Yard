"use client"

import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { providerLabels, type SocialAccountDto, type SocialPostDto, type StudioSocialPostDto } from "@/lib/api/contracts/social"
import { memberRoleLabel, type BrandPermission } from "@/lib/permissions"
import type { BrandProfile } from "@/lib/api/contracts/session"
import { cn } from "@/lib/utils"

/** "4 Nov", or "4 Nov 2025" outside this year. */
export function shortDate(iso: string) {
  const d = new Date(iso)
  const thisYear = d.getUTCFullYear() === new Date().getUTCFullYear()
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(thisYear ? {} : { year: "numeric" }) })
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86_400)
  return d === 1 ? "yesterday" : `${d} days ago`
}

/** The chip on a Content Studio tile: where the post came from. */
export function sourceChip(p: SocialPostDto) {
  if (p.source === "upload") return "Upload"
  if (p.source === "sample") return "Sample"
  const net = p.provider ? providerLabels[p.provider] : "Instagram"
  return p.source === "sandbox" ? `${net} sandbox` : net
}

/** What a removed-upstream note says ("No longer on Instagram"). */
export const missingNote = (p: StudioSocialPostDto) => (p.upstreamMissingAt ? `No longer on ${p.provider === "tiktok" ? "TikTok" : "Instagram"}` : null)

/** "Your role (Fulfilment) can't connect accounts." — the copy each disabled control explains itself with. */
export function cantSentence(brand: BrandProfile | null, permission: BrandPermission) {
  if (!brand) return "Sign in to Brand Studio first."
  const role = memberRoleLabel(brand.role)
  return permission === "social.connect" ? `Your role (${role}) can't connect accounts.` : `Your role (${role}) can't publish posts.`
}

export const can = (brand: BrandProfile | null, permission: BrandPermission) => !!brand?.permissions.includes(permission)

export const accountFor = (accounts: SocialAccountDto[] | undefined, provider: "instagram" | "tiktok") => accounts?.find((a) => a.provider === provider)

/** A 480 px Studio sheet (the CustomerSheet pattern): full width on phones, header, scrolling body, footer. */
export function StudioSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("gap-0 border-line-soft bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[480px]", className)}>
        <SheetHeader className="gap-1 border-b border-line-soft p-4 pr-12 md:p-5 md:pr-12">
          <SheetTitle className="text-[15px] text-ink">{title}</SheetTitle>
          {description ? <SheetDescription className="text-xs text-ink-2">{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-5">{children}</div>
        {footer ? <SheetFooter className="flex-row justify-end gap-2 border-t border-line-soft p-4 md:px-5">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  )
}
