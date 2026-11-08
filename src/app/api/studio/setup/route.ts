import { route } from "@/server/http/route"
import { setupStatus } from "@/server/setup"

/** GET /api/studio/setup (§7.4): the active brand's setup state for the Overview card. Any member may read it. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.setup", limit: 60, windowSec: 60 } }, async ({ actor }) => setupStatus(actor))
