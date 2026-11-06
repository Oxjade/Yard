import { metaRoute } from "@/server/social/http"

/** POST /api/social/instagram/deauthorize (Meta signed_request). 404 unless Instagram is configured. */
export const POST = metaRoute("deauthorize")
