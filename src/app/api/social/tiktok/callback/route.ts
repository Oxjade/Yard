import { callbackRoute } from "@/server/social/http"

/** GET /api/social/tiktok/callback: state and PKCE, exchange, sealed tokens, then 302 to Studio › Social. */
export const GET = callbackRoute("tiktok")
