"use client"

import { useEffect } from "react"
import { useHydrated } from "@/hooks/use-hydrated"
import { useStudio } from "@/lib/stores/studio"
import type { Brand, StorefrontConfig } from "@/lib/data/types"
import { brandWithStorefront, type StorefrontBrandOverrides } from "./brand-with-storefront"
import { StorefrontRenderer, type StorefrontRendererProps } from "./storefront-renderer"

/**
 * The storefront a brand has published. In the frontend phase, the brand signed in to Brand
 * Studio keeps its published storefront in the Studio store, so a publish there shows up on its
 * storefront and its collection pages. Every other brand (and every brand before hydration)
 * gets its seeded config. In the backend phase the page reads the published version from the
 * database and this hook goes away.
 */
export function usePublishedStorefront(brand: Brand, seed: StorefrontConfig = brand.storefront): { brand: Brand; config: StorefrontConfig; hydrated: boolean } {
  const hydrated = useHydrated()
  const published = useStudio((s) => (s.brandId === brand.id ? s.storefront.published : null))
  if (!hydrated || !published) return { brand, config: seed, hydrated }
  // The Studio editor stores the brand-level look (cover, mark, links) on the same document.
  return { brand: brandWithStorefront(brand, published as typeof published & StorefrontBrandOverrides), config: published, hydrated }
}

/**
 * The page under a link such as /brands/x#sf-collections renders after its loading state, so the
 * router's own hash scroll runs before the section exists and lands at the top. Once the
 * storefront is on the page (and has switched to the published config), bring the named section
 * into view. An instant jump, as the browser's own hash navigation is; sections carry scroll-mt-24
 * so they clear the floating header.
 */
function useScrollToHash(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return
    let frame = requestAnimationFrame(() => {
      // Second frame: after the router's own scroll handling for this navigation.
      frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "auto" }))
    })
    return () => cancelAnimationFrame(frame)
  }, [ready])
}

/** The public storefront: the published config (see usePublishedStorefront), rendered live. */
export function LiveStorefront(props: Omit<StorefrontRendererProps, "preview">) {
  const { brand, config, hydrated } = usePublishedStorefront(props.brand, props.config)
  useScrollToHash(hydrated)
  return <StorefrontRenderer {...props} config={config} brand={brand} />
}
