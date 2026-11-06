import "server-only"

/** Realtime channel names (§4.1). */
export const channels = {
  /** A shopper's events. */
  user: (userId: string) => `user:${userId}`,
  /** Every member of a brand. */
  brand: (brandId: string) => `brand:${brandId}`,
  /** A brand member's personal events. */
  member: (userId: string) => `member:${userId}`,
  /** Queue counts for every admin. */
  admin: "admin",
  adminUser: (adminId: string) => `admin:${adminId}`,
  /** session.ended only. */
  session: (sessionId: string) => `session:${sessionId}`,
} as const

/** The channels a stream on each surface listens to (§4.2). */
export function surfaceChannels(surface: "market" | "studio" | "admin", ids: { userId: string; sessionId: string; brandId?: string | null }) {
  if (surface === "market") return [channels.user(ids.userId), channels.session(ids.sessionId)]
  if (surface === "studio") return [channels.brand(ids.brandId ?? "-"), channels.member(ids.userId), channels.session(ids.sessionId)]
  return [channels.admin, channels.adminUser(ids.userId), channels.session(ids.sessionId)]
}
