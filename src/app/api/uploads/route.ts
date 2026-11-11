import { uploadQuery } from "@/lib/api/contracts/uploads"
import { route, json } from "@/server/http/route"
import { handleUpload } from "@/server/media/upload"

/**
 * POST /api/uploads?purpose=<p>&as=shopper|brand|admin[&conversationId=<cv> | &brandId=<b>] (§5.4),
 * one multipart field `file`. Everything needed to authorise is in the URL: the server checks the
 * actor, the target and Content-Length before it reads a byte of the body. 10 per 10 minutes and
 * 100 a day per actor; 2 GB a day per brand.
 */
export const POST = route(
  {
    auth: "multi",
    as: ["shopper", "brand", "admin"],
    // Admins upload only founding brand logos and banners (authorizeAdminUpload).
    permission: { admin: "brands.founding" },
    csrf: "multipart",
    query: uploadQuery,
    rate: { key: "uploads", limit: 10, windowSec: 600, daily: 100 },
  },
  async ({ actor, query, req }) => json(await handleUpload(actor, query, req), 201),
)
