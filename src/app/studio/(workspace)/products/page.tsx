import type { Metadata } from "next"
import { ProductsIndex } from "@/components/studio/catalog/products-index"

export const metadata: Metadata = { title: "Products" }

export default function StudioProductsPage() {
  return <ProductsIndex />
}
