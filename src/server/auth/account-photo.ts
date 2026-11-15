import "server-only"
import { eq } from "drizzle-orm"
import { writeAudit } from "../audit"
import { db, withTx } from "../db"
import { users } from "../db/schema"
import { notFound, restricted, rule } from "../http/errors"
import { log } from "../log"
import { refreshVisibility } from "../media"
import type { UploadTarget } from "../media/authorize"
import { ingestUpload } from "../media/upload"
import { accountOf, type AccountActor } from "./account"
import { activeRestriction } from "./dal"
import type { RequestMeta } from "./identity"

/**
 * The signed-in person's profile photo (shopper Settings and Studio "Your account": one `users`
 * row either way). The file goes through the uploads pipeline (size caps, sniffing, metadata
 * strip) as purpose account_photo, owned by the user; users.photo_media_id points at it. A new
 * photo replaces the old one, which becomes unreferenced and is purged after 7 days. Photos are
 * private: serve.ts shows them to the person, their teammates, brands they talk to or buy from,
 * and admins. Demo accounts can't change their photo (like their email). An uploads restriction
 * pauses photo changes too; removing your photo always works.
 */

const untilText = (until: Date | null) => (until ? ` until ${until.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "")

async function loadUser(userId: string) {
  const d = await db()
  const [u] = await d.select({ id: users.id, name: users.name, demo: users.demo, photoMediaId: users.photoMediaId }).from(users).where(eq(users.id, userId)).limit(1)
  if (!u) throw notFound()
  return u
}

export async function setAccountPhoto(actor: AccountActor, req: Request, meta: RequestMeta) {
  const user = await loadUser(actor.userId)
  if (user.demo) throw rule("Demo accounts can't change their photo.")
  const r = await activeRestriction("user", actor.userId, "uploads")
  if (r) throw restricted(`Uploading is paused on your account${untilText(r.until)}.`)
  const target: UploadTarget = { purpose: "account_photo", ownerKind: "user", ownerId: actor.userId, brandId: null, conversationId: null, targetBrandId: null }
  const row = await ingestUpload(actor, target, req)
  try {
    await withTx(async () => {
      const d = await db()
      const [before] = await d.select({ photoMediaId: users.photoMediaId }).from(users).where(eq(users.id, actor.userId)).limit(1)
      await d.update(users).set({ photoMediaId: row.id }).where(eq(users.id, actor.userId))
      await refreshVisibility([row.id, before?.photoMediaId ?? ""])
      await writeAudit({
        actor: { kind: actor.kind, id: actor.userId, name: user.name },
        action: before?.photoMediaId ? "account.photo_replaced" : "account.photo_added",
        target: user.name,
        subjectType: "user",
        subjectId: actor.userId,
        ipHash: meta.ipHash,
        meta: { mediaId: row.id, previous: before?.photoMediaId ?? null },
      })
    })
  } catch (e) {
    // The stored file is unreferenced now; the hourly purge removes it after its grace period.
    log.error("[yard] saving the account photo failed after upload", e)
    throw e
  }
  return accountOf(actor.userId, actor.kind)
}

export async function removeAccountPhoto(actor: AccountActor, meta: RequestMeta) {
  const user = await loadUser(actor.userId)
  if (user.demo) throw rule("Demo accounts can't change their photo.")
  if (!user.photoMediaId) return accountOf(actor.userId, actor.kind)
  await withTx(async () => {
    const d = await db()
    await d.update(users).set({ photoMediaId: null }).where(eq(users.id, actor.userId))
    await refreshVisibility([user.photoMediaId!])
    await writeAudit({ actor: { kind: actor.kind, id: actor.userId, name: user.name }, action: "account.photo_removed", target: user.name, subjectType: "user", subjectId: actor.userId, ipHash: meta.ipHash, meta: { mediaId: user.photoMediaId } })
  })
  return accountOf(actor.userId, actor.kind)
}
