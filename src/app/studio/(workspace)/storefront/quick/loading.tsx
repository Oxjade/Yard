/** Set up your shop's own loading state (not the full editor's skeleton). */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto grid w-full max-w-xl gap-4">
      <span className="skeleton h-4 w-40 rounded" />
      <span className="skeleton h-2 w-full rounded-full" />
      <span className="skeleton mt-4 h-9 w-3/4 rounded" />
      <span className="skeleton h-56 w-full rounded-2xl" />
    </div>
  )
}
