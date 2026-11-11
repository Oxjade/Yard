/**
 * Postgres errors caused by the caller's input (route()'s backstop, §1.10). A plain module with no
 * server imports, so it has its own unit test.
 *
 * SQLSTATE class 22 is "data exception": a value Postgres refuses (a NUL, a date that doesn't exist,
 * text where a number belongs, a number out of range, text too long). Contracts should refuse these
 * first; when one slips through it's still the caller's input, so a 400, never a 500.
 */
export const PG_DATA_EXCEPTIONS: Record<string, string> = {
  "22001": "string too long",
  "22003": "numeric value out of range",
  "22007": "invalid date/time format",
  "22008": "date/time field out of range",
  "22012": "division by zero",
  "22021": "invalid byte sequence",
  "22023": "invalid parameter value",
  "22P02": "invalid text representation",
  "22P05": "untranslatable character",
}

/** The SQLSTATE of a driver error, or of the driver error a DrizzleQueryError (or another wrapper) carries as `cause`. */
export function pgErrorCode(e: unknown): string | null {
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    const code = (cur as { code?: unknown }).code
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code
  }
  return null
}

/**
 * The 400 a data exception becomes, or null for any other error. `text` marks hidden characters
 * (22021, 22P05), which get their own message; `name` is fixed words for the log line, never the
 * driver's message (which can repeat the refused value).
 */
export function pgDataException(e: unknown): { code: string; name: string; text: boolean; message: string } | null {
  const code = pgErrorCode(e)
  if (!code?.startsWith("22")) return null
  const text = code === "22021" || code === "22P05"
  return { code, name: PG_DATA_EXCEPTIONS[code] ?? "data exception", text, message: text ? "Remove the hidden characters and try again." : "One of the values isn't valid. Check it and try again." }
}

/**
 * Postgres (DATABASE_URL) failures that mean "busy right now", not a bug: a deadlock or
 * serialization failure that survived tx.ts's one retry, a statement or lock wait that ran out
 * (statement_timeout / lock_timeout), too many connections, a server shutting down or restarting,
 * the pool's wait for a free connection timing out, or a pool already ended at shutdown. route() answers these 503 busy (Retry-After)
 * rather than 500. PGlite never raises them.
 */
const PG_TRANSIENT = new Set(["40001", "40P01", "55P03", "57014", "53300", "57P01", "57P02", "57P03", "08000", "08003", "08006"])
export function pgTransient(e: unknown): string | null {
  const code = pgErrorCode(e)
  if (code && PG_TRANSIENT.has(code)) return code
  for (let cur: unknown = e, depth = 0; cur && typeof cur === "object" && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    const message = (cur as { message?: unknown }).message
    // node-postgres's pool: "timeout exceeded when trying to connect"; a dropped socket: "Connection terminated…".
    // A request that outlived the pool (process shutting down): "Cannot use a pool after calling end on the pool".
    if (typeof message === "string" && /^(timeout exceeded when trying to connect|Connection terminated|Cannot use a pool after calling end)/i.test(message)) return "pool"
  }
  return null
}
