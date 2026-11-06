import { DropsIndexSkeleton } from "@/components/market/editorial/route-skeletons"

/** Shown while /drops arrives on navigation. It sits in the (index) group so it never wraps /drops/[…], whose unknown addresses must answer with a real 404. */
export default function Loading() {
  return <DropsIndexSkeleton />
}
