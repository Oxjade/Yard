import "server-only"
import { purgeOrphans } from "./purge"

/**
 * Media contract (F1 signatures; F2 implements uploads, serving, visibility and purge, §5.4).
 * The module files (store, sniff, strip-metadata, serve, visibility, purge) hold the signatures.
 */
export const IMPL: string = "stub"

export { refreshVisibility } from "./visibility"
export { purgeOrphans }

/** `/api/media/<id>` (+ `?as=` for private media): the only src the server ever builds for stored media. */
export function mediaSrc(id: string, as?: "shopper" | "brand" | "admin") {
  return `/api/media/${encodeURIComponent(id)}${as ? `?as=${as}` : ""}`
}

export const jobs = { purgeOrphans }
