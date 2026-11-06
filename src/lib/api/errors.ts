import { ApiError } from "./client"

/** Plain-language copy for an API failure, for toasts and inline errors. Never raw error text. */
export function errorMessage(e: unknown, fallback = "That didn't go through. Check your connection and try again.") {
  if (e instanceof ApiError) {
    if (e.code === "rate_limited") return e.retryAfter ? `${e.message.replace(/\.$/, "")} (about ${formatWait(e.retryAfter)}).` : e.message
    return e.message || fallback
  }
  return fallback
}

/** "40 s", "3 min", "2 h". */
export function formatWait(seconds: number) {
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
}

export const isApiError = (e: unknown, code?: string): e is ApiError => e instanceof ApiError && (!code || e.code === code)
export const isUnauthenticated = (e: unknown) => e instanceof ApiError && e.status === 401
export const isNotFound = (e: unknown) => e instanceof ApiError && e.status === 404

/** Field errors keyed by path, for forms that reuse the contracts' messages. */
export const fieldErrors = (e: unknown): Record<string, string> => (e instanceof ApiError && e.fields ? e.fields : {})

export { ApiError }
