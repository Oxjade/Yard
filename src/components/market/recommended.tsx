"use client"

import { useMemo } from "react"
import { recommendProducts, trendingProducts } from "@/lib/data"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { ProductCard } from "./product-card"
import { Rail } from "./rail"
import { SectionHeader } from "./section-header"

/** Personal picks from follows, saves, interests and views. Guests see trending instead, and are told so. */
export function RecommendedForYou() {
  const hydrated = useHydrated()
  const user = useSession((s) => s.user)
  const interests = useSession((s) => s.interests)
  const aesthetics = useSession((s) => s.aesthetics)
  const following = useSaved((s) => s.following)
  const wishlist = useSaved((s) => s.wishlist)
  const viewed = useSaved((s) => s.recentlyViewed)

  const personal = hydrated && (user || following.length || wishlist.length || interests.length)
  const items = useMemo(
    () => (personal ? recommendProducts({ interests, aesthetics, following, wishlist, viewed }, 8) : trendingProducts(16).slice(8, 16)),
    [personal, interests, aesthetics, following, wishlist, viewed],
  )

  return (
    <section aria-labelledby="rec-title">
      <div id="rec-title">
        <SectionHeader
          title={personal ? "Picked for you" : "Worth a look"}
          description={
            personal
              ? "From the brands you follow, what you've saved and the categories you browse — with room for brands you haven't met yet."
              : "Follow a few brands or save a piece and this row starts learning what you like."
          }
          href="/shop"
        />
      </div>
      <Rail label="Recommended products">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </Rail>
    </section>
  )
}
