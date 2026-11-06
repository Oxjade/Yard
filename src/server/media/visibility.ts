import "server-only"
import { NotImplemented } from "../http/errors"

/**
 * Derives media visibility from what references it (§5.4 step 7). Runs inside the same
 * transaction as every change that can affect it. A file is public only while a published, ok
 * post or a published, approved place or event of a listed brand references it.
 */
export async function refreshVisibility(mediaIds: string[]): Promise<void> {
  void mediaIds
  throw new NotImplemented("media.refreshVisibility")
}
