import { createPostsBody, studioPostsQuery } from "@/lib/api/contracts/social"
import { json, route } from "@/server/http/route"
import { createPosts, listStudioPosts } from "@/server/social/posts"

/** GET /api/studio/social/posts?source=&visibility= (any member): the active brand's posts and per-status counts. */
export const GET = route({ auth: "brand", permission: "inbox.read", query: studioPostsQuery }, async ({ actor, query }) => listStudioPosts(actor, query))

/** POST /api/studio/social/posts (content.publish): upload posts from the brand's own media ids. */
export const POST = route(
  { auth: "brand", permission: "content.publish", body: createPostsBody, rate: { key: "social.post", limit: 30, windowSec: 600 } },
  async ({ actor, body }) => json({ posts: await createPosts(actor, body) }, 201),
)
