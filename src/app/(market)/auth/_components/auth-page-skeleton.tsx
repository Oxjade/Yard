import { Bone } from "@/components/feedback/skeletons"

/**
 * Fallback for the /auth/* pages while their search params resolve. It follows their plain
 * layout (display heading, one line of status, and the form for the pages that have one) inside
 * the same page container, so nothing jumps when the page arrives.
 */
export function AuthPageSkeleton({ form = false }: { form?: boolean }) {
  return (
    <div role="status" aria-label="Loading">
      <div aria-hidden>
        <Bone className="h-12 w-72 max-w-full md:h-16 md:w-[28rem]" />
        <Bone className="mt-5 h-4 w-full max-w-xl" />
        {form ? (
          <div className="mt-6 grid max-w-md gap-4">
            <div className="grid gap-1.5">
              <Bone className="h-3.5 w-28" />
              <Bone className="h-10 w-full" />
            </div>
            <div className="grid gap-1.5">
              <Bone className="h-3.5 w-32" />
              <Bone className="h-10 w-full" />
            </div>
            <Bone className="h-10 w-full" />
          </div>
        ) : null}
      </div>
    </div>
  )
}
