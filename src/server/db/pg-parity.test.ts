/**
 * PGlite ↔ Postgres parity (hosting plan A.3). The value tests below always run (parsers only).
 * The database tests need a throwaway Postgres database the test may wipe:
 *
 *   YARD_PARITY_DATABASE_URL=postgres://user:pw@127.0.0.1:5432/yard_parity npm test
 *
 * They replay every migration on both engines (PGlite in memory, the Postgres database after
 * dropping its schemas), compare the resulting columns and indexes, then run the same queries on
 * both and require the same JavaScript values: int8/count/sum, numbers past 2^53, numeric, timestamp
 * text, date, jsonb, arrays, ordering (collation), unique-violation codes and the deadlock code.
 */
import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { sql } from "drizzle-orm"
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres"
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator"
import { drizzle as drizzlePglite } from "drizzle-orm/pglite"
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator"
import pg from "pg"
import { pgErrorCode } from "../http/pg-errors"
import { parseInt8, setPgliteCompatibleParsers } from "./pg-types"

const url = process.env.YARD_PARITY_DATABASE_URL?.trim()
const migrationsFolder = path.join(process.cwd(), "drizzle")

test("parseInt8 matches PGlite: numbers while safe, BigInt beyond", () => {
  assert.equal(parseInt8("0"), 0)
  assert.equal(parseInt8("-42"), -42)
  assert.equal(parseInt8(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER)
  assert.equal(parseInt8("9007199254740993"), BigInt("9007199254740993"))
  assert.equal(parseInt8("-9007199254740993"), BigInt("-9007199254740993"))
})

type Exec = (q: ReturnType<typeof sql>) => Promise<Record<string, unknown>[]>

async function engines() {
  setPgliteCompatibleParsers()
  const lite = new PGlite()
  const dl = drizzlePglite(lite)
  const pool = new pg.Pool({ connectionString: url, max: 4, options: "-c timezone=UTC" })
  const dp = drizzlePg(pool)
  const run =
    (d: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }): Exec =>
    async (q) =>
      ((await d.execute(q)) as { rows: Record<string, unknown>[] }).rows
  return { lite, dl, pool, dp, l: run(dl), p: run(dp) }
}

test("Postgres parity", { skip: url ? false : "set YARD_PARITY_DATABASE_URL to a throwaway Postgres database" }, async (t) => {
  const e = await engines()
  try {
    // A clean slate on Postgres: the test owns this database.
    await e.pool.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public")
    await migratePglite(e.dl, { migrationsFolder })
    await migratePg(e.dp, { migrationsFolder })

    await t.test("the same schema after every migration (columns, types, defaults, nullability, indexes)", async () => {
      const cols = sql`select table_name, column_name, data_type, udt_name, is_nullable, column_default, is_generated, generation_expression
        from information_schema.columns where table_schema = 'public' order by table_name, column_name`
      const idx = sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by tablename, indexname`
      const views = sql`select table_name from information_schema.views where table_schema = 'public' order by 1`
      assert.deepEqual(await e.p(cols), await e.l(cols))
      assert.deepEqual(await e.p(idx), await e.l(idx))
      assert.deepEqual(await e.p(views), await e.l(views))
      const migrated = sql`select count(*) as n from drizzle.__drizzle_migrations`
      assert.deepEqual(await e.p(migrated), await e.l(migrated))
    })

    await t.test("value types through execute() are identical", async () => {
      const q = sql`select count(*) as c, sum(x) as s, max(x)::bigint as m, 9007199254740993::bigint as big, (-5)::int8 as neg,
          12.50::numeric(10,2) as num, 1.5::real as r, 2.25::double precision as d, 7::int as i, 3::smallint as sm,
          true as b, 'x'::text as t, '2026-02-03'::date as dt, timestamptz '2026-11-11 21:47:20.88+01' as ts,
          timestamp '2026-11-11 21:47:20' as tsn, interval '90 minutes' as iv, '{"a":[1,2],"b":null}'::jsonb as j,
          array[1,2]::int8[] as a8, array[1,2]::int[] as a4, array['a','b']::text[] as at, null::bigint as nb, coalesce(sum(x), 0)::bigint as cs
        from (values (1), (2), (3)) v(x)`
      const [lp] = await e.p(q)
      const [ll] = await e.l(q)
      assert.deepEqual(lp, ll)
      assert.equal(typeof lp.c, "number")
      assert.equal(lp.big, BigInt("9007199254740993"))
    })

    await t.test("drizzle select with sql<number> count(*) returns numbers on both", async () => {
      const q = sql`select count(*) as n from information_schema.tables`
      const [a] = await e.p(q)
      const [b] = await e.l(q)
      assert.equal(typeof a.n, "number")
      assert.equal(typeof b.n, "number")
    })

    await t.test("ordering by text (collation C, like PGlite)", async () => {
      const q = sql`select s from (values ('b'), ('B'), ('a'), ('Á'), ('_x'), ('Z'), ('é'), ('10'), ('9')) v(s) order by s`
      assert.deepEqual(await e.p(q), await e.l(q))
      const db = await e.pool.query("select datcollate, datctype from pg_database where datname = current_database()")
      assert.equal(db.rows[0].datcollate, "C", "create the database with LC_COLLATE 'C' (deploy/setup.sh)")
    })

    await t.test("timestamp text is UTC on both", async () => {
      const q = sql`select now()::timestamptz::text like '%+00' as utc, current_setting('TimeZone') as tz`
      assert.deepEqual(await e.p(q), await e.l(q))
    })

    await t.test("errors carry the same SQLSTATE through drizzle (unique 23505, NUL 22021, bad date 22008)", async () => {
      const codes = async (x: Exec) => {
        const out: (string | null)[] = []
        await x(sql`create temp table if not exists parity_u (k text primary key)`)
        await x(sql`insert into parity_u values ('a') on conflict do nothing`)
        for (const q of [sql`insert into parity_u values ('a')`, sql`select ${"a\u0000b"}::text`, sql`select '2027-02-30'::date`]) {
          try {
            await x(q)
            out.push(null)
          } catch (err) {
            out.push(pgErrorCode(err))
          }
        }
        return out
      }
      assert.deepEqual(await codes(e.p), ["23505", "22021", "22008"])
      assert.deepEqual(await codes(e.l), ["23505", "22021", "22008"])
    })

    await t.test("Postgres reports a deadlock as 40P01 (what tx.ts retries)", async () => {
      await e.pool.query("create table if not exists parity_dl (id int primary key, v int); insert into parity_dl values (1, 0), (2, 0) on conflict do nothing")
      const a = await e.pool.connect()
      const b = await e.pool.connect()
      try {
        await a.query("begin")
        await b.query("begin")
        await a.query("update parity_dl set v = v + 1 where id = 1")
        await b.query("update parity_dl set v = v + 1 where id = 2")
        const r = await Promise.allSettled([a.query("update parity_dl set v = v + 1 where id = 2"), b.query("update parity_dl set v = v + 1 where id = 1")])
        const codes = r.filter((x) => x.status === "rejected").map((x) => pgErrorCode((x as PromiseRejectedResult).reason))
        assert.deepEqual(codes, ["40P01"])
      } finally {
        await a.query("rollback").catch(() => {})
        await b.query("rollback").catch(() => {})
        a.release()
        b.release()
        await e.pool.query("drop table if exists parity_dl")
      }
    })
  } finally {
    await e.pool.end()
    await e.lite.close()
  }
})
