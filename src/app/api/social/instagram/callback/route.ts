import { callbackRoute } from "@/server/social/http"

/** GET /api/social/instagram/callback: state, exchange, sealed tokens, then 302 to Studio › Social. */
export const GET = callbackRoute("instagram")
