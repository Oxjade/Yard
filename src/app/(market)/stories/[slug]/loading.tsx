import { StorySkeleton } from "@/components/market/editorial/route-skeletons"

/** Inside the slug check in layout.tsx, so unknown stories still get a real 404. */
export default function Loading() {
  return <StorySkeleton />
}
