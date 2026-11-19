import { studioPieces } from "@/server/catalog/importer/watch"
import { route } from "@/server/http/route"

/** GET /api/studio/catalog/website-pieces (any member) → { items, count, mayAdd, site }: "New from your website". */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.website_pieces", limit: 240, windowSec: 60 } }, async ({ actor }) => studioPieces(actor))
