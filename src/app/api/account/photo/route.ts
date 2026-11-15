import { removeAccountPhoto, setAccountPhoto } from "@/server/auth/account-photo"
import { metaOf } from "@/server/auth/http"
import { route } from "@/server/http/route"

type Actor = Parameters<typeof setAccountPhoto>[0]

/**
 * POST (or PUT) /api/account/photo?as=shopper|brand, one multipart field `file` → 200 { account }
 * with `photo` set. Adds or replaces the profile photo through the uploads pipeline: JPEG, PNG or
 * WebP (sniffed), at most 10 MB, 64–8000 px a side, metadata stripped. Content-Length is checked
 * before the body is read. Demo accounts → 422; an uploads restriction → 403 restricted.
 * 10 per 10 minutes and 30 a day per account.
 */
const upload = route(
  { auth: "multi", as: ["shopper", "brand"], csrf: "multipart", rate: { key: "account.photo", limit: 10, windowSec: 600, daily: 30 } },
  async ({ req, actor, ipHash }) => ({ account: await setAccountPhoto(actor as Actor, req, metaOf(req, ipHash)) }),
)
export const POST = upload
export const PUT = upload

/** DELETE /api/account/photo?as=shopper|brand → { account } with `photo: null`. Initials show instead. */
export const DELETE = route({ auth: "multi", as: ["shopper", "brand"], rate: { key: "account.photo.remove", limit: 20, windowSec: 600 } }, async ({ req, actor, ipHash }) => ({
  account: await removeAccountPhoto(actor as Actor, metaOf(req, ipHash)),
}))
