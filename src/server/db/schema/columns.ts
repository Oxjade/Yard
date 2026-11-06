/**
 * Column and constraint helpers for the schema files. Plain Node (no server-only, no @/ aliases):
 * drizzle-kit and `tsx --test` load the schema outside Next (§1.4).
 */
import { sql } from "drizzle-orm"
import { check, customType, timestamp } from "drizzle-orm/pg-core"

/** A timestamptz read as a JS Date. */
export const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" })

/** CHECK (<column> in ('a', 'b', …)). Values come from contracts/enums.ts, never from input. */
export const oneOf = (name: string, column: string, values: readonly string[]) =>
  check(name, sql.raw(`${column} in (${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ")})`))

/** A raw SQL fragment for checks, partial-index predicates and expression indexes (schema only). */
export const raw = (s: string) => sql.raw(s)

/** Postgres full-text vector, used only as a generated column. */
export const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" })
