import { sessionSnapshot } from "@/server/auth/profiles"
import { route } from "@/server/http/route"

/**
 * GET /api/session (§2.1): who this browser is on each surface, plus whether demo sign-in is
 * on. Narrow profiles only; no token fields. Every chrome learns the session from here (no
 * layout reads cookies, §1.6 rule 4).
 */
export const GET = route({ auth: "public", rate: { key: "session.read", limit: 240, windowSec: 60, anonGlobal: 20_000 } }, async () => sessionSnapshot())
