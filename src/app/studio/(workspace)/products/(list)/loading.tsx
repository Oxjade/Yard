import { ProductsPageSkeleton } from "@/components/studio/catalog/skeletons"

/*
 * In the (list) group so it wraps only the products list. A loading boundary above [id]
 * would start the response before that page checks the id, turning its 404 into a 200.
 */
export default function Loading() {
  return <ProductsPageSkeleton />
}
