import { route } from "@/server/http/route"
import { sendTestPush } from "@/server/studio-app"

/** POST /api/studio/push/test (any member) → { devices, delivered }: a test Studio push to the caller's own Studio devices. */
export const POST = route({ auth: "brand", permission: "any_member", rate: { key: "studio.push_test", limit: 5, windowSec: 600 } }, async ({ actor }) => sendTestPush(actor))
