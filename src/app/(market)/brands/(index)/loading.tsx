import { BrandDirectorySkeleton } from "@/components/market/editorial/route-skeletons"

/** Shown while /brands arrives on navigation. It sits in the (index) group so it never wraps /brands/[…], whose unknown addresses must answer with a real 404. */
export default function Loading() {
  return <BrandDirectorySkeleton />
}
