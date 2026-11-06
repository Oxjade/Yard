import { CuratedCollectionSkeleton } from "@/components/market/editorial/route-skeletons"

/** Inside the slug check in layout.tsx, so unknown edits still get a real 404. */
export default function Loading() {
  return <CuratedCollectionSkeleton />
}
