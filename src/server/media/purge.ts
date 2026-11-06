import "server-only"
import { NotImplemented } from "../http/errors"

/** Hourly: unattached inbox files older than 24 h; post and place files unreferenced for 7 days. File first, then row. */
export async function purgeOrphans(): Promise<{ files: number }> {
  throw new NotImplemented("media.purgeOrphans")
}
