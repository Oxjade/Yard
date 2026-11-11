import type { Metadata } from "next"
import { Suspense } from "react"
import { connection } from "next/server"
import { BrandDirectory, BrandDirectoryFallback } from "@/components/market/brands/directory"
import { BrandSections } from "@/components/market/brands/brand-sections"
import { BrandsJoining } from "@/components/market/brands/brands-joining"
import { LiveBrandDirectory } from "@/components/market/brands/live-brand-directory"
import { brands } from "@/lib/data"
import type { PublicBrandsPage } from "@/lib/api/public-brands"
import { listPublicBrands } from "@/server/catalog/public"
import { getEnv } from "@/server/env"

export const metadata: Metadata = {
  title: "Brands",
  description: "Independent brands on Yard. Search, filter by category, and follow the studios you like.",
}

const header = (blurb: React.ReactNode) => (
  <header className="grid gap-5 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-12">
    <h1 className="font-display text-display-lg text-ink">Brands</h1>
    <p className="max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2 lg:pb-1">{blurb}</p>
  </header>
)

export default function BrandsPage() {
  // Production (no demo seed): only listed brands from the server, never the sample brands.
  // Demo and development keep the sample directory exactly as before.
  if (!getEnv().seedDemo) {
    return (
      <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
        <Suspense fallback={<>{header("Independent studios, each with its own storefront.")}</>}>
          <LiveBrands />
        </Suspense>
      </div>
    )
  }

  const countryCount = new Set(brands.map((b) => b.country)).size
  const sections = <BrandSections />

  return (
    <div className="mx-auto max-w-page px-4 pt-28 md:px-8 md:pt-32">
      {header(
        <>
          {brands.length} independent studios from {countryCount} countries, each with its own storefront. Follow the ones you like and their new pieces, drops and stories come to you.
        </>,
      )}

      {/* The URL holds the filters, so the directory reads it inside Suspense. The fallback is the unfiltered page. */}
      <Suspense fallback={<BrandDirectoryFallback>{sections}</BrandDirectoryFallback>}>
        <BrandDirectory>{sections}</BrandDirectory>
      </Suspense>
    </div>
  )
}

/** The server's brand list (request time), with the header count from the database. */
async function LiveBrands() {
  await connection()
  let initial: PublicBrandsPage | null = null
  try {
    initial = await listPublicBrands({ sort: "name", limit: 24, offset: 0 })
  } catch {
    initial = null
  }
  if (!initial) {
    return (
      <>
        {header("Independent studios, each with its own storefront.")}
        <BrandsJoining className="mt-10 md:mt-14" title="Brands couldn't be loaded right now" />
      </>
    )
  }
  const countries = new Set(initial.brands.map((b) => b.country)).size
  const blurb =
    initial.total === 0
      ? "Independent studios, each with its own storefront. The first ones are opening soon."
      : initial.total === 1
        ? "One independent studio with its own storefront so far. Follow it and its new pieces, drops and stories come to you."
        : `${initial.total} independent studios${initial.nextOffset === null && countries > 1 ? ` from ${countries} countries` : ""}, each with its own storefront. Follow the ones you like and their new pieces, drops and stories come to you.`
  return (
    <>
      {header(blurb)}
      <LiveBrandDirectory initial={initial} />
    </>
  )
}
