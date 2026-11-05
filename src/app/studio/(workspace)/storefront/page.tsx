import type { Metadata } from "next"
import { StorefrontEditor } from "@/components/studio/storefront-editor/storefront-editor"

export const metadata: Metadata = { title: "Storefront" }

export default function StudioStorefrontPage() {
  return <StorefrontEditor />
}
