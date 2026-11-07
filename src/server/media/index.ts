import "server-only"
import { purgeOrphans } from "./purge"

/**
 * Media contract (§5.4): uploads, serving, derived visibility and the purge job. Other clusters
 * call refreshVisibility (inside the transaction that changed a reference), mediaSrc and
 * toMediaDto; the scheduler runs jobs.purgeOrphans hourly.
 */
export const IMPL: string = "F2-2026-11-06"

export { refreshVisibility, refreshBrandMediaVisibility, mediaIdsOf } from "./visibility"
export { mediaSrc, toMediaDto } from "./dto"
export { purgeOrphans }

export const jobs = { purgeOrphans }
