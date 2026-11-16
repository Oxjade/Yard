import type { Metadata } from "next"
import { ShopSetupRoute } from "@/components/studio/storefront-editor/shop-setup"

export const metadata: Metadata = { title: "Set up your shop" }

/** Set up your shop: logo, banner, a line about the brand, then Publish my shop. */
export default function ShopSetupPage() {
  return <ShopSetupRoute />
}
