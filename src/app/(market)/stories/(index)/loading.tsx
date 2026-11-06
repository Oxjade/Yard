import { StoriesIndexSkeleton } from "@/components/market/editorial/route-skeletons"

/** Shown while /stories arrives on navigation. It sits in the (index) group so it never wraps /stories/[…], whose unknown addresses must answer with a real 404. */
export default function Loading() {
  return <StoriesIndexSkeleton />
}
