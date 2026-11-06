import { StorefrontSkeleton } from "@/components/feedback/skeletons"

/** Inside the handle check in layout.tsx, so unknown storefronts still get a real 404. */
export default function Loading() {
  return <StorefrontSkeleton />
}
