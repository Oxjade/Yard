import { DropDetailSkeleton } from "@/components/market/editorial/route-skeletons"

/** Inside the slug check in layout.tsx, so unknown drops still get a real 404. */
export default function Loading() {
  return <DropDetailSkeleton />
}
