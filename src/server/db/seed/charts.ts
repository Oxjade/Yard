import "server-only"
import type { SeedModule } from "./types"

/**
 * Stub (F1). Cluster C replaces this module in wave 2 with its fixtures from Appendix D,
 * keeping the key. Version 0 never runs, so the seed index's imports always resolve.
 */
const seed: SeedModule = {
  key: "seed:charts",
  version: 0,
  async run() {},
}

export default seed
