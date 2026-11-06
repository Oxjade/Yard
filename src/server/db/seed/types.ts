import "server-only"
import type { brandApplications, adminTeam, platformUsers } from "@/lib/data/admin"
import type { brandById } from "@/lib/data/brands"
import type { drops } from "@/lib/data/catalog"
import type { img } from "@/lib/data/media"
import type { customerOrders, merchantOrders, shoppers } from "@/lib/data/orders"
import type { products } from "@/lib/data/products"
import type { hash, pick, rand, randInt } from "@/lib/data/seed"

/**
 * What every seed module receives (§1.5). Everything here is pure data from src/lib/data/*, plus
 * the two clocks: `seedDay` (today's UTC date at the first seed, so new sample activity reads
 * "2 days ago") and `now`. Historical sample orders keep DEMO_TODAY (2026-11-05).
 */
export type SeedContext = {
  seedDay: string
  now: Date
  rand: typeof rand
  hash: typeof hash
  pick: typeof pick
  randInt: typeof randInt
  brandById: typeof brandById
  products: typeof products
  drops: typeof drops
  merchantOrders: typeof merchantOrders
  customerOrders: typeof customerOrders
  shoppers: typeof shoppers
  platformUsers: typeof platformUsers
  adminTeam: typeof adminTeam
  brandApplications: typeof brandApplications
  img: typeof img
  /**
   * Copies a /public/media file into ${dataDir}/<env>/uploads/<purpose>/<ownerId>/ and returns the
   * storage path relative to the uploads folder, so private seeded media has no public URL.
   */
  copyPrivateFixture: (publicPath: string, purpose: string, ownerId: string, fileName?: string) => string
}

/**
 * A seed module. `version: 0` never runs (F1's stubs). `requires` lists fixed ids another module
 * seeds, as '<table>:<id>'; while one is missing the module waits (it is skipped without
 * recording its version and retried at the next boot or reseed).
 */
export type SeedModule = {
  key: `seed:${string}`
  version: number
  requires?: string[]
  /** Runs inside one transaction: use db() and the helpers, never network or slow I/O. */
  run: (ctx: SeedContext) => Promise<void>
}
