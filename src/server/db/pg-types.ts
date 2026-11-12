import pg from "pg"

/**
 * node-postgres value parsing that matches PGlite (hosting plan A.3). A plain module (no
 * server-only), so the parity test can load it.
 *
 * int8 (count(*), sum(), bigint values read through execute()): PGlite returns a JS number, or a
 * BigInt past ±2^53; node-postgres returns a string. Without this, `count + 1` concatenates and
 * the refund totals in payments/money.ts compare strings. numeric stays a string in both, and
 * drizzle keeps timestamp/date/interval as raw text in both drivers.
 */
const MAX = BigInt(Number.MAX_SAFE_INTEGER)
const MIN = BigInt(Number.MIN_SAFE_INTEGER)

/** int8 text → number when it fits exactly, else BigInt (PGlite's rule). */
export function parseInt8(text: string): number | bigint {
  const b = BigInt(text)
  return b > MAX || b < MIN ? b : Number(b)
}

// pg-types lists no builtin name for int8[]; its type id is 1016.
const INT8_ARRAY = 1016 as Parameters<typeof pg.types.getTypeParser>[0]
let set = false

/** Registers the PGlite-compatible parsers on node-postgres's global type table (once per process, before any query). */
export function setPgliteCompatibleParsers() {
  if (set) return
  set = true
  pg.types.setTypeParser(pg.types.builtins.INT8, parseInt8)
  const parseArray = pg.types.getTypeParser(INT8_ARRAY) as (v: string) => unknown
  // int8[]: the default parser yields strings; map each element the same way.
  pg.types.setTypeParser(INT8_ARRAY, (v: string) => {
    const walk = (x: unknown): unknown => (Array.isArray(x) ? x.map(walk) : typeof x === "string" ? parseInt8(x) : x)
    return walk(parseArray(v))
  })
}
