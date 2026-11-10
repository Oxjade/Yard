import "server-only"
import { readdir, stat, unlink } from "node:fs/promises"
import path from "node:path"
import { sql } from "drizzle-orm"
import { db } from "../db"
import { log } from "../log"
import { resolveStored, uploadsRoot } from "./store"
import { referencedAtAll } from "./visibility"

/**
 * The hourly media purge (§1.3 Schedulers, §5.4 step 8). Deletes:
 *  - inbox attachments never attached to a message, older than 24 h;
 *  - post, import and place files that nothing references (no post of any visibility, no place,
 *    no event, no account avatar) 7 days after they were last referenced (`unreferenced_at`, kept
 *    by refreshVisibility), or 7 days after upload for a file that was never used;
 *  - temp files of interrupted uploads older than an hour.
 * The file goes first, then the row, and the row is deleted only if it still qualifies.
 */
const orphan = sql`(
  (m.purpose = 'inbox_attachment' and m.attached_at is null and m.created_at < now() - interval '24 hours'
     and not exists (select 1 from message_attachments ma where ma.media_id = m.id))
  or (m.purpose in ('social_post', 'social_import', 'location_image', 'onboarding_image')
     and coalesce(m.unreferenced_at, m.created_at) < now() - interval '7 days' and not ${referencedAtAll})
)`

type Candidate = { id: string; storage_path: string }

export async function purgeOrphans(): Promise<{ files: number; rows: number; tmp: number }> {
  const d = await db()
  const found = (await d.execute(sql`select m.id, m.storage_path from media_assets m where ${orphan} order by m.created_at limit 500`)) as unknown as { rows: Candidate[] }
  let files = 0
  const ids: string[] = []
  for (const c of found.rows) {
    const file = c.storage_path.startsWith("/media/") ? null : resolveStored(c.storage_path)
    if (file) {
      try {
        await unlink(file)
        files++
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          log.error(`[yard] purge: couldn't delete ${c.id}`, e)
          continue
        }
      }
    }
    ids.push(c.id)
  }
  let rows = 0
  if (ids.length) {
    const gone = (await d.execute(sql`delete from media_assets m where m.id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}) and ${orphan} returning m.id`)) as unknown as { rows: { id: string }[] }
    rows = gone.rows.length
  }
  const tmp = await purgeTmp()
  if (files || rows || tmp) log.info(`[yard] media purge: ${files} files, ${rows} rows, ${tmp} temp files`)
  return { files, rows, tmp }
}

async function purgeTmp() {
  const dir = path.join(uploadsRoot(), "tmp")
  let n = 0
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  for (const name of names) {
    const p = path.join(dir, name)
    try {
      if (Date.now() - (await stat(p)).mtimeMs > 3600_000) {
        await unlink(p)
        n++
      }
    } catch {
      /* gone already */
    }
  }
  return n
}
