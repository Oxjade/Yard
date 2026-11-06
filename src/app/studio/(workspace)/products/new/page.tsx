import type { Metadata } from "next"
import { ProductEditorRoute } from "@/components/studio/catalog/product-editor"

export const metadata: Metadata = { title: "New product" }

export default function NewProductPage() {
  return <ProductEditorRoute />
}
