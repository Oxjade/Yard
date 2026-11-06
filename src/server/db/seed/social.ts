import "server-only"
import { like } from "drizzle-orm"
import { db } from "../tx"
import { socialPosts } from "../schema"
import type { SeedContext, SeedModule } from "./types"

/**
 * Social sample posts (cluster S, Appendix D). `source 'sample'`, published, `sample = true`, using
 * the brands' own photography (/media/… paths: seed rows are the only ones that carry them).
 * Lagos Static: 6 (2 featured) plus sp_seed_ls_removed, an upload Yard removed ("Misleading
 * claim") for the locked-post test. Gridlock Supply: 6 including sp_seed_gl_1 (reported in
 * rp_seed_post by M's safety seed). Null Form: 4. Paper Riot: 4. No social accounts: brands
 * connect through the development sandbox.
 */
type Spec = { n: string; image: string; alt?: string; caption: string; daysAgo: number; products?: string[]; featured?: number }

const fixtures: Record<string, { prefix: string; posts: Spec[] }> = {
  b_lagos_static: {
    prefix: "ls",
    posts: [
      { n: "1", image: "fashion/tops/6", caption: "Third Mainland test prints on the Yaba table. Every back print is pulled by hand.", daysAgo: 2, products: ["third-mainland-tee"], featured: 2 },
      { n: "2", image: "fashion/streetwear-editorial/0", caption: "Danfo route map in puff print on 480gsm fleece. Washed black and signal orange.", daysAgo: 4, products: ["danfo-heavyweight-hoodie"], featured: 1 },
      { n: "3", image: "fashion/streetwear-editorial/1", caption: "Fit check on the bridge before sunrise.", daysAgo: 7, products: ["danfo-heavyweight-hoodie", "third-mainland-tee"] },
      { n: "4", image: "fashion/outerwear/0", caption: "Cutting the moto jacket in vegetable-tanned goat leather. A run of 40.", daysAgo: 11, products: ["static-moto-jacket"] },
      { n: "5", image: "fashion/bottoms/1", caption: "Cargo trousers in washed ripstop, back in Bone.", daysAgo: 15, products: ["yaba-cargo-trouser"] },
      { n: "6", image: "fashion/streetwear-editorial/3", caption: "Packing orders for Friday's dispatch.", daysAgo: 20 },
    ],
  },
  b_gridlock_supply: {
    prefix: "gl",
    posts: [
      { n: "1", image: "objects/sneakers/7", caption: "GLS Court in triple white. The only pair you'll ever need, guaranteed.", daysAgo: 1, products: ["gls-court"], featured: 1 },
      { n: "2", image: "objects/headwear/3", caption: "Laundromat restock this Saturday, in store from noon.", daysAgo: 3, products: ["laundromat-trucker"] },
      { n: "3", image: "fashion/outerwear/3", caption: "Bodega sherpa, cut for the walk to the train.", daysAgo: 6, products: ["bodega-sherpa-fleece"] },
      { n: "4", image: "objects/sneakers/2", caption: "GLS Low on the Lower East Side.", daysAgo: 9, products: ["gls-low"] },
      { n: "5", image: "lifestyle/creative/2", caption: "Block deck graphics, hand-drawn by the crew.", daysAgo: 13, products: ["block-skate-deck"] },
      { n: "6", image: "objects/bags/0", caption: "Commuter backpack, everything in its place.", daysAgo: 18, products: ["commuter-backpack"] },
    ],
  },
  b_null_form: {
    prefix: "nf",
    posts: [
      { n: "1", image: "objects/sneakers/3", caption: "NF-01 sole study. Every layer cut in Seongsu.", daysAgo: 2, products: ["nf-01-sole-study"], featured: 1 },
      { n: "2", image: "objects/sneakers/5", caption: "NF-02 Court, built for long days on concrete.", daysAgo: 5, products: ["nf-02-court"] },
      { n: "3", image: "objects/sneakers/11", caption: "Chukka in suede, before the last stitch.", daysAgo: 9, products: ["nf-03-chukka"] },
      { n: "4", image: "objects/sneakers/1", caption: "Trail boot prototype, round three.", daysAgo: 14, products: ["nf-05-trail-boot"] },
    ],
  },
  b_paper_riot: {
    prefix: "pr",
    posts: [
      { n: "1", image: "lifestyle/art/1", caption: "Pigment study, layer four of six.", daysAgo: 3, products: ["pigment-study-01"], featured: 1 },
      { n: "2", image: "lifestyle/art/3", caption: "Poster series 03 drying on the line in Maboneng.", daysAgo: 6, products: ["poster-series-03"] },
      { n: "3", image: "lifestyle/creative/0", caption: "Zine volume 4 is collated and stapled by hand.", daysAgo: 10, products: ["riot-zine-vol-4"] },
      { n: "4", image: "lifestyle/creative/1", caption: "Basement sessions, pressed to vinyl.", daysAgo: 16, products: ["basement-sessions-vinyl"] },
    ],
  },
}

const productId = (slug: string) => `p_${slug.replace(/-/g, "_")}`

function rows(ctx: SeedContext) {
  const day = Date.parse(`${ctx.seedDay}T12:00:00Z`)
  const out: (typeof socialPosts.$inferInsert)[] = []
  for (const [brandId, f] of Object.entries(fixtures)) {
    const brand = ctx.brandById.get(brandId)
    if (!brand) continue
    for (const p of f.posts) {
      const im = ctx.img(p.image, p.alt)
      const products = (p.products ?? []).map(productId).filter((id) => ctx.products.some((x) => x.id === id && x.brandId === brandId))
      out.push({
        id: `sp_seed_${f.prefix}_${p.n}`,
        brandId,
        source: "sample",
        kind: "image",
        caption: p.caption,
        media: [{ src: im.src, alt: im.alt, width: im.width, height: im.height, kind: "image" }],
        productIds: products,
        postedAt: new Date(day - p.daysAgo * 86_400_000 - (Number(p.n) || 0) * 60_000),
        visibility: "published",
        featured: !!p.featured,
        featureOrder: p.featured ?? null,
        moderationStatus: "ok",
        sample: true,
        updatedAt: new Date(day),
      })
    }
  }
  // The locked-post test: an upload Yard removed.
  const removed = ctx.img("fashion/campaign/2")
  out.push({
    id: "sp_seed_ls_removed",
    brandId: "b_lagos_static",
    source: "upload",
    kind: "image",
    caption: "Guaranteed authentic vintage. The only one in Lagos.",
    media: [{ src: removed.src, alt: removed.alt, width: removed.width, height: removed.height, kind: "image" }],
    productIds: [],
    postedAt: new Date(day - 8 * 86_400_000),
    visibility: "hidden",
    featured: false,
    moderationStatus: "removed",
    removedReason: "Misleading claim",
    sample: true,
    createdBy: "u_b_tobi",
    updatedAt: new Date(day - 6 * 86_400_000),
  })
  return out
}

const seed: SeedModule = {
  key: "seed:social",
  version: 1,
  requires: ["users:u_b_tobi"],
  async run(ctx) {
    const d = await db()
    // Reseed: this module's own rows only (fixed ids).
    await d.delete(socialPosts).where(like(socialPosts.id, "sp\\_seed\\_%"))
    await d.insert(socialPosts).values(rows(ctx)).onConflictDoNothing()
  },
}

export default seed
