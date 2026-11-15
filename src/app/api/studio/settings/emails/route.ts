import { studioEmailSettingsBody } from "@/lib/api/contracts/brand-emails"
import { studioEmailSettings, updateStudioEmailSettings } from "@/server/catalog/brand-emails"
import { route } from "@/server/http/route"

/** GET /api/studio/settings/emails → { nudges, canEdit }: whether the active brand gets reminder emails from Yard. Any member may read it. */
export const GET = route({ auth: "brand", permission: "any_member", rate: { key: "studio.email_settings", limit: 60, windowSec: 60 } }, async ({ actor }) => studioEmailSettings(actor))

/** PUT /api/studio/settings/emails { nudges } (owners and admins): reminder emails on or off. Decision emails always send. Audited. */
export const PUT = route({ auth: "brand", permission: "any_member", body: studioEmailSettingsBody, rate: { key: "studio.email_settings.write", limit: 30, windowSec: 60 } }, async ({ actor, body, ipHash }) => updateStudioEmailSettings(actor, body, ipHash))
