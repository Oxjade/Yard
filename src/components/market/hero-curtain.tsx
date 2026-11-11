import Image from "next/image"
import { heroCurtain } from "@/lib/site-images"
import "./hero-curtain.css"

/** How many tiles of the first set load straight away: what fits across a 1440 px screen. */
const EAGER = 3

/**
 * The production welcome hero's background (live-discover-hero.tsx): the founding brands'
 * photos as a row of tall portrait tiles gliding right to left, a "sliding curtain".
 *
 * Pure CSS, no client script: the track holds the photos twice and moves by exactly one set
 * (-50%) per loop, so the copy takes the original's place and the loop has no seam. Each tile
 * carries its own trailing gap (padding, not flex gap) so one set is exactly half the track.
 * It pauses while the headline block is hovered or the hero holds focus, and under reduced
 * motion it stands still (hero-curtain.css). The tiles size from the hero's height (aspect
 * 3/4), so nothing shifts as the photos arrive; until then each tile is a warm neutral taken
 * from the photos.
 *
 * Put it after the hero's text: it sits behind (-z-10) and is read after the headline. The
 * first set is described for screen readers; the copy is hidden from them.
 */
export function HeroCurtain() {
  return (
    <div className="hero-settle absolute inset-0 -z-10 overflow-hidden">
      <div className="curtain-track flex h-[60%] w-max md:h-full">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex h-full shrink-0" aria-hidden={copy === 1 || undefined} aria-label={copy === 0 ? "Photos from Yard's founding brands" : undefined}>
            {heroCurtain.map((p, i) => (
              <li key={p.src} className="h-full shrink-0 pr-1 md:pr-1.5">
                <div className="relative aspect-[3/4] h-full overflow-hidden curtain-tile">
                  <Image
                    src={p.src}
                    alt={copy === 0 ? p.alt : ""}
                    fill
                    loading={copy === 0 && i < EAGER ? "eager" : "lazy"}
                    sizes="(min-width: 768px) 720px, 300px"
                    className="object-cover"
                    style={{ objectPosition: p.position }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ))}
      </div>
      <div className="curtain-scrim absolute inset-0" aria-hidden />
    </div>
  )
}
