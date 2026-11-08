import { route } from "@/server/http/route"
import { publicCollection } from "@/server/catalog/public"
import { idParam } from "@/server/catalog/params"

/** GET /api/catalog/storefronts/{handle}/collections/{collection id or handle} (public): one published collection with its public product ids. */
export const GET = route({ auth: "public", rate: { key: "catalog.collection", limit: 120, windowSec: 60, anonGlobal: 3000 }, cache: { public: 30, swr: 60 } }, async ({ params }) =>
  publicCollection(idParam(params, "handle"), idParam(params, "collection")),
)
