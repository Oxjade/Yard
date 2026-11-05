import Image from "next/image"
import Link from "next/link"
import { SponsoredTag } from "@/components/market/sponsored-tag"
import { brandById } from "@/lib/data/brands"
import { cn } from "@/lib/utils"
import type { CuratedCollection } from "@/lib/data/types"

/** A curated collection as a photographic tile. A sponsored edit always names its sponsor. */
export function CollectionTile({ collection, className }: { collection: CuratedCollection; className?: string }) {
  const sponsor = collection.sponsoredBy ? brandById.get(collection.sponsoredBy) : undefined
  return (
    <Link
      href={`/collections/${collection.slug}`}
      className={cn("group relative isolate flex min-h-[300px] flex-col justify-end overflow-hidden rounded-lg bg-card p-5 md:min-h-[380px]", className)}
    >
      <Image src={collection.image.src} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="-z-10 object-cover transition-transform duration-[900ms] ease-out-quint group-hover:scale-[1.04]" />
      <span className="scrim-b absolute inset-0 -z-10" aria-hidden />
      {sponsor ? <SponsoredTag by={sponsor.name} className="absolute top-4 left-4" /> : null}
      <h3 className="font-display text-display-sm text-ink">{collection.name}</h3>
      <p className="mt-2 max-w-sm text-sm text-ink/80">{collection.description}</p>
      <p className="mt-3 text-xs text-ink-2">
        {collection.brandIds.length} brands, {collection.productIds.length} pieces
      </p>
    </Link>
  )
}
