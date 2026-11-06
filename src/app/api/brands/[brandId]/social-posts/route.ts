import { publicPostsQuery } from "@/lib/api/contracts/social"
import { route } from "@/server/http/route"
import { publicPosts } from "@/server/social/posts"

/**
 * GET /api/brands/{brandId}/social-posts?source=&limit=&product=&pinned= (public): published, ok
 * posts of a listed brand Yard hasn't paused. `product` keeps posts tagging that piece ("Seen on
 * the feed"); `pinned` ids come first. Cache-Control: public, max-age=60.
 */
export const GET = route(
  { auth: "public", query: publicPostsQuery, cache: { public: 60 }, rate: { key: "social.feed", limit: 120, windowSec: 60, anonGlobal: 6000 } },
  async ({ params, query }) => publicPosts(params.brandId ?? "", query),
)
