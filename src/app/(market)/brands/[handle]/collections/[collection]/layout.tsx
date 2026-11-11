/**
 * Collection existence is checked against the public catalogue in page.tsx. This layout must not
 * gate server-created collections against the frontend sample directory.
 */
export const instant = false

export default function BrandCollectionLayout({ children }: LayoutProps<"/brands/[handle]/collections/[collection]">) {
  return children
}
