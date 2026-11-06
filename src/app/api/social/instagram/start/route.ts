import { startRoute } from "@/server/social/http"

/** POST /api/social/instagram/start (brand, social.connect). Returns { url }; GET is 405 (§5.5). */
export const POST = startRoute("instagram")
