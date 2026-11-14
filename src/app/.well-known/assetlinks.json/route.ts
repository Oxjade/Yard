import { assetLinks } from "@/server/app-links"
import { route } from "@/server/http/route"

/**
 * GET /.well-known/assetlinks.json: Android App Links for the Yard app (space.yardstore.app),
 * from ANDROID_CERT_SHA256 (read per request, so a changed fingerprint needs only a restart). Public,
 * cached for an hour; outside src/proxy.ts's matcher, so no redirect or gate ever touches it.
 */
export const GET = route({ auth: "public", cache: { public: 3600 } }, async () => Response.json(assetLinks(process.env.ANDROID_CERT_SHA256)))
