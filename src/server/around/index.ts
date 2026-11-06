import "server-only"

/** Around contract (F1 draft; cluster A replaces the bodies and IMPL in wave 2). */
export const IMPL: string = "stub"

/**
 * Drops cached place lists after a moderation or brand-status change. The stub caches nothing:
 * a no-op rather than a throw, because admin decisions call it inside their transaction.
 */
export function invalidate(): void {}

export const jobs = {}
