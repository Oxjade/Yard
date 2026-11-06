import { sql } from "drizzle-orm"
import { requireAdmin } from "@/server/auth/dal"
import { db } from "@/server/db"
import { getEnv } from "@/server/env"
import { notFound } from "@/server/http/errors"
import { route } from "@/server/http/route"
import { vaultStats } from "@/server/social/tokens"

/**
 * GET /api/social/dev/vault (development only, 404 in production before auth; then an admin with
 * audit.view): the curl kit's view of the token vault without opening the database — how many
 * sealed rows exist, whether every one is in the v1. format, and social_accounts' column names
 * (none may hold a token). Never a token.
 */
export const GET = route({ auth: "public" }, async () => {
  if (!getEnv().dev) throw notFound()
  await requireAdmin("audit.view")
  const d = await db()
  const cols = (await d.execute(sql`select column_name from information_schema.columns where table_name = 'social_accounts' order by ordinal_position`)) as unknown as { rows: { column_name: string }[] }
  return { ...(await vaultStats()), accountColumns: cols.rows.map((r) => r.column_name) }
})
