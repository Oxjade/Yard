/**
 * A pass-through layout: it gives this segment its own not-found boundary, so an unknown
 * collection (checked in [collection]/layout.tsx) shows "Collection not found" with a 404.
 */
export default function BrandCollectionsLayout({ children }: LayoutProps<"/brands/[handle]/collections">) {
  return children
}
