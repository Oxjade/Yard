import { BrandCollectionSkeleton } from "@/components/market/editorial/route-skeletons"

/** Inside the collection check in layout.tsx, so unknown collections still get a real 404. */
export default function Loading() {
  return <BrandCollectionSkeleton />
}
