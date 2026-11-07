import { patchPostBody } from "@/lib/api/contracts/social"
import { noContent, route } from "@/server/http/route"
import { deletePost, patchPost } from "@/server/social/posts"

/** PATCH …/posts/{id} (content.publish) { visibility?, featured?, productIds?, caption? }. A removed post → 422. */
export const PATCH = route({ auth: "brand", permission: "content.publish", body: patchPostBody }, async ({ params, body }) => ({ post: await patchPost(params.id ?? "", body) }))

/** DELETE …/posts/{id} (content.publish): uploads only, removed ones included. Imports can only be hidden. */
export const DELETE = route({ auth: "brand", permission: "content.publish" }, async ({ params }) => {
  await deletePost(params.id ?? "")
  return noContent()
})
