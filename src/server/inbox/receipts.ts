import "server-only"
import { eq, inArray } from "drizzle-orm"
import { db } from "../db"
import { appMeta } from "../db/schema"

/**
 * Read-receipt privacy (§4.4). A shopper's reads while receipts are off still move their own
 * counters (last_read_seq/at), so turning receipts back on must not reveal them. Until
 * conversation_participants gets its own shared receipt position (requested from F1), the time
 * receipts were last turned on is kept as a marker: the brand sees the shopper's read position
 * only when that read happened after it. Turning receipts on therefore never backfills.
 */

const key = (userId: string) => `inbox:receipts-on:${userId}`

/** When this shopper last turned receipts on, or null when they never turned them off. */
export async function receiptsOnSince(userId: string): Promise<Date | null> {
  const d = await db()
  const [row] = await d.select({ value: appMeta.value }).from(appMeta).where(eq(appMeta.key, key(userId))).limit(1)
  const since = (row?.value as { since?: unknown } | undefined)?.since
  if (typeof since !== "string") return null
  const at = new Date(since)
  return Number.isNaN(at.getTime()) ? null : at
}

/** Records that receipts were turned on now (inside the caller's transaction). */
export async function markReceiptsOn(userId: string, at: Date) {
  const d = await db()
  const value = { since: at.toISOString() }
  await d.insert(appMeta).values({ key: key(userId), value }).onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: at } })
}

/** Forgets the markers (restore steps: reseed and the test-shopper cleanup). */
export async function clearReceiptMarkers(userIds: string[]) {
  if (!userIds.length) return
  const d = await db()
  await d.delete(appMeta).where(inArray(appMeta.key, userIds.map(key)))
}

/** Whether a read made at `readAt` may be shown to the brand, given the marker. */
export const readVisibleToBrand = (readAt: Date | null, since: Date | null) => !since || (!!readAt && readAt.getTime() >= since.getTime())
