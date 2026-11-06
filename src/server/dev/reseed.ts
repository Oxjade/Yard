import "server-only"
import { reseedModule, seedStatus } from "../db/seed"

/** POST /api/dev/reseed?module=<key> (dev only): re-runs one seed module now (§1.5). */
export { reseedModule, seedStatus }
