/**
 * The page to open after a Control Center sign-in: ?next= only when it is a path on this origin
 * inside /admin (never an external URL, a protocol-relative "//host" or the sign-in page itself),
 * else /admin.
 */
export function safeAdminNext(raw: string | null | undefined): string {
  const fallback = "/admin"
  if (!raw || raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback
  try {
    const base = "https://control.invalid"
    const url = new URL(raw, base)
    if (url.origin !== base) return fallback
    if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return fallback
    if (url.pathname === "/admin/sign-in" || url.pathname.startsWith("/admin/sign-in/")) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
