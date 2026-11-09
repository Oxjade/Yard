import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ProductEditorRoute } from "@/components/studio/catalog/product-editor"
import { productById, products } from "@/lib/data"
import { STUDIO_BRAND_ID } from "@/lib/data/brands"

/**
 * The id is checked before anything renders so an unknown product answers with a real 404.
 * That check needs the URL, so this segment may block; the brand's shipped products are
 * prerendered below.
 */
export const instant = false
/**
 * The whole route is static output, so an address that wasn't prerendered waits for its own
 * render (where the check runs before anything is sent) instead of being served the shared
 * fallback shell with a 200 first.
 */
export const ensureStatic = "navigation"

/** Local ids are p_<slug>; live catalogue ids are p_<base36 timestamp><base64url random>. */
const PRODUCT_ID = /^p_[A-Za-z0-9_-]+$/

export function generateStaticParams() {
  return products.filter((p) => p.brandId === STUDIO_BRAND_ID).map((p) => ({ id: p.id }))
}

export async function generateMetadata({ params }: PageProps<"/studio/products/[id]">): Promise<Metadata> {
  const { id } = await params
  return { title: productById.get(id)?.name ?? "Edit product" }
}

export default async function EditProductPage({ params }: PageProps<"/studio/products/[id]">) {
  const { id } = await params
  const shipped = productById.get(id)
  if (shipped ? shipped.brandId !== STUDIO_BRAND_ID : !PRODUCT_ID.test(id)) notFound()
  return <ProductEditorRoute id={id} />
}
