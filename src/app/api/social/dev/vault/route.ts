import { sql } from "drizzle-orm"
import { requireAdmin } from "@/server/auth/dal"
import { db } from "@/server/db"
import { getEnv } from "@/server/env"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { log } from "@/server/log"
import { vaultStats } from "@/server/social/tokens"

/**
 * GET /api/social/dev/vault (development only, 404 in production before auth; then an admin with
 * audit.view): the curl kit's view of the token vault without opening the database — how many
 * sealed rows exist, whether every one is in the v1. format, social_accounts' column names
 * (none may hold a token), and how many abuse_events rows S's rate limits wrote. Never a token.
 */
export const GET = route({ auth: "public" }, async () => {
  if (!getEnv().dev) throw notFound()
  await requireAdmin("audit.view")
  const d = await db()
  const cols = (await d.execute(sql`select column_name from information_schema.columns where table_name = 'social_accounts' order by ordinal_position`)) as unknown as { rows: { column_name: string }[] }
  // S's rate limits write abuse_events rows (§5.1): how many each one has written.
  const abuse = (await d.execute(sql`select action, count(*)::int as n from abuse_events where action like 'social.%' group by action`)) as unknown as { rows: { action: string; n: number }[] }
  // Files imported from a provider (or the sandbox), so the kit can check a stopped sync left none behind.
  const imports = (await d.execute(sql`select count(*)::int as n from media_assets where purpose = 'social_import'`)) as unknown as { rows: { n: number }[] }
  log.once("social:dev-vault", "info", "[yard] social: dev vault stats read (counts only, never a token)")
  return { ...(await vaultStats()), accountColumns: cols.rows.map((r) => r.column_name), abuseEvents: Object.fromEntries(abuse.rows.map((r) => [r.action, r.n])), importedFiles: imports.rows[0]?.n ?? 0 }
})
