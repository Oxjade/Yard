import type { AppAttestConfigDto } from "@/lib/api/contracts/app-attest"
import { publicConfig } from "@/server/app-attest"
import { route } from "@/server/http/route"

/**
 * GET /api/app/attest/config → { mode, android: { cloudProjectNumber } | null, ios: { environment } | null }.
 * A platform is null when attestation is off or that platform isn't configured: its app then sends
 * no X-Yard-Attest. Public values only. docs/APP.md "App attestation".
 */
export const GET = route({ auth: "public", cache: "no-store", rate: { key: "app.attest.config", limit: 60, windowSec: 60, anonGlobal: 6000 } }, async (): Promise<AppAttestConfigDto> => publicConfig())
