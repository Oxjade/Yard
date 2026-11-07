import "server-only"
import { unlink } from "node:fs/promises"
import { sql } from "drizzle-orm"
import type { BrandActor } from "../auth/dal"
import { afterCommit, db, withTx } from "../db"
import { log } from "../log"
import { resolveStored } from "../media/store"
import { referencedAtAll } from "../media/visibility"

/**
 * Development only (the route 404s in production): lets A's kits and browser scripts remove the
 * place photos they uploaded, so the demo brands keep only their seeded media. Scoped to the
 * active brand's own `location_image` files that nothing references any more (the hourly purge
 * would delete them after 7 days anyway). Rows go in one transaction; files after commit.
 */
export async function discardUnusedPlacePhotos(actor: BrandActor, ids: string[]) {
  const list = [...new Set(ids)].slice(0, 50)
  if (!list.length) return { removed: [] as string[] }
  const rows = await withTx(async () => {
    const d = await db()
    const res = (await d.execute(sql`
      delete from media_assets m
      where m.id in (${sql.join(
        list.map((id) => sql`${id}`),
        sql`, `,
      )})
        and m.brand_id = ${actor.brandId} and m.purpose = 'location_image' and not ${referencedAtAll}
      returning m.id, m.storage_path`)) as unknown as { rows: { id: string; storage_path: string }[] }
    const gone = res.rows
    afterCommit(async () => {
      for (const r of gone) {
        const file = r.storage_path.startsWith("/media/") ? null : resolveStored(r.storage_path)
        if (!file) continue
        await unlink(file).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== "ENOENT") log.error(`[yard] around dev: couldn't delete ${r.id}`, e)
        })
      }
    })
    return gone
  })
  return { removed: rows.map((r) => r.id) }
}
