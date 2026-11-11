import "server-only"

/**
 * The error wire format (§1.10): `{ error: { code, message, fields? } }`. Handlers throw these;
 * the route wrapper maps them. Messages are written for people and never carry raw zod text.
 */
export type ErrorCode =
  | "validation"
  | "unauthenticated"
  | "forbidden"
  | "csrf"
  | "blocked"
  | "restricted"
  | "suspended"
  | "not_found"
  | "gone"
  | "conflict"
  | "length_required"
  | "too_large"
  | "unsupported_type"
  | "rule"
  | "rate_limited"
  | "not_configured"
  | "busy"
  | "internal"

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
    message: string,
    public fields?: Record<string, string>,
    public retryAfter?: number,
  ) {
    super(message)
    this.name = "HttpError"
  }
}

/** A contract function a wave-2 cluster hasn't implemented yet (its module still says IMPL = 'stub'). */
export class NotImplemented extends Error {
  constructor(public fn: string) {
    super(`${fn} is not implemented yet`)
    this.name = "NotImplemented"
  }
}

export const badRequest = (fields?: Record<string, string>, message = "Check the highlighted fields.") => new HttpError(400, "validation", message, fields)
export const unauthenticated = (message = "Sign in to continue.") => new HttpError(401, "unauthenticated", message)
export const forbidden = (message = "Your role can't do that.") => new HttpError(403, "forbidden", message)
export const csrfFailed = () => new HttpError(403, "csrf", "This request didn't come from Yard. Reload the page and try again.")
export const blocked = (message = "You can't message this account.") => new HttpError(403, "blocked", message)
export const restricted = (message: string) => new HttpError(403, "restricted", message)
export const suspended = (message = "This demo account is suspended.") => new HttpError(403, "suspended", message)
export const notFound = (message = "We couldn't find that.") => new HttpError(404, "not_found", message)
export const conflict = (message: string) => new HttpError(409, "conflict", message)
export const rule = (message: string) => new HttpError(422, "rule", message)
export const rateLimited = (retryAfter: number, message = "You're doing that a lot. Try again in a moment.") => new HttpError(429, "rate_limited", message, undefined, retryAfter)
export const notConfigured = (message: string) => new HttpError(503, "not_configured", message)
export const busy = (retryAfter = 30, message = "Yard is busy right now. Try again shortly.") => new HttpError(503, "busy", message, undefined, retryAfter)

export function errorBody(e: HttpError) {
  return { error: { code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) } }
}
