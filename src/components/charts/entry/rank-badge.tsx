"use client"

import Link from "next/link"
import { RankingIcon } from "@phosphor-icons/react"
import { motion } from "motion/react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { getBrandRank } from "@/lib/api/charts"
import type { BrandRankDto } from "@/lib/api/contracts/charts"
import { useApi } from "@/lib/api/use-api"
import { duration, ease } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * A brand's best weekly chart position (§6.3 "Entry component for N"), for storefronts and brand
 * cards: "#3 on Trending this week". Renders nothing until the data arrives and nothing when the
 * brand has no rank 20 or better (or in a storefront preview); no layout space is reserved, it is
 * a meta item that fades in. While rankings include the sample baseline the label ends with
 * " · sample" and a tooltip says so.
 *
 * `variant="meta"` is a quiet inline item for a meta row; `variant="stat"` is a small chip whose
 * hit area reaches 40 px tall on phones without changing its look. Inside something that is
 * already a link (a brand card), pass `asLink={false}`: it renders as plain text, so links never
 * nest, and the card's own link takes the tap.
 */
export function RankBadge({ brandId, variant = "meta", preview = false, asLink = true, className }: { brandId: string; variant?: "meta" | "stat"; preview?: boolean; asLink?: boolean; className?: string }) {
  const { data } = useApi<BrandRankDto>(preview ? null : `/api/charts/brand/${brandId}`, () => getBrandRank(brandId), { revalidateOnFocus: false })
  const best = data?.best
  if (!best) return null
  const label = `${best.label}${data.sample ? " · sample" : ""}`
  const look = cn(
    "relative inline-flex items-center gap-1.5 outline-none",
    variant === "stat" ? "h-7 rounded-full border border-white/12 px-2.5 text-xs text-ink after:absolute after:inset-x-0 after:-inset-y-[6px] after:content-['']" : "rounded-sm text-ink-2",
    asLink && "focus-visible:ring-2 focus-visible:ring-violet",
    asLink && (variant === "stat" ? "hover:border-white/25" : "hover:text-ink"),
    className,
  )
  const inner = (
    <>
      <RankingIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="tabular">{label}</span>
    </>
  )
  const badge = asLink ? (
    <Link href={best.href} className={look}>
      {inner}
    </Link>
  ) : (
    <span className={look}>{inner}</span>
  )
  return (
    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: duration.hover, ease: ease.out }} className="inline-flex">
      {data.sample ? (
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent>Rankings include sample activity in this build.</TooltipContent>
        </Tooltip>
      ) : (
        badge
      )}
    </motion.span>
  )
}
