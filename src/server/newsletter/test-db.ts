/**
 * A throwaway PGlite database with every migration applied, for the Newsletter tests
 * (audience.test.ts, batch.test.ts). In memory: nothing touches the data directory.
 */
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { sql, type SQL } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import type { Exec } from "./audience"
import type { TxFn } from "./batch"

export async function testDb() {
  const lite = new PGlite()
  const d = drizzle(lite)
  await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  const ex: Exec = { execute: (q: SQL) => d.execute(q) }
  const withTx: TxFn = (fn) => d.transaction((tx) => fn({ execute: (q: SQL) => tx.execute(q) }))
  const rows = async <T>(q: SQL) => ((await d.execute(q)) as unknown as { rows: T[] }).rows
  return { lite, d, ex, withTx, rows, close: () => lite.close() }
}

export async function seedPeople(ex: Exec) {
  const user = (id: string, kind: string, email: string, extra: { country?: string; status?: string; demo?: boolean } = {}) =>
    ex.execute(sql`insert into users (id, kind, name, email, country, status, demo) values (${id}, ${kind}, ${`Name ${id}`}, ${email}, ${extra.country ?? null}, ${extra.status ?? "active"}, ${extra.demo ?? false})`)
  await ex.execute(sql`insert into brands (id, handle, name, city, city_slug, country, currency, categories, followers_base, time_zone) values ('b_one', 'one', 'Brand One', 'Lagos', 'lagos', 'NG', 'NGN', '{}', 0, 'Africa/Lagos'), ('b_two', 'two', 'Brand Two', 'Accra', 'accra', 'GH', 'GHS', '{}', 0, 'Africa/Accra')`)
  await user("u_yes_ng", "shopper", "yes.ng@example.com", { country: "NG" })
  await user("u_yes_gh", "shopper", "yes.gh@example.com", { country: "GH" })
  await user("u_no", "shopper", "no@example.com", { country: "NG" })
  await user("u_default", "shopper", "default@example.com", { country: "NG" })
  await user("u_unsub", "shopper", "unsub@example.com", { country: "NG" })
  await user("u_bounce", "shopper", "bounce@example.com", { country: "NG" })
  await user("u_suspended", "shopper", "suspended@example.com", { country: "NG", status: "suspended" })
  await user("u_demo", "shopper", "demo@example.com", { country: "NG", demo: true })
  await user("u_erased", "shopper", "deleted+u_erased@deleted.invalid", { country: "NG" })
  await user("u_owner", "brand_staff", "owner@example.com")
  await user("u_viewer", "brand_staff", "viewer@example.com")
  // Consent: three opted in, one explicitly out, u_default has no row at all (= off).
  for (const [id, on] of [["u_yes_ng", true], ["u_yes_gh", true], ["u_no", false], ["u_unsub", true], ["u_bounce", true], ["u_suspended", true], ["u_demo", true], ["u_erased", true], ["u_owner", true], ["u_viewer", true]] as const)
    await ex.execute(sql`insert into notification_preferences (user_id, email_marketing) values (${id}, ${on})`)
  await ex.execute(sql`insert into email_suppressions (id, email_lower, category, reason) values ('sup1', 'unsub@example.com', 'marketing', 'unsubscribe'), ('sup2', 'bounce@example.com', 'all', 'bounce')`)
  await ex.execute(sql`insert into brand_members (id, brand_id, user_id, role, status) values ('bm1', 'b_one', 'u_owner', 'owner', 'active'), ('bm2', 'b_one', 'u_viewer', 'viewer', 'active')`)
  await ex.execute(sql`insert into shopper_follows (user_id, brand_id) values ('u_yes_ng', 'b_one'), ('u_no', 'b_one'), ('u_yes_gh', 'b_two')`)
}
