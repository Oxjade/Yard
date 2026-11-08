import { myDrops } from "@/server/drops/service"
import { route } from "@/server/http/route"

/** GET /api/drops/me: the shopper's draw entries (with results and purchase windows) and drop reminders. */
export const GET = route({ auth: "shopper", rate: { key: "drops.me", limit: 120, windowSec: 60 } }, async ({ actor }) => myDrops(actor.userId))
