import { Bone } from "@/components/feedback/skeletons"
import { CatalogListingSkeleton } from "@/components/market/catalog/catalog-skeleton"

/**
 * Inside the slug check in layout.tsx, so unknown categories still get a real 404. The page's
 * shape in bones: the photo banner with its back link, title and counts, the brand row, then
 * the listing, whose skeleton is the one status announcement ("Loading pieces").
 */
export default function Loading() {
  return (
    <div>
      <header className="relative isolate overflow-hidden" aria-hidden>
        <Bone className="absolute inset-0 -z-10 rounded-none" />
        <span className="scrim-b absolute inset-0 -z-10" />
        <div className="mx-auto flex min-h-[360px] max-w-page flex-col justify-end px-4 pt-28 pb-8 md:min-h-[460px] md:px-8 md:pb-12">
          <Bone className="h-4 w-28" />
          <Bone className="mt-4 h-9 w-2/3 max-w-sm md:h-16" />
          <Bone className="mt-5 h-4 w-full max-w-md" />
          <Bone className="mt-4 h-3.5 w-40" />
        </div>
      </header>

      <div className="mx-auto max-w-page px-4 md:px-8">
        <section className="mt-24 md:mt-32" aria-hidden>
          <Bone className="mb-6 h-7 w-64 max-w-full md:mb-8 md:h-12" />
          <div className="-mx-4 flex gap-3 overflow-hidden px-4 *:w-[78vw] *:shrink-0 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0 sm:*:w-auto lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Bone key={i} className="h-[62px] rounded-lg" />
            ))}
          </div>
        </section>

        <section className="mt-24 md:mt-32">
          <Bone className="mb-6 h-7 w-56 max-w-full md:mb-8 md:h-12" />
          <CatalogListingSkeleton />
        </section>
      </div>
    </div>
  )
}
