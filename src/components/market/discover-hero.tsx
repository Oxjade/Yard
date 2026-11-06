"use client"

import Image from "next/image"
import Link from "next/link"
import { ArrowUpRightIcon as ArrowUpRight } from "@phosphor-icons/react"
import { motion, useReducedMotion } from "motion/react"
import { Button } from "@/components/ui/button"
import type { Brand, Drop, ImageAsset, Product } from "@/lib/data/types"
import { BrandMark } from "./brand-mark"
import { FollowButton } from "./follow-button"
import { SponsoredTag } from "./sponsored-tag"

const ease = [0.22, 1, 0.36, 1] as const

/**
 * The Discover hero — the page's one orchestrated motion moment: the photograph settles,
 * then the headline rises line by line. Everything else on the page moves only when asked.
 */
export function DiscoverHero({
  brand,
  drop,
  image,
  headline,
  products,
  spotlight,
}: {
  brand: Brand
  drop: Drop
  image: ImageAsset
  headline: string[]
  products: Product[]
  spotlight: { brand: Brand; title: string; image: ImageAsset; href: string }
}) {
  const reduce = useReducedMotion()
  const rise = (i: number) =>
    reduce ? {} : { initial: { y: "105%" }, animate: { y: 0 }, transition: { duration: 0.9, delay: 0.25 + i * 0.09, ease } }
  const fade = (d: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay: d, ease } }

  return (
    <section aria-labelledby="hero-title" className="relative isolate min-h-[640px] overflow-hidden md:h-[min(100svh,960px)]">
      <motion.div
        className="absolute inset-0 -z-10"
        initial={reduce ? false : { scale: 1.08, opacity: 0.4 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.6, ease }}
      >
        <Image src={image.src} alt={image.alt} fill preload sizes="100vw" className="object-cover object-[60%_30%]" />
      </motion.div>
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-obsidian via-obsidian/30 to-obsidian/40" aria-hidden />
      <div className="scrim-l absolute inset-0 -z-10 md:w-2/3" aria-hidden />

      <div className="mx-auto flex h-full max-w-page flex-col justify-end px-4 pt-32 pb-10 md:px-8 md:pb-14">
        <div className="grid items-end gap-10 lg:grid-cols-[1fr_340px]">
          <div>
            <motion.div {...fade(0.15)} className="flex items-center gap-3">
              <BrandMark brand={brand} size="sm" />
              <Link href={`/brands/${brand.handle}`} className="text-sm text-ink hover:text-violet">{brand.name}</Link>
              <span className="text-sm text-ink-2">{brand.city}</span>
            </motion.div>

            <h1 id="hero-title" className="mt-5 font-display text-display-2xl text-ink">
              {headline.map((line, i) => (
                <span key={line} className="block overflow-hidden pb-[0.04em]">
                  <motion.span className="block" {...rise(i)}>{line}</motion.span>
                </span>
              ))}
            </h1>

            <motion.p {...fade(0.6)} className="mt-6 max-w-md text-pretty text-base leading-relaxed text-ink/85 md:text-lg">
              {drop.description}
            </motion.p>

            <motion.div {...fade(0.72)} className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild variant="primary" size="lg">
                <Link href={`/drops/${drop.slug}`}>Preview the drop</Link>
              </Button>
              <FollowButton brandId={brand.id} brandName={brand.name} size="lg" variant="glass" />
            </motion.div>
          </div>

          <motion.aside {...fade(0.85)} className="grid gap-3" aria-label="Also on now">
            <div className="glass glass-sheen rounded-2xl p-3">
              <p className="px-1 pb-2 text-xs text-ink-2">In the drop</p>
              <div className="grid grid-cols-3 gap-2">
                {products.slice(0, 3).map((p) => (
                  <Link key={p.id} href={`/products/${p.slug}`} className="group relative aspect-[4/5] overflow-hidden rounded-lg bg-surface">
                    <Image src={p.images[0].src} alt={p.images[0].alt} fill sizes="110px" className="object-cover transition-transform duration-700 ease-out-quint group-hover:scale-105" />
                  </Link>
                ))}
              </div>
            </div>
            <Link href={spotlight.href} className="glass glass-sheen group flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-[var(--glass-bg-strong)]">
              <span className="relative size-16 shrink-0 overflow-hidden rounded-lg">
                <Image src={spotlight.image.src} alt="" fill sizes="64px" className="object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <SponsoredTag className="mb-1.5" />
                <span className="block truncate text-sm text-ink">{spotlight.title}</span>
                <span className="block truncate text-xs text-ink-2">{spotlight.brand.name}</span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-ink-2 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </motion.aside>
        </div>
      </div>
    </section>
  )
}
