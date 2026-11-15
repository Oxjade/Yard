import "server-only"
import { eq } from "drizzle-orm"
import { db } from "../db"
import { users } from "../db/schema"
import { notFound } from "../http/errors"
import { refreshMedia, setMediaModeration } from "./content"
import { assertState, audit, notify, type DecisionCtx } from "./shared"

/**
 * Admin › Users: removes a person's profile photo (content.moderate). One transaction: the file is
 * marked removed (served to content moderators only, as other removed media, and left out of the
 * orphan purge so it stays until the account is erased), the account goes
 * back to initials, one audit row (user.photo_removed, with the reason), and the person gets a
 * notice with the reason (template account.photo_removed). They can add a new photo afterwards.
 */
export type PhotoRemovalDto = { id: string; name: string; photoSrc: null; removedMediaId: string }

export async function removeAccountPhoto(ctx: DecisionCtx, body: { id: string; reason: string }) {
  const d = await db()
  const [u] = await d.select({ id: users.id, name: users.name, email: users.email, photoMediaId: users.photoMediaId }).from(users).where(eq(users.id, body.id)).limit(1)
  if (!u) throw notFound()
  assertState(!!u.photoMediaId, `${u.name} has no profile photo — refreshed.`)
  const mediaId = u.photoMediaId!
  await d.update(users).set({ photoMediaId: null }).where(eq(users.id, u.id))
  await setMediaModeration([mediaId], "removed")
  await refreshMedia([mediaId])
  const entry = await audit(ctx, {
    action: "user.photo_removed",
    target: `${u.name}, ${u.email}: profile photo removed`,
    subjectType: "user",
    subjectId: u.id,
    reason: body.reason,
    meta: { mediaId },
  })
  await notify({ kind: "shopper", id: u.id }, { key: `photo-moderation:${mediaId}`, template: "account.photo_removed", vars: { reason: body.reason }, href: "/you/settings" })
  const item: PhotoRemovalDto = { id: u.id, name: u.name, photoSrc: null, removedMediaId: mediaId }
  return { item, audit: entry }
}
