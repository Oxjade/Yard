"use client"

import { useHydrated } from "@/hooks/use-hydrated"
import { useStudio } from "@/lib/stores/studio"
import { brandWithStorefront, type StorefrontBrandOverrides } from "./brand-with-storefront"
import { StorefrontRenderer, type StorefrontRendererProps } from "./storefront-renderer"

/**
 * The public storefront. In the frontend phase, the brand signed in to Brand Studio keeps
 * its published storefront in the Studio store, so a publish there shows up here. Every
 * other brand renders its seeded config. In the backend phase the page reads the
 * published version from the database and this wrapper goes away.
 */
export function LiveStorefront(props: Omit<StorefrontRendererProps, "preview">) {
  const hydrated = useHydrated()
  const published = useStudio((s) => (s.brandId === props.brand.id ? s.storefront.published : null))
  if (!hydrated || !published) return <StorefrontRenderer {...props} />
  // The Studio editor stores the brand-level look (cover, mark, links) on the same document.
  return <StorefrontRenderer {...props} config={published} brand={brandWithStorefront(props.brand, published as typeof published & StorefrontBrandOverrides)} />
}
