import { z } from "zod"
import { FIXTURE_SET_KEYS, KIT_MARKER, type FixtureSet } from "./fixtures"

/** Bodies of POST|DELETE /api/inbox/dev/fixtures (development only). */
const sets = z.array(z.enum(FIXTURE_SET_KEYS as [FixtureSet, ...FixtureSet[]])).min(1).max(FIXTURE_SET_KEYS.length)
/** `run` tags one kit run: a POST from another run inside 15 minutes is a 409 unless `force`. */
const run = z.string().trim().regex(/^[\w.:-]{4,64}$/).optional()
export const fixturesCreateBody = z.strictObject({ sets, run, force: z.boolean().optional() })
export const fixturesRemoveBody = z.strictObject({
  sets,
  since: z.iso.datetime({ offset: true }).optional(),
  reasonPrefix: z.string().trim().min(KIT_MARKER.length).max(40).startsWith(KIT_MARKER, { error: `Start it with "${KIT_MARKER}".` }).optional(),
})
