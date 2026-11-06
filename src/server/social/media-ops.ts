import "server-only"
import { rm } from "node:fs/promises"
import path from "node:path"
import { and, eq, inArray } from "drizzle-orm"
import { afterCommit, db } from "../db"
import { mediaAssets, socialAccounts } from "../db/schema"
import { getEnv } from "../env"
import { NotImplemented } from "../http/errors"
import { log } from "../log"
import { refreshVisibility } from "../media"

/**
 * Media side effects of post changes (§5.4 step 7). Visibility is derived by F2's
 * media.refreshVisibility inside the same transaction as every post change.
 */
export async function refreshMedia(ids: string[]) {
  if (!ids.length) return
  try {
    await refreshVisibility([...new Set(ids)])
  } catch (e) {
    // Until F2's media module replaces its stub, files simply stay private (the safe default).
    if (e instanceof NotImplemented) {
      log.once("social:refresh-stub", "warn", "[yard] social: media.refreshVisibility is still a stub; post media stay private until F2 implements it.")
      return
    }
    throw e
  }
}

/**
 * Deletes imported media at once (data deletion, "Delete imported posts"): the rows in the
 * caller's transaction, the files after commit. Only social_import rows of `brandIds` are touched,
 * and each file path is checked to stay inside the uploads folder.
 */
export async function deleteImportedMedia(ids: string[], brandIds: string[]) {
  if (!ids.length || !brandIds.length) return 0
  const d = await db()
  await d.update(socialAccounts).set({ avatarMediaId: null }).where(inArray(socialAccounts.avatarMediaId, ids))
  const rows = await d
    .delete(mediaAssets)
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.purpose, "social_import"), inArray(mediaAssets.brandId, brandIds)))
    .returning({ storagePath: mediaAssets.storagePath })
  const root = path.join(getEnv().envDir, "uploads")
  afterCommit(async () => {
    for (const r of rows) {
      if (r.storagePath.startsWith("/")) continue
      const file = path.resolve(root, r.storagePath)
      if (!file.startsWith(root + path.sep)) continue
      await rm(file, { force: true }).catch((e) => log.error("[yard] social: couldn't delete an imported file", e))
    }
  })
  return rows.length
}
