import { requireAdmin } from "@/server/auth/dal"
import { getEnv } from "@/server/env"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { log } from "@/server/log"
import { resetSocialToSeed } from "@/server/social/dev"

/**
 * POST /api/social/dev/reset (development only, 404 in production before auth; then an admin with
 * audit.view): removes every social account, token, import, upload post and their files, so the
 * demo brands see only the seeded sample posts again. The cluster S kit and browser checks call it
 * last, followed by POST /api/dev/reseed?module=social.
 */
export const POST = route({ auth: "public" }, async () => {
  if (!getEnv().dev) throw notFound()
  await requireAdmin("audit.view")
  const done = await resetSocialToSeed()
  log.info(`[yard] social: dev reset removed ${done.posts} posts, ${done.accounts} accounts, ${done.auditRows} audit rows`)
  return done
})
