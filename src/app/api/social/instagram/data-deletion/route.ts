import { metaRoute } from "@/server/social/http"

/** POST /api/social/instagram/data-deletion (Meta signed_request). 404 unless Instagram is configured. */
export const POST = metaRoute("data-deletion")
