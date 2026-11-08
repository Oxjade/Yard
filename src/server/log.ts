import "server-only"
import { yard } from "./state"

/**
 * Strips secrets from anything logged (§5.5): access and refresh tokens, OAuth codes and client
 * secrets in objects, and the whole query string of any URL (Instagram puts client_secret and
 * access_token in the URL, and fetch errors repeat it).
 */
export function redact(value: unknown): unknown {
  if (value instanceof Error && isFailedQuery(value)) return withheldQuery(value)
  if (value instanceof Error && isDriverError(value)) return withheldDriverError(value)
  if (value instanceof Error) {
    const e = new Error(redactText(value.message))
    e.name = value.name
    e.stack = value.stack ? redactText(value.stack) : undefined
    return e
  }
  if (typeof value === "string") return redactText(value)
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = /^(access_token|refresh_token|code|client_secret|token|password|secret)$/i.test(k) ? "[redacted]" : redact(v)
    return out
  }
  return value
}

/** drizzle's DrizzleQueryError: "Failed query: <sql>\nparams: <values>", with `query`, `params` and the driver error as `cause`. */
function isFailedQuery(e: Error): e is Error & { query?: unknown; params?: unknown } {
  return "params" in e || "query" in e || e.message.startsWith("Failed query:")
}

/** A Postgres driver error (postgres-js PostgresError): a SQLSTATE `code` plus the server's severity/routine fields. */
function isDriverError(e: Error): e is Error & { code: string } {
  const code = (e as { code?: unknown }).code
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && (e.name === "PostgresError" || "severity" in e || "routine" in e)
}

/** Fixed words per SQLSTATE class, for production logs (§5.5). */
const PG_CLASSES: Record<string, string> = {
  "08": "connection exception",
  "22": "data exception",
  "23": "integrity constraint violation",
  "25": "invalid transaction state",
  "40": "transaction rollback",
  "42": "syntax error or access rule violation",
  "53": "insufficient resources",
  "54": "program limit exceeded",
  "57": "operator intervention",
  "P0": "PL/pgSQL error",
  XX: "internal error",
}

/**
 * The driver's part of a failed query, as it may be logged. Postgres repeats the refused value in
 * many messages (`date/time field value out of range: "2027-02-30"`, `invalid input syntax for
 * type integer: "<what was typed>"`), so in production only the SQLSTATE and fixed words for its
 * class are kept; development keeps the driver's full message to find the bug.
 */
function driverText(cause: { code?: unknown; message?: unknown } | undefined, prod: boolean): string {
  if (!cause || typeof cause !== "object") return ""
  const code = typeof cause.code === "string" ? cause.code : null
  if (prod) return code ? `${code} ${PG_CLASSES[code.slice(0, 2)] ?? "database error"}` : "database error"
  return [code, typeof cause.message === "string" ? redactText(cause.message) : null].filter(Boolean).join(" ")
}

/** The stack's first line repeats the message (statement, params, values), so keep only its frames. */
function withMessage(e: Error, message: string): Error {
  const out = new Error(message)
  out.name = e.name
  const frames = e.stack?.split("\n").filter((l) => /^\s+at /.test(l)) ?? []
  out.stack = [`${out.name}: ${out.message}`, ...frames].join("\n")
  return out
}

/**
 * A failed query is logged without its parameters, ever (they are user-written values and ids:
 * captions, messages, emails), and without its SQL text or the driver's message in production.
 * What stays is enough to find the bug: the SQLSTATE everywhere, and in development the statement
 * and the driver's message.
 */
function withheldQuery(e: Error & { query?: unknown; params?: unknown }): Error {
  const prod = process.env.NODE_ENV === "production"
  const sql = typeof e.query === "string" ? e.query : (/^Failed query: ([\s\S]*?)\nparams:/.exec(e.message)?.[1] ?? "")
  const driver = driverText(e.cause as { code?: unknown; message?: unknown } | undefined, prod)
  const head = prod || !sql ? "Failed query (statement and parameters withheld)" : `Failed query (parameters withheld): ${redactText(sql).slice(0, 400)}`
  return withMessage(e, driver ? `${head} — ${driver}` : head)
}

/** A driver error that reached a log without drizzle's wrapper: same rule, its message only in development. */
function withheldDriverError(e: Error & { code: string }): Error {
  return withMessage(e, `Database error — ${driverText(e, process.env.NODE_ENV === "production")}`)
}

function redactText(s: string) {
  return s
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1?…")
    .replace(/(access_token|refresh_token|client_secret|code)=([^&\s"']+)/gi, "$1=[redacted]")
}

export const log = {
  info: (...args: unknown[]) => console.log(...args.map(redact)),
  warn: (...args: unknown[]) => console.warn(...args.map(redact)),
  error: (...args: unknown[]) => console.error(...args.map(redact)),
  /** Logs a message only the first time `key` is seen in this process. */
  once(key: string, level: "info" | "warn" | "error", ...args: unknown[]) {
    const seen = (yard.logged ??= new Set())
    if (seen.has(key)) return
    seen.add(key)
    log[level](...args)
  },
}
